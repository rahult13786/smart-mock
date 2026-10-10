const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const store = require('./store');
const { computeTags, safeKey, validateTags, listPaths, inspectPath, suggest, normalizePath, splitPath, listContainer, duplicateKeys, isIdPath, withIdUnique } = require('./tags');
const { detectMode, applyPatch, uniqueKeys } = require('./patch');
const { enumViolations, enumError, normalizeEnum, locate } = require('./enums');
const { parseFields, project, parseSort, sortDocs, splitOperator } = require('./query');
const { idPaths, fieldPaths, buildMocks, currentValues, MAX_MOCKS } = require('./mockgen');

const PORT = Number(process.env.PORT || 4000);
const BODY_LIMIT = process.env.BODY_LIMIT || '50mb';

const app = express();
app.use(cors({ exposedHeaders: ['X-Total-Count', 'X-Result-Count', 'X-Patch-Mode', 'X-Patch-Resolved', 'X-Search-Config-Updated', 'X-Not-Found-Ids'] }));
app.use(express.json({ limit: BODY_LIMIT, type: ['application/json', 'application/*+json'] }));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/*
 * Remote persistence (Redis, see remote.js): requests are handled one at a time per instance;
 * before each request the local copy is refreshed if another instance changed the data, and the
 * changes a request made are written to Redis before its response is sent.
 */
if (store.remote.enabled) {
  let queue = Promise.resolve();
  app.use((req, res, next) => {
    if (!/^\/(api|apis|admin)(\/|$)/.test(req.path)) return next(); // static files / health: no sync
    let release;
    const turn = new Promise((r) => (release = r));
    const prev = queue;
    queue = queue.then(() => turn);
    let released = false;
    const done = () => !released && ((released = true), release());
    res.on('finish', done);
    res.on('close', done);
    const end = res.end;
    res.end = function (...args) {
      store
        .flush()
        .catch((e) => console.error('Remote store: saving failed –', e.message))
        .finally(() => end.apply(res, args));
      return res;
    };
    prev
      .then(() => ready)
      .then(() => store.ensureFresh())
      .then(() => next(), (e) => next({ status: 503, message: `Remote store not reachable: ${e.message}` }));
  });
}
const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const VERSION = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}$/;
const slugify = (s) =>
  String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

const asRecords = (sample) => (Array.isArray(sample) ? sample : [sample]);

/** Save a sample: derive tags and (optionally) upsert its records as data. */
async function applySample(api, sample, records, seed = true) {
  store.saveSample(api._id, sample);
  const { tags, dropped } = computeTags(records, api.tags);
  const updated = await store.updateApi(api._id, { hasSample: true, tags });
  if (dropped.length) await store.reindex(updated);
  let seeded = 0;
  if (seed) {
    const ds = await store.getDatastore(api._id);
    for (const rec of records) {
      if (rec.id == null || rec.id === '') rec.id = crypto.randomUUID();
      const existing = await ds.findOneAsync({ _id: String(rec.id) });
      const doc = store.toDoc(updated, rec, existing);
      await ds.updateAsync({ _id: doc._id }, doc, { upsert: true });
      seeded++;
    }
  }
  return { updated, seeded, dropped };
}
const parseMaybe = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

/* ------------------------------------------------------------------ */
/* Admin API – used by the portal to register / configure mock APIs    */
/* ------------------------------------------------------------------ */
const admin = express.Router();

admin.get(
  '/apis',
  wrap(async (_req, res) => {
    const list = await Promise.all(
      store.listApis().map(async (a) => ({ ...a, recordCount: await store.countRecords(a._id) }))
    );
    res.json(list);
  })
);

admin.post(
  '/apis',
  wrap(async (req, res) => {
    const name = slugify(req.body?.name);
    const version = String(req.body?.version || '').trim();
    if (!SLUG.test(name)) return res.status(400).json({ error: 'name is required (letters, digits, - or _)' });
    if (!VERSION.test(version)) return res.status(400).json({ error: 'version is required, e.g. v1 or 1.0' });
    const api = await store.createApi(name, version);
    if (!api) return res.status(409).json({ error: `API ${name}/${version} is already registered` });
    res.status(201).json(api);
  })
);

const findApi = (req, res) => {
  const api = store.getApi(req.params.key);
  if (!api) res.status(404).json({ error: 'API not registered' });
  return api;
};

admin.get(
  '/apis/:key',
  wrap(async (req, res) => {
    const api = findApi(req, res);
    if (api) res.json({ ...api, recordCount: await store.countRecords(api._id) });
  })
);

admin.get('/apis/:key/sample', (req, res) => {
  if (!findApi(req, res)) return;
  const s = store.readSample(req.params.key);
  if (s == null) return res.status(404).json({ error: 'No sample saved yet' });
  res.type('application/json').send(s);
});

// Save the sample JSON: derives the tag list and (by default) seeds the records.
admin.put(
  '/apis/:key/sample',
  wrap(async (req, res) => {
    const api = findApi(req, res);
    if (!api) return;
    let sample;
    try {
      sample = parseMaybe(req.body?.sample);
    } catch (e) {
      return res.status(400).json({ error: `Sample is not valid JSON: ${e.message}` });
    }
    if (sample == null || typeof sample !== 'object') {
      return res.status(400).json({ error: 'Sample must be a JSON object or an array of objects' });
    }
    const records = asRecords(sample).filter((r) => r && typeof r === 'object' && !Array.isArray(r));
    if (!records.length) return res.status(400).json({ error: 'Sample contains no JSON objects' });

    const { updated, seeded, dropped } = await applySample(api, sample, records, req.body?.seed !== false);
    res.json({ ...updated, seeded, droppedTags: dropped, recordCount: await store.countRecords(api._id) });
  })
);

const NEW_VERSION_HINT =
  'Update the sample JSON of this API so it contains the path, or create a new version of the API with an updated sample.';

// All value paths found in the sample (used by the portal for path suggestions)
admin.get(
  '/apis/:key/paths',
  wrap(async (req, res) => {
    const api = findApi(req, res);
    if (api) res.json(listPaths(await store.referenceRecords(api._id)));
  })
);

// Distinct values found at a path (sample + stored records) – used to prefill enum values
admin.get(
  '/apis/:key/values',
  wrap(async (req, res) => {
    const api = findApi(req, res);
    if (!api) return;
    const p = normalizePath(req.query.path);
    if (!p) return res.status(400).json({ error: 'path is required' });
    const seen = new Map();
    const add = (rec) => {
      for (const { value } of locate(rec, p)) {
        if (value === null || typeof value === 'object') continue;
        const k = JSON.stringify(value);
        seen.set(k, { value, count: (seen.get(k)?.count || 0) + 1 });
      }
    };
    (await store.referenceRecords(api._id)).forEach(add);
    const ds = await store.getDatastore(api._id);
    (await ds.findAsync({}, { body: 1 }).limit(500)).forEach((d) => add(JSON.parse(d.body)));
    res.json([...seen.values()].sort((a, b) => b.count - a.count).slice(0, 500));
  })
);

/* ---- Create mocks ------------------------------------------------------------------------ */
// source: "sample:<index>" (a record of the sample) or "record:<id>" (a stored record)
async function mockTemplate(api, source = 'sample:0') {
  const [kind, ...rest] = String(source).split(':');
  const ref = rest.join(':');
  if (kind === 'record') {
    const ds = await store.getDatastore(api._id);
    const doc = await ds.findOneAsync({ _id: ref });
    if (!doc) throw { status: 404, message: `Record ${ref} not found` };
    return JSON.parse(doc.body);
  }
  const s = store.readSample(api._id);
  if (s == null) throw { status: 400, message: 'Save a sample JSON first' };
  const parsed = JSON.parse(s);
  const recs = Array.isArray(parsed) ? parsed : [parsed];
  const t = recs[Number(ref) || 0];
  if (!t) throw { status: 404, message: `Sample record ${ref} not found` };
  return t;
}

admin.get(
  '/apis/:key/mocks/plan',
  wrap(async (req, res) => {
    const api = findApi(req, res);
    if (!api) return;
    const template = await mockTemplate(api, req.query.source);
    res.json({ max: MAX_MOCKS, templateId: template.id, idPaths: idPaths(template), fields: fieldPaths(template, api.tags) });
  })
);

// current value(s) of a field in the template, optionally only in list items matching a filter
admin.get(
  '/apis/:key/mocks/current',
  wrap(async (req, res) => {
    const api = findApi(req, res);
    if (!api) return;
    const template = await mockTemplate(api, req.query.source);
    const filter = req.query.filterKey ? { key: req.query.filterKey, value: req.query.filterValue ?? '' } : null;
    res.json(currentValues(template, normalizePath(req.query.path), filter));
  })
);

admin.post(
  '/apis/:key/mocks',
  wrap(async (req, res) => {
    const api = findApi(req, res);
    if (!api) return;
    const template = await mockTemplate(api, req.body?.source);
    const ds = await store.getDatastore(api._id);
    const existing = new Set((await ds.findAsync({}, { _id: 1 })).map((d) => d._id));
    const { records, warnings } = buildMocks(template, req.body || {}, api.tags, existing);
    records.forEach((r, i) => {
      const bad = enumViolations(r, api.tags, template); // only values the mock introduced
      if (bad.length) {
        const err = enumError(bad);
        err.message = `Mock ${i + 1}: ${err.message}`;
        throw err;
      }
    });
    await ds.insertAsync(records.map((r) => store.toDoc(api, r)));
    res.status(201).json({
      created: records.map((r) => ({ id: r.id, name: r.name })),
      warnings,
      recordCount: await store.countRecords(api._id),
    });
  })
);

// Validate tags against the sample without saving
admin.post(
  '/apis/:key/tags/validate',
  wrap(async (req, res) => {
    const api = findApi(req, res);
    if (!api) return;
    const results = validateTags(await store.referenceRecords(api._id), req.body?.tags || []);
    const valid = results.every((r) => r.ok);
    res.json({ valid, results, hint: valid ? undefined : NEW_VERSION_HINT });
  })
);

// Save tag configuration. Body: {tags:[{path, type?, searchable, enum?, custom?, remove?}]}
//  - enum: allowed values (array; [] or null removes it). Values must match the tag type.
//  - existing tags: searchable flag updated (custom ones may be removed with remove:true)
//  - new paths: added as custom tags after validation against the sample (all-or-nothing)
admin.put(
  '/apis/:key/tags',
  wrap(async (req, res) => {
    const api = findApi(req, res);
    if (!api) return;
    const incoming = (req.body?.tags || []).map((t) => ({ ...t, path: normalizePath(t.path) }));
    const byPath = new Map(api.tags.map((t) => [t.path, t]));
    const fresh = incoming.filter((t) => !t.remove && !byPath.has(t.path));
    if (fresh.length) {
      const results = validateTags(await store.referenceRecords(api._id), fresh);
      const invalid = results.filter((r) => !r.ok);
      if (invalid.length) {
        return res.status(422).json({
          error: invalid.map((r) => r.reason).join('; '),
          code: invalid[0].code || 'INVALID_TAG',
          invalid,
          hint: NEW_VERSION_HINT,
        });
      }
      fresh.forEach((t, i) => (t.type = t.type || results[i].actualTypes[0]));
    }
    const withEnum = (tag, x) => {
      if (!x || !('enum' in x)) return tag;
      const values = normalizeEnum(x.enum, tag.type, tag.path);
      const { enum: _old, ...rest } = tag;
      return values && values.length ? { ...rest, enum: values } : rest;
    };
    let tags = api.tags
      .filter((t) => !(t.custom && incoming.some((x) => x.remove && x.path === t.path)))
      .map((t) => {
        const x = incoming.find((y) => y.path === t.path && !y.remove);
        const next = x && x.searchable !== undefined ? { ...t, searchable: !!x.searchable } : t;
        return withEnum(next, x);
      });
    tags = tags.concat(
      fresh.map((t) =>
        withEnum({ path: t.path, level: splitPath(t.path).length, type: t.type, searchable: t.searchable !== false, custom: true }, t)
      )
    );
    // unique: flag on a field of list items, used as an alternative key in PATCH paths
    tags = tags.map((t) => {
      const x = incoming.find((y) => y.path === t.path && !y.remove);
      if (!x || x.unique === undefined) return t;
      const { unique: _u, uniqueIn: _ui, ...rest } = t;
      return x.unique ? { ...rest, unique: true } : rest;
    });
    tags = withIdUnique(tags); // id tags are always unique – cannot be unchecked
    const uniqueWarnings = [];
    const uniques = tags.filter((t) => t.unique);
    if (uniques.length) {
      const refs = await store.referenceRecords(api._id);
      const problems = [];
      const perList = new Map();
      for (const t of uniques) {
        const c = listContainer(refs, t.path);
        const field = t.path.split('.').pop();
        if (isIdPath(t.path)) {
          if (c.listPath !== null) t.uniqueIn = c.listPath;
          continue; // ids: always unique, no further rules
        }
        if (c.listPath === null) {
          problems.push(`"${t.path}" is not a field of list items – unique can only be set on fields inside a list (e.g. characteristic.name)`);
          continue;
        }
        if (c.itemsHaveId && !/^id$/i.test(field)) {
          problems.push(`"${t.path}": the items of "${c.listPath}" have an "${c.idKey}" field, which is already their key – another field cannot be unique`);
          continue;
        }
        if (t.type && !['string', 'number'].includes(t.type)) problems.push(`"${t.path}": only text or number fields can be unique`);
        if (perList.has(c.listPath)) problems.push(`"${t.path}" and "${perList.get(c.listPath)}" are both unique in "${c.listPath}" – only one unique field per list`);
        perList.set(c.listPath, t.path);
        t.uniqueIn = c.listPath;
        const dups = duplicateKeys(refs, c.listPath, field);
        if (dups.length) uniqueWarnings.push({ path: t.path, duplicates: dups.slice(0, 5), count: dups.length });
      }
      if (problems.length) return res.status(422).json({ error: problems.join('; '), code: 'INVALID_UNIQUE', problems });
    }
    const updated = await store.updateApi(api._id, { tags });
    const reindexed = await store.reindex(updated);
    // report stored values that are outside a (new) enum – they stay, but cannot be re-sent
    const enumTags = tags.filter((t) => t.enum?.length);
    const enumWarnings = [];
    if (enumTags.length) {
      const ds = await store.getDatastore(api._id);
      const docs = await ds.findAsync({}, { body: 1 });
      for (const t of enumTags) {
        const bad = new Set();
        let count = 0;
        for (const d of docs) {
          for (const v of enumViolations(JSON.parse(d.body), [t])) {
            count++;
            if (bad.size < 5) bad.add(JSON.stringify(v.value));
          }
        }
        if (count) enumWarnings.push({ path: t.path, count, values: [...bad] });
      }
    }
    res.json({ ...updated, reindexed, enumWarnings, uniqueWarnings });
  })
);

admin.delete(
  '/apis/:key',
  wrap(async (req, res) => {
    if (!(await store.deleteApi(req.params.key))) return res.status(404).json({ error: 'API not registered' });
    res.status(204).end();
  })
);

app.use('/admin', admin);

/* ------------------------------------------------------------------ */
/* Mock data API – /api/{name}/{version}[/{id}]                        */
/* ------------------------------------------------------------------ */
const data = express.Router({ mergeParams: true });

// Resolve the basePath once per request from the in-memory registry.
// Both /api/{name}/{version} and /apis/{name}/{version} are accepted.
app.use(
  ['/api/:name/:version', '/apis/:name/:version'],
  wrap(async (req, res, next) => {
    const api = store.getApi(store.apiKey(slugify(req.params.name), req.params.version));
    if (!api) {
      return res.status(404).json({
        error: 'API not registered',
        basePath: `/api/${req.params.name}/${req.params.version}`,
        registered: store.listApis().map((a) => a.basePath),
      });
    }
    req.mockApi = api;
    req.ds = await store.getDatastore(api._id);
    next();
  }),
  data
);

const RESERVED = new Set(['view', 'limit', 'skip', 'offset', 'q', 'mode', 'sort', 'fields', 'pathMode']);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const splitList = (raw) =>
  (Array.isArray(raw) ? raw : [raw])
    .flatMap((v) => String(v).split(','))
    .map((v) => v.trim())
    .filter(Boolean);

/**
 * Make sure every filter param is a searchable tag.
 *  - configured but not searchable -> switched on
 *  - not configured but present in the sample -> added as a searchable tag
 *  - not in the sample -> 400 with suggestions
 * Records are re-indexed once when the configuration changes.
 */
async function ensureSearchable(api, paths) {
  const missing = (a) => paths.filter((p) => !a.tags.some((t) => t.path === p && t.searchable));
  if (!missing(api).length) return { api, changed: [] };
  return store.withLock(`config:${api._id}`, async () => {
    let current = store.getApi(api._id);
    const todo = missing(current);
    if (!todo.length) return { api: current, changed: [] };
    const refs = await store.referenceRecords(api._id);
    const tags = current.tags.map((t) => (todo.includes(t.path) ? { ...t, searchable: true } : t));
    for (const p of todo) {
      if (tags.some((t) => t.path === p)) continue;
      const info = inspectPath(refs, p);
      if (!info.found || !info.types.length) {
        throw {
          status: 400,
          code: info.found ? 'NOT_A_VALUE' : 'FILTER_PATH_NOT_FOUND',
          message: info.found
            ? `"${p}" is an object or list – filter on a field inside it`
            : `"${p}" does not exist in the sample of ${api.basePath}`,
          suggestions: suggest(refs, p.split('.').pop()),
          hint: NEW_VERSION_HINT,
        };
      }
      tags.push({ path: p, level: splitPath(p).length, type: info.types[0], searchable: true, custom: true, autoAdded: true, ...(isIdPath(p) ? { unique: true } : {}) });
    }
    current = await store.updateApi(api._id, { tags });
    await store.reindex(current);
    return { api: current, changed: todo };
  });
}

async function buildQuery(api, query) {
  const and = [];
  let ids = null;
  const filters = [];
  for (const [k, raw] of Object.entries(query)) {
    if (RESERVED.has(k)) continue;
    const values = splitList(raw);
    if (!values.length) continue;
    const { path, op } = splitOperator(k);
    if (path === 'id' && op === 'eq') ids = values;
    else filters.push({ path: normalizePath(path), op, values });
  }
  const { api: cfg, changed } = await ensureSearchable(api, [...new Set(filters.map((f) => f.path))]);
  if (ids) and.push({ _id: ids.length === 1 ? ids[0] : { $in: ids } });
  for (const { path, op, values } of filters) {
    const field = `idx.${safeKey(path)}`;
    const re = (v) => (op === 'like' ? new RegExp(escapeRe(v.toLowerCase())) : new RegExp(`^${escapeRe(v.toLowerCase())}$`));
    const ors = values.map((v) => ({ [field]: { $regex: re(v) } }));
    const cond = ors.length === 1 ? ors[0] : { $or: ors };
    and.push(op === 'ne' ? { $not: cond } : cond);
  }
  if (query.q) {
    const re = new RegExp(escapeRe(String(query.q).toLowerCase()));
    const searchable = cfg.tags.filter((t) => t.searchable);
    and.push({ $or: [{ _id: { $regex: new RegExp(escapeRe(String(query.q)), 'i') } }, ...searchable.map((t) => ({ [`idx.${safeKey(t.path)}`]: { $regex: re } }))] });
  }
  return { query: and.length ? { $and: and } : {}, ids, changed };
}

const sendRecords = (res, bodies, fields) => {
  if (!fields) return res.type('application/json').send(`[${bodies.join(',')}]`);
  res.json(bodies.map((b) => project(JSON.parse(b), fields)));
};

// GET collection (TMF630 style). Default: full records (array).
//  filter : ?status=Active (equality, case-insensitive) · ?status=a,b (OR) · ?name.like=x · ?status.ne=x
//           ?id=a,b,c -> records with those ids, in the requested order
//  fields : ?fields=id,name,item.id,item.status -> only those attributes (id always included)
//  sort   : ?sort=-updatedAt,name ("-" descending)
//  paging : ?offset=0&limit=20 (skip = alias of offset) · X-Total-Count / X-Result-Count headers
//  ?view=summary -> {total, items:[root scalar fields]} (used by the portal list)
data.get(
  '/',
  wrap(async (req, res) => {
    const { query: q, ids, changed } = await buildQuery(req.mockApi, req.query);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 0, 0), 1000);
    const skip = Math.max(parseInt(req.query.offset ?? req.query.skip, 10) || 0, 0);
    const summary = req.query.view === 'summary';
    const fields = parseFields(req.query.fields);
    const sort = parseSort(req.query.sort);
    if (req.query.limit !== undefined && (Number.isNaN(Number(req.query.limit)) || Number(req.query.limit) < 0)) {
      throw { status: 400, message: 'limit must be a non-negative number' };
    }
    let total;
    let docs;
    if (sort) {
      // sort in memory on the root fields (summary) – bodies are read only for dotted sort keys
      const needBody = sort.some((k) => k.path.includes('.'));
      const all = await req.ds.findAsync(q, { summary: 1, createdAt: 1, updatedAt: 1, ...(needBody ? { body: 1 } : {}) });
      const cache = new Map();
      const recordOf = (d) => {
        if (!needBody) return null;
        if (!cache.has(d._id)) cache.set(d._id, JSON.parse(d.body));
        return cache.get(d._id);
      };
      total = all.length;
      docs = sortDocs(all, sort, recordOf).slice(skip, limit ? skip + limit : undefined);
      if (!summary && !needBody && docs.length) {
        const withBody = await req.ds.findAsync({ _id: { $in: docs.map((d) => d._id) } }, { body: 1 });
        const byId = new Map(withBody.map((d) => [d._id, d.body]));
        docs = docs.map((d) => ({ ...d, body: byId.get(d._id) }));
      }
    } else {
      total = await req.ds.countAsync(q);
      let cursor = req.ds.findAsync(q, summary ? { summary: 1, updatedAt: 1 } : { body: 1 }).sort({ createdAt: 1 }).skip(skip);
      if (limit) cursor = cursor.limit(limit);
      docs = await cursor;
      if (ids) {
        const order = new Map(ids.map((id, i) => [id, i]));
        docs = docs.sort((a, b) => order.get(a._id) - order.get(b._id));
      }
    }
    if (ids) {
      const found = new Set(docs.map((d) => d._id));
      const notFound = ids.filter((id) => !found.has(id));
      if (notFound.length && !limit && !skip) res.set('X-Not-Found-Ids', notFound.join(','));
    }
    res.set('X-Total-Count', String(total));
    res.set('X-Result-Count', String(docs.length));
    if (changed.length) res.set('X-Search-Config-Updated', changed.join(','));
    if (summary) return res.json({ total, items: docs.map((d) => ({ ...d.summary, _updatedAt: d.updatedAt })), searchConfigUpdated: changed.length ? changed : undefined });
    sendRecords(res, docs.map((d) => d.body), fields);
  })
);

data.get(
  '/:id',
  wrap(async (req, res) => {
    const doc = await req.ds.findOneAsync({ _id: req.params.id });
    if (!doc) return res.status(404).json({ error: `Record ${req.params.id} not found` });
    const fields = parseFields(req.query.fields);
    if (fields) return res.json(project(JSON.parse(doc.body), fields));
    res.type('application/json').send(doc.body);
  })
);

// POST: a single object or an array of objects. id is generated when missing.
data.post(
  '/',
  wrap(async (req, res) => {
    const body = req.body;
    const many = Array.isArray(body);
    const records = many ? body : [body];
    if (!records.length || records.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) {
      return res.status(400).json({ error: 'Body must be a JSON object or an array of JSON objects' });
    }
    const ids = new Set();
    for (const r of records) {
      if (r.id == null || r.id === '') r.id = crypto.randomUUID();
      const id = String(r.id);
      if (ids.has(id)) return res.status(400).json({ error: `Duplicate id ${id} in request` });
      ids.add(id);
    }
    for (const [i, r] of records.entries()) {
      const bad = enumViolations(r, req.mockApi.tags);
      if (bad.length) {
        const err = enumError(bad);
        if (many) err.message = `Record [${i}] (id ${r.id}): ${err.message}`;
        throw err;
      }
    }
    const clash = await req.ds.findAsync({ _id: { $in: [...ids] } }, { _id: 1 });
    if (clash.length) {
      return res.status(409).json({ error: `Record already exists: ${clash.map((c) => c._id).join(', ')}` });
    }
    await req.ds.insertAsync(records.map((r) => store.toDoc(req.mockApi, r)));
    res.status(201).json(many ? records : records[0]);
  })
);

// PATCH: JSON Patch (RFC 6902) or JSON Merge Patch (RFC 7396)
data.patch(
  '/:id',
  wrap(async (req, res) => {
    const id = req.params.id;
    const mode = detectMode(req);
    const result = await store.withLock(`${req.mockApi._id}/${id}`, async () => {
      const doc = await req.ds.findOneAsync({ _id: id });
      if (!doc) throw { status: 404, message: `Record ${id} not found` };
      const record = JSON.parse(doc.body);
      // list items may be addressed by id, unique key or index (?pathMode=index: index only)
      const keys = String(req.query.pathMode || '').toLowerCase() === 'index' ? null : uniqueKeys(req.mockApi.tags);
      const { doc: next, resolved } = applyPatch(record, req.body, mode, keys);
      if (resolved.length) {
        const h = JSON.stringify(resolved.map((r) => ({ [r.path]: r.resolvedPath })));
        if (h.length < 4000) res.set('X-Patch-Resolved', h);
      }
      if (!next || typeof next !== 'object' || Array.isArray(next)) {
        throw { status: 422, message: 'Patched document must remain a JSON object' };
      }
      if (String(next.id) !== id) throw { status: 400, message: 'The id of a record cannot be changed' };
      const bad = enumViolations(next, req.mockApi.tags, record);
      if (bad.length) throw enumError(bad);
      await req.ds.updateAsync({ _id: id }, store.toDoc(req.mockApi, next, doc), {});
      return next;
    });
    res.set('X-Patch-Mode', mode).json(result);
  })
);

// DELETE: remove a record
data.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = req.params.id;
    const n = await store.withLock(`${req.mockApi._id}/${id}`, () => req.ds.removeAsync({ _id: id }, {}));
    if (!n) return res.status(404).json({ error: `Record ${id} not found` });
    res.json({ deleted: id });
  })
);

/* ------------------------------------------------------------------ */
app.get('/health', (_req, res) => res.json({ ok: true, storage: store.remote.enabled ? `redis ${store.remote.describe()}` : `files ${store.DATA_DIR}` }));

// Serve the built portal when present (single-process production mode).
const DIST = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get(/^\/(?!apis?(\/|$)|admin(\/|$)|health$).*/, (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

// Anything else under /api, /apis or /admin -> JSON 404 (never an HTML error page)
app.use((req, res) => {
  res.status(404).json({
    error: `No route for ${req.method} ${req.path}`,
    hint: 'Data endpoints are /api/{name}/{version} and /api/{name}/{version}/{id}',
    registered: store.listApis().map((a) => a.basePath),
  });
});

// Errors
app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: `Invalid JSON body: ${err.message}` });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: `Body larger than ${BODY_LIMIT}` });
  const status = err?.status || 500;
  if (status >= 500) console.error(err);
  const { status: _s, message, ...rest } = err || {};
  res.status(status).json({ error: message || 'Internal error', ...rest });
});

/**
 * Optional demo data for hosts with temporary storage (Vercel, Render free):
 *   SEED_APIS="agreement@v1=samples/agreement.json;order@v2=samples/order.json"
 * Each API is registered and seeded from the file (path relative to the project root) if it doesn't exist yet.
 */
async function seedFromEnv() {
  const spec = process.env.SEED_APIS;
  if (!spec) return;
  const root = path.join(__dirname, '..', '..');
  for (const item of spec.split(/[;\n]/).map((x) => x.trim()).filter(Boolean)) {
    const m = item.match(/^([^@=]+)@([^=]+)=(.+)$/);
    if (!m) {
      console.warn(`SEED_APIS: ignoring "${item}" (expected name@version=path)`);
      continue;
    }
    const [, rawName, version, file] = m;
    const name = slugify(rawName);
    try {
      const api = (await store.createApi(name, version.trim())) || store.getApi(store.apiKey(name, version.trim()));
      if (api.hasSample) continue;
      const sample = JSON.parse(fs.readFileSync(path.resolve(root, file.trim()), 'utf8'));
      const { seeded } = await applySample(api, sample, asRecords(sample).filter((r) => r && typeof r === 'object'));
      console.log(`SEED_APIS: ${api.basePath} seeded with ${seeded} record(s)`);
    } catch (e) {
      console.warn(`SEED_APIS: ${item} failed – ${e.message}`);
    }
  }
}

// `ready` resolves once the registry is loaded (serverless hosts await it per request)
const ready = store.init().then(async () => {
  if (store.remote.enabled) {
    const n = await store.pull();
    console.log(`Remote store ${store.remote.describe()}: ${n} API(s) loaded`);
  }
  await seedFromEnv();
  await store.flush();
});

if (require.main === module) {
  ready.then(() => {
    app.listen(PORT, () => console.log(`Mock API server listening on http://localhost:${PORT}`));
  });
}

module.exports = { app, ready };
