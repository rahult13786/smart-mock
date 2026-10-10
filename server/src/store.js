// Storage layer.
//
// Optimisation by basePath:
//   * Each registered API (basePath /api/{name}/{version}) gets its OWN NeDB file
//     (data/apis/{name}__{version}.db). A request only ever touches the datastore for
//     its basePath, so one large API never slows down another.
//   * The registry is held in an in-memory Map keyed by "name__version" -> O(1) lookup
//     per request instead of a DB query.
//   * Datastores are opened lazily on first use and cached; files are compacted on an interval.
//
// Record documents are stored as:
//   { _id: <record id>, body: "<JSON string>", idx: { <safePath>: "<lowercased value>" },
//     summary: { <root scalar fields> }, createdAt, updatedAt }
// The full record is kept as a string so keys such as "@type" or keys containing "." / "$"
// (not allowed as NeDB field names) are preserved exactly.

const fs = require('fs');
const path = require('path');
const Datastore = require('@seald-io/nedb');
const { computeIndex, rootSummary } = require('./tags');

// Vercel functions can only write to /tmp (temporary) – see README "Deploy"
const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp/mock-api-data' : path.join(__dirname, '..', 'data'));
const API_DIR = path.join(DATA_DIR, 'apis');
const SAMPLE_DIR = path.join(DATA_DIR, 'samples');
fs.mkdirSync(API_DIR, { recursive: true });
fs.mkdirSync(SAMPLE_DIR, { recursive: true });

const registryDb = new Datastore({ filename: path.join(DATA_DIR, 'registry.db') });
const registry = new Map(); // key -> api meta
const datastores = new Map(); // key -> Promise<Datastore>

const apiKey = (name, version) => `${name}__${version}`;

async function init() {
  await registryDb.loadDatabaseAsync();
  const all = await registryDb.findAsync({});
  const { withIdUnique } = require('./tags');
  for (const api of all) registry.set(api._id, { ...api, tags: withIdUnique(api.tags || []) }); // id tags are always unique
  registryDb.setAutocompactionInterval(60_000);
}

function listApis() {
  return [...registry.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function getApi(key) {
  return registry.get(key) || null;
}

async function createApi(name, version) {
  const key = apiKey(name, version);
  if (registry.has(key)) return null;
  const now = new Date().toISOString();
  const api = {
    _id: key,
    name,
    version,
    basePath: `/api/${name}/${version}`,
    hasSample: false,
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
  await registryDb.insertAsync(api);
  registry.set(key, api);
  return api;
}

async function updateApi(key, patch) {
  const api = registry.get(key);
  if (!api) return null;
  const next = { ...api, ...patch, updatedAt: new Date().toISOString() };
  await registryDb.updateAsync({ _id: key }, next, {});
  registry.set(key, next);
  return next;
}

async function deleteApi(key) {
  const api = registry.get(key);
  if (!api) return false;
  await registryDb.removeAsync({ _id: key }, {});
  registry.delete(key);
  sampleCache.delete(key);
  const dsP = datastores.get(key);
  datastores.delete(key);
  if (dsP) {
    const ds = await dsP;
    ds.stopAutocompaction();
  }
  for (const f of [path.join(API_DIR, `${key}.db`), path.join(SAMPLE_DIR, `${key}.json`)]) {
    fs.rmSync(f, { force: true });
  }
  return true;
}

const sampleCache = new Map(); // key -> parsed sample records

function saveSample(key, sample) {
  fs.writeFileSync(path.join(SAMPLE_DIR, `${key}.json`), JSON.stringify(sample, null, 2));
  sampleCache.set(key, Array.isArray(sample) ? sample : [sample]);
}

/** Records used to validate paths: the saved sample, or (no sample) the first stored records. */
async function referenceRecords(key) {
  if (!sampleCache.has(key)) {
    const s = readSample(key);
    if (s != null) {
      const parsed = JSON.parse(s);
      sampleCache.set(key, Array.isArray(parsed) ? parsed : [parsed]);
    }
  }
  if (sampleCache.has(key)) return sampleCache.get(key);
  const ds = await getDatastore(key);
  const docs = await ds.findAsync({}, { body: 1 }).limit(50);
  return docs.map((d) => JSON.parse(d.body));
}

function readSample(key) {
  const f = path.join(SAMPLE_DIR, `${key}.json`);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
}

function getDatastore(key) {
  if (!datastores.has(key)) {
    const p = (async () => {
      const ds = new Datastore({ filename: path.join(API_DIR, `${key}.db`) });
      await ds.loadDatabaseAsync();
      await ds.ensureIndexAsync({ fieldName: 'createdAt' });
      ds.setAutocompactionInterval(120_000);
      return ds;
    })();
    datastores.set(key, p);
    p.catch(() => datastores.delete(key));
  }
  return datastores.get(key);
}

function toDoc(api, record, existing) {
  const now = new Date().toISOString();
  return {
    _id: String(record.id),
    body: JSON.stringify(record),
    idx: computeIndex(record, api.tags),
    summary: rootSummary(record),
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };
}

// Per-record lock so concurrent PATCHes on the same id are applied in order.
const locks = new Map();
async function withLock(lockKey, fn) {
  const prev = locks.get(lockKey) || Promise.resolve();
  let release;
  const current = new Promise((r) => (release = r));
  const chained = prev.then(() => current);
  locks.set(lockKey, chained);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(lockKey) === chained) locks.delete(lockKey);
  }
}

async function reindex(api) {
  const ds = await getDatastore(api._id);
  const docs = await ds.findAsync({});
  for (const d of docs) {
    const record = JSON.parse(d.body);
    await ds.updateAsync({ _id: d._id }, { $set: { idx: computeIndex(record, api.tags) } }, {});
  }
  return docs.length;
}

async function countRecords(key) {
  const ds = await getDatastore(key);
  return ds.countAsync({});
}

module.exports = {
  init,
  apiKey,
  listApis,
  getApi,
  createApi,
  updateApi,
  deleteApi,
  saveSample,
  readSample,
  referenceRecords,
  getDatastore,
  toDoc,
  withLock,
  reindex,
  countRecords,
};
