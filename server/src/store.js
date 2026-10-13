const fs = require('fs');
const path = require('path');

process.umask(0o002);
const MODES = { fileMode: 0o664, dirMode: 0o775 };
const Datastore = require('@seald-io/nedb');
const { computeIndex, rootSummary } = require('./tags');
const remote = require('./remote');

const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp/mock-api-data' : path.join(__dirname, '..', 'data'));
const API_DIR = path.join(DATA_DIR, 'apis');
const SAMPLE_DIR = path.join(DATA_DIR, 'samples');
const ADMIN_DIR = path.join(DATA_DIR, 'admin');
const COLLECTIONS = ['users', 'configs', 'sessions', 'analytics'];
const DEFAULT_MAX_RECORDS = 10;
fs.mkdirSync(API_DIR, { recursive: true });
fs.mkdirSync(ADMIN_DIR, { recursive: true });
fs.mkdirSync(SAMPLE_DIR, { recursive: true });

const registryDb = new Datastore({ filename: path.join(DATA_DIR, 'registry.db'), modes: MODES });
const registry = new Map();
const datastores = new Map();

const apiKey = (name, version, group) => (group ? `${group}__${name}__${version}` : `${name}__${version}`);

const dirty = { registry: new Set(), deleted: new Set(), samples: new Set(), records: new Map(), collections: new Map() };
let tracking = true;
let localVersion = null;
const markRecords = (key, ids) => {
  if (!remote.enabled || !tracking) return;
  if (!dirty.records.has(key)) dirty.records.set(key, new Set());
  for (const id of ids) if (typeof id === 'string') dirty.records.get(key).add(id);
};
const mark = (set, key) => remote.enabled && tracking && set.add(key);

const TAGS_REV = 7;

function upgrade(api) {
  const { withIdUnique, isIdPath } = require('./tags');
  let tags = api.tags || [];
  if ((api.tagsRev || 0) < TAGS_REV) {
    tags = tags.map((t) => {
      if (t.path === 'id' || !isIdPath(t.path) || !t.unique) return t;
      const { unique: _u, uniqueIn: _ui, ...rest } = t;
      return rest;
    });
  }
  const maxRecords = Number.isInteger(api.maxRecords) && api.maxRecords > 0 ? api.maxRecords : DEFAULT_MAX_RECORDS;
  return { ...api, tags: withIdUnique(tags), tagsRev: TAGS_REV, maxRecords, arraySync: !!api.arraySync };
}

async function init() {
  await registryDb.loadDatabaseAsync();
  const all = await registryDb.findAsync({});
  for (const raw of all) {
    const api = upgrade(raw);
    registry.set(api._id, api);
    if (raw.tagsRev !== TAGS_REV || raw.maxRecords !== api.maxRecords) {
      await registryDb.updateAsync({ _id: api._id }, api, {});
      mark(dirty.registry, api._id);
    }
  }
  registryDb.setAutocompactionInterval(60_000);
}

function listApis() {
  return [...registry.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function getApi(key) {
  return registry.get(key) || null;
}

async function createApi(name, version, scope = null) {
  const group = scope ? scope.group : null;
  const key = apiKey(name, version, group);
  if (registry.has(key)) return null;
  const now = new Date().toISOString();
  const api = {
    _id: key,
    name,
    version,
    ...(scope ? { group, domain: scope.domain, team: scope.team, technology: scope.technology, role: scope.role, env: scope.env } : {}),
    basePath: group ? `/api/${group}/${name}/${version}` : `/api/${name}/${version}`,
    maxRecords: DEFAULT_MAX_RECORDS,
    arraySync: false,
    hasSample: false,
    tags: [],
    tagsRev: TAGS_REV,
    createdAt: now,
    updatedAt: now,
  };
  await registryDb.insertAsync(api);
  registry.set(key, api);
  mark(dirty.registry, key);
  return api;
}

async function updateApi(key, patch) {
  const api = registry.get(key);
  if (!api) return null;
  const next = { ...api, ...patch, updatedAt: new Date().toISOString() };
  await registryDb.updateAsync({ _id: key }, next, {});
  registry.set(key, next);
  mark(dirty.registry, key);
  return next;
}

async function deleteApi(key) {
  const api = registry.get(key);
  if (!api) return false;
  await registryDb.removeAsync({ _id: key }, {});
  registry.delete(key);
  sampleCache.delete(key);
  mark(dirty.deleted, key);
  dirty.registry.delete(key);
  dirty.samples.delete(key);
  dirty.records.delete(key);
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

const sampleCache = new Map();

function saveSample(key, sample) {
  fs.writeFileSync(path.join(SAMPLE_DIR, `${key}.json`), JSON.stringify(sample, null, 2));
  sampleCache.set(key, Array.isArray(sample) ? sample : [sample]);
  mark(dirty.samples, key);
}

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
      const ds = new Datastore({ filename: path.join(API_DIR, `${key}.db`), modes: MODES });
      await ds.loadDatabaseAsync();
      await ds.ensureIndexAsync({ fieldName: 'createdAt' });
      await repairIds(ds);
      ds.setAutocompactionInterval(120_000);
      if (remote.enabled) trackWrites(key, ds);
      return ds;
    })();
    datastores.set(key, p);
    p.catch(() => datastores.delete(key));
  }
  return datastores.get(key);
}

const collections = new Map();

function getCollection(name) {
  if (!COLLECTIONS.includes(name)) throw new Error(`Unknown collection ${name}`);
  if (!collections.has(name)) {
    const p = (async () => {
      const ds = new Datastore({ filename: path.join(ADMIN_DIR, `${name}.db`), modes: MODES });
      await ds.loadDatabaseAsync();
      ds.setAutocompactionInterval(120_000);
      if (remote.enabled) trackWrites(name, ds, markCollection);
      return ds;
    })();
    collections.set(name, p);
    p.catch(() => collections.delete(name));
  }
  return collections.get(name);
}

function markCollection(name, ids) {
  if (!remote.enabled || !tracking) return;
  if (!dirty.collections.has(name)) dirty.collections.set(name, new Set());
  for (const id of ids) if (typeof id === 'string') dirty.collections.get(name).add(id);
}

async function repairIds(ds) {
  const broken = await ds.findAsync({ 'summary.id': { $exists: false } });
  for (const d of broken) {
    let body;
    try {
      body = JSON.parse(d.body);
    } catch {
      continue;
    }
    if (body.id !== undefined && body.id !== null && body.id !== '') continue;
    body = { id: d._id, ...body };
    await ds.updateAsync({ _id: d._id }, { $set: { body: JSON.stringify(body), 'summary.id': d._id } }, {});
  }
}

function trackWrites(key, ds, markFn = markRecords) {
  const markRecords = markFn;
  const hasOps = (u) => u && Object.keys(u).some((x) => x.startsWith('$'));
  const ins = ds.insertAsync.bind(ds);
  const upd = ds.updateAsync.bind(ds);
  const rem = ds.removeAsync.bind(ds);
  ds.insertAsync = async (docs) => {
    const r = await ins(docs);
    markRecords(key, (Array.isArray(docs) ? docs : [docs]).map((d) => d._id));
    return r;
  };
  ds.updateAsync = async (q, u, o) => {
    const r = await upd(q, u, o);
    if (!hasOps(u)) markRecords(key, [q && q._id]);
    return r;
  };
  ds.removeAsync = async (q, o) => {
    const r = await rem(q, o);
    markRecords(key, [q && q._id]);
    return r;
  };
}

async function flush() {
  if (!remote.enabled) return false;
  const cmds = [];
  for (const key of dirty.deleted) cmds.push(['HDEL', remote.k.registry, key], ['DEL', remote.k.data(key)], ['DEL', remote.k.sample(key)]);
  for (const key of dirty.registry) if (registry.has(key)) cmds.push(['HSET', remote.k.registry, key, JSON.stringify(registry.get(key))]);
  for (const key of dirty.samples) {
    const s = readSample(key);
    if (s != null && registry.has(key)) cmds.push(['SET', remote.k.sample(key), s]);
  }
  for (const [key, ids] of dirty.records) {
    if (!registry.has(key)) continue;
    const ds = await getDatastore(key);
    for (const id of ids) {
      const d = await ds.findOneAsync({ _id: id });
      if (d) cmds.push(['HSET', remote.k.data(key), id, JSON.stringify({ b: d.body, c: d.createdAt, u: d.updatedAt })]);
      else cmds.push(['HDEL', remote.k.data(key), id]);
    }
  }
  for (const [name, ids] of dirty.collections) {
    const ds = await getCollection(name);
    for (const id of ids) {
      const d = await ds.findOneAsync({ _id: id });
      if (d) cmds.push(['HSET', remote.k.collection(name), id, JSON.stringify(d)]);
      else cmds.push(['HDEL', remote.k.collection(name), id]);
    }
  }
  dirty.collections.clear();
  dirty.registry.clear();
  dirty.deleted.clear();
  dirty.samples.clear();
  dirty.records.clear();
  if (!cmds.length) return false;
  cmds.push(['INCR', remote.k.version]);
  const results = await remote.pipeline(cmds);
  localVersion = Number(results[results.length - 1]);
  return true;
}

async function pull() {
  const version = await remote.getVersion();
  tracking = false;
  try {
    for (const [, p] of datastores) (await p.catch(() => null))?.stopAutocompaction();
    datastores.clear();
    sampleCache.clear();
    registry.clear();
    fs.rmSync(API_DIR, { recursive: true, force: true });
    fs.rmSync(SAMPLE_DIR, { recursive: true, force: true });
    fs.mkdirSync(API_DIR, { recursive: true });
    fs.mkdirSync(SAMPLE_DIR, { recursive: true });
    await registryDb.removeAsync({}, { multi: true });
    const apis = remote.pairs(await remote.cmd('HGETALL', remote.k.registry)).map(([, v]) => JSON.parse(v));
    for (const raw of apis) {
      const api = upgrade(raw);
      await registryDb.insertAsync(api);
      registry.set(api._id, api);
      const [sample, flat] = await remote.pipeline([['GET', remote.k.sample(api._id)], ['HGETALL', remote.k.data(api._id)]]);
      if (sample != null) fs.writeFileSync(path.join(SAMPLE_DIR, `${api._id}.json`), sample);
      const docs = remote.pairs(flat).map(([id, v]) => {
        const { b, c, u } = JSON.parse(v);
        const rec = JSON.parse(b);
        return { _id: id, body: b, idx: computeIndex(rec, api.tags), summary: rootSummary(rec), createdAt: c, updatedAt: u };
      });
      const ds = await getDatastore(api._id);
      if (docs.length) await ds.insertAsync(docs);
    }
    for (const name of COLLECTIONS) {
      const ds = await getCollection(name);
      await ds.removeAsync({}, { multi: true });
      const docs = remote.pairs(await remote.cmd('HGETALL', remote.k.collection(name))).map(([, v]) => JSON.parse(v));
      if (docs.length) await ds.insertAsync(docs);
    }
    localVersion = version;
  } finally {
    tracking = true;
  }
  return registry.size;
}

async function ensureFresh() {
  if (!remote.enabled) return;
  const v = await remote.getVersion();
  if (v !== localVersion) await pull();
}

function toDoc(api, record, existing) {
  if (record.id === undefined || record.id === null || record.id === '') record.id = existing ? existing._id : require('crypto').randomUUID();
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
  DEFAULT_MAX_RECORDS,
  init,
  flush,
  pull,
  ensureFresh,
  remote,
  DATA_DIR,
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
  getCollection,
  toDoc,
  withLock,
  reindex,
  countRecords,
};
