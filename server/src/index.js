const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const store = require('./store');
const { computeTags, safeKey, validateTags, listPaths, inspectPath, suggest, normalizePath, splitPath, listContainer, duplicateKeys, isIdPath, withIdUnique } = require('./tags');
const { detectMode, applyPatch, uniqueKeys } = require('./patch');
const { enumViolations, enumError, normalizeEnum, locate } = require('./enums');
const accounts = require('./accounts');
const analytics = require('./analytics');
const { parseFields, project, parseSort, sortDocs, splitOperator } = require('./query');
const { idPaths, fieldPaths, buildMocks, currentValues, MAX_MOCKS } = require('./mockgen');
const { buildRegex, compileRegex, examples, fillIds, fillMissing, applyMaps, mapCandidates, mustViolations, mustError, tagPathOfPointer, createOn } = require('./generate');

const PORT = Number(process.env.PORT || 4000);
const BODY_LIMIT = process.env.BODY_LIMIT || '50mb';

const app = express();
app.use(cors({ exposedHeaders: ['Location', 'X-Array-Patch', 'X-Total-Count', 'X-Result-Count', 'X-Patch-Mode', 'X-Patch-Resolved', 'X-Search-Config-Updated', 'X-Not-Found-Ids'] }));
app.use(analytics.logger);
app.use(express.json({ limit: BODY_LIMIT, type: ['application/json', 'application/*+json'] }));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

if (store.remote.enabled) {
  let queue = Promise.resolve();
  app.use((req, res, next) => {
    if (!/^\/(api|apis|admin)(\/|$)/.test(req.path)) return next();
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

async function applySample(api, sample, records, seed = true) {
  for (const rec of records) if (rec.id == null || rec.id === '') rec.id = crypto.randomUUID();
  store.saveSample(api._id, sample);
  const { tags, dropped } = computeTags(records, api.tags);
  const searchKey = (list) => list.filter((t) => t.searchable).map((t) => t.path).sort().join('|');
  const updated = await store.updateApi(api._id, { hasSample: true, tags });
  if (dropped.length || searchKey(tags) !== searchKey(api.tags || [])) await store.reindex(updated);
  let seeded = 0;
  if (seed) {
    const ds = await store.getDatastore(api._id);
    for (const rec of records) {
      const existing = await ds.findOneAsync({ _id: String(rec.id) });
      const doc = store.toDoc(updated, rec, existing);
      await ds.updateAsync({ _id: doc._id }, doc, { upsert: true });
      seeded++;
    }
  }
  return { updated, seeded, dropped };
}
const parseMaybe = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

const admin = express.Router();

admin.get(
  '/apis',
  wrap(async (req, res) => {
    const list = await Promise.all(
      store
        .listApis()
        .filter((a) => accounts.canAccess(req.user, a))
        .map(async (a) => ({ ...a, recordCount: await store.countRecords(a._id) }))
    );
    res.json(list);
  })
);

async function scopeFor(user, body) {
  const env = String(body?.env || '').trim().toLowerCase();
  if (!accounts.ENVS.includes(env)) throw { status: 400, code: 'INVALID_ENV', message: `env must be one of ${accounts.ENVS.join(', ')}` };
  const scope = { env };
  const options = await accounts.userOptions();
  for (const k of accounts.USER_SCOPE) {
    const v = user.isAdmin ? String(body?.[k] || '').trim().toLowerCase() : user[k];
    if (!options[k].includes(v)) {
      throw {
        status: 400,
        code: 'INVALID_SCOPE',
        message: user.isAdmin ? `${k} must be one of ${options[k].join(', ')}` : `Your user's ${k} "${v || ''}" is not configured – ask smadmin to update your user`,
      };
    }
    scope[k] = v;
  }
  scope.group = ['domain', 'team', 'technology', 'role', 'env'].map((k) => scope[k]).join('-');
  return scope;
}

admin.post(
  '/apis',
  wrap(async (req, res) => {
    const name = slugify(req.body?.name);
    const version = String(req.body?.version || '').trim();
    if (!SLUG.test(name)) return res.status(400).json({ error: 'name is required (letters, digits, - or _)' });
    if (!VERSION.test(version)) return res.status(400).json({ error: 'version is required, e.g. v1 or 1.0' });
    const scope = await scopeFor(req.user, req.body);
    const api = await store.createApi(name, version, scope);
    if (!api) return res.status(409).json({ error: `API ${scope.group}/${name}/${version} is already registered`, code: 'API_EXISTS' });
    res.status(201).json(api);
  })
);

const findApi = (req, res) => {
  const api = store.getApi(req.params.key);
  if (!api) res.status(404).json({ error: 'API not registered' });
  else if (!accounts.canAccess(req.user, api)) {
    res.status(403).json({ error: 'You do not have access to this API', code: 'NO_ACCESS' });
    return null;
  }
  return api;
};

admin.get(
  '/apis/:key',
  wrap(async (req, res) => {
    const api = findApi(req, res);
    if (api) res.json({ ...api, recordCount: await store.countRecords(api._id) });
  })
);

admin.patch(
  '/apis/:key',
  wrap(async (req, res) => {
    const api = findApi(req, res);
    if (!api) return;
    const patch = {};
    if (req.body?.maxRecords !== undefined) {
      const max = Number(req.body.maxRecords);
      if (!Number.isInteger(max) || max < 1 || max > 100000) {
        throw { status: 400, code: 'INVALID_MAX_RECORDS', message: 'Max Records must be a whole number between 1 and 100000' };
      }
      patch.maxRecords = max;
    }
    if (req.body?.arraySync !== undefined) patch.arraySync = !!req.body.arraySync;
    if (!Object.keys(patch).length) throw { status: 400, message: 'Nothing to update – send maxRecords and/or arraySync' };
    const updated = await store.updateApi(api._id, patch);
    res.json({ ...updated, recordCount: await store.countRecords(api._id) });
  })
);

admin.get('/apis/:key/sample', (req, res) => {
  if (!findApi(req, res)) return;
  const s = store.readSample(req.params.key);
  if (s == null) return res.status(404).json({ error: 'No sample saved yet' });
  res.type('application/json').send(s);
});

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

admin.get(
  '/apis/:key/paths',
  wrap(async (req, res) => {
    const api = findApi(req, res);
    if (api) res.json(listPaths(await store.referenceRecords(api._id)));
  })
);

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
    const wanted = Number(req.body?.count) || 0;
    if (existing.size + wanted > api.maxRecords) throw limitError(api, existing.size, wanted);
    const { records, warnings } = buildMocks(template, req.body || {}, api.tags, existing);
    records.forEach((r, i) => {
      const bad = enumViolations(r, api.tags, template);
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

admin.get(
  '/apis/:key/tags/map',
  wrap(async (req, res) => {
    const api = findApi(req, res);
    if (!api) return;
    const p = normalizePath(req.query.path);
    if (!p) return res.status(400).json({ error: 'path is required' });
    if (isIdPath(p)) return res.status(400).json({ error: 'Id tags use a regex, not a map' });
    const tag = api.tags.find((t) => t.path === p);
    res.json({ path: p, candidates: mapCandidates(await store.referenceRecords(api._id), p, listPaths), map: tag?.map || null });
  })
);

admin.get(
  '/apis/:key/tags/regex',
  wrap(async (req, res) => {
    const api = findApi(req, res);
    if (!api) return;
    const p = normalizePath(req.query.path);
    if (!isIdPath(p)) return res.status(400).json({ error: 'A regex can only be configured for id tags' });
    const tag = api.tags.find((t) => t.path === p) || { path: p, type: 'string' };
    if (req.query.pattern !== undefined) {
      compileRegex(req.query.pattern);
      return res.json({ path: p, pattern: req.query.pattern, examples: examples(req.query.pattern, tag.type) });
    }
    const values = (await store.referenceRecords(api._id)).flatMap((r) => locate(r, p).map((x) => x.value));
    const built = buildRegex(values);
    res.json({ path: p, values: built.count, exact: built.exact, built: built.pattern, examples: built.pattern ? examples(built.pattern, tag.type) : [], regex: tag.regex || null });
  })
);

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
    tags = tags.map((t) => {
      const x = incoming.find((y) => y.path === t.path && !y.remove);
      if (!x || x.unique === undefined) return t;
      const { unique: _u, uniqueIn: _ui, ...rest } = t;
      return x.unique ? { ...rest, unique: true } : rest;
    });
    tags = withIdUnique(tags);
    const configRefs = await store.referenceRecords(api._id);
    tags = tags.map((t) => {
      const x = incoming.find((y) => y.path === t.path && !y.remove);
      if (!x) return t;
      let next = { ...t };
      if (x.must !== undefined) {
        if (x.must) next.must = true;
        else delete next.must;
      }
      if (x.create !== undefined) next.create = !!x.create;
      if (!isIdPath(t.path) && x.map !== undefined) {
        if (!x.map) delete next.map;
        else {
          const m = { enabled: !!x.map.enabled, source: normalizePath(x.map.source) };
          if (m.enabled || m.source) {
            const allowed = mapCandidates(configRefs, t.path, listPaths).map((c) => c.path);
            if (!allowed.includes(m.source)) {
              throw { status: 400, code: 'INVALID_MAP', message: `"${m.source || '(none)'}" cannot be mapped to "${t.path}" – choose a sibling field or a field of a parent node`, allowed };
            }
          }
          next.map = m;
        }
      }
      if (next.enum?.length && next.map) delete next.map;
      if (isIdPath(t.path)) {
        if (x.regex !== undefined) {
          if (!x.regex) delete next.regex;
          else {
            const r = { enabled: !!x.regex.enabled, override: !!x.regex.override, built: String(x.regex.built || ''), pattern: String(x.regex.pattern || '') };
            if (r.built) compileRegex(r.built, `Build regex of "${t.path}"`);
            if (r.override) compileRegex(r.pattern, `Override regex of "${t.path}"`);
            if (r.enabled && !(r.override ? r.pattern : r.built)) throw { status: 400, code: 'INVALID_REGEX', message: `Regex of "${t.path}" is empty – it cannot be enabled` };
            next.regex = r;
          }
        }
      }
      return next;
    });
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
          if (c.listPath !== null) {
            t.uniqueIn = c.listPath;
            const dups = duplicateKeys(refs, c.listPath, field);
            if (dups.length) uniqueWarnings.push({ path: t.path, duplicates: dups.slice(0, 5), count: dups.length });
          }
          continue;
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
    if (!findApi(req, res)) return;
    await store.deleteApi(req.params.key);
    res.status(204).end();
  })
);

app.use('/admin', accounts.authRouter);
app.use('/admin', accounts.authenticate);
app.use(['/admin/users', '/admin/configurations', '/admin/analytics', '/admin/access-requests'], accounts.requireAdmin);
app.use('/admin', accounts.router);
app.use('/admin', analytics.router);
app.use('/admin', admin);

const data = express.Router({ mergeParams: true });

function resolveApi(segs) {
  const dec = segs.map((x) => {
    try {
      return decodeURIComponent(x);
    } catch {
      return x;
    }
  });
  if (dec.length >= 3) {
    const api = store.getApi(store.apiKey(slugify(dec[1]), dec[2], dec[0].toLowerCase()));
    if (api) return { api, used: 3 };
  }
  if (dec.length >= 2) {
    const api = store.getApi(store.apiKey(slugify(dec[0]), dec[1]));
    if (api) return { api, used: 2 };
  }
  return null;
}

app.use(
  ['/api', '/apis'],
  wrap(async (req, res, next) => {
    const q = req.url.indexOf('?');
    const pathPart = q === -1 ? req.url : req.url.slice(0, q);
    const search = q === -1 ? '' : req.url.slice(q);
    const segs = pathPart.split('/').filter(Boolean);
    if (segs.length < 2) return next();
    const hit = resolveApi(segs);
    if (!hit) {
      return res.status(404).json({
        error: 'API not registered',
        path: `${req.baseUrl}${pathPart}`,
        registered: store.listApis().map((a) => a.basePath),
      });
    }
    req.mockApi = hit.api;
    req.ds = await store.getDatastore(hit.api._id);
    req.url = `/${segs.slice(hit.used).join('/')}${search}`;
    data(req, res, next);
  })
);

analytics.setResolver((url) => {
  const segs = String(url).split('?')[0].split('/').filter(Boolean).slice(1);
  const hit = segs.length >= 2 ? resolveApi(segs) : null;
  return hit ? hit.api : null;
});

function limitError(api, count, adding) {
  return {
    status: 422,
    code: 'RECORD_LIMIT_REACHED',
    message: `${api.basePath} has reached its limit of ${api.maxRecords} records (${count} stored${adding > 1 ? `, ${adding} more requested` : ''}) – raise "# records" in the API configuration or delete records`,
    limit: api.maxRecords,
    count,
  };
}

const RESERVED = new Set(['view', 'limit', 'skip', 'offset', 'q', 'mode', 'sort', 'fields', 'pathMode', 'generate']);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const splitList = (raw) =>
  (Array.isArray(raw) ? raw : [raw])
    .flatMap((v) => String(v).split(','))
    .map((v) => v.trim())
    .filter(Boolean);

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
      tags.push({ path: p, level: splitPath(p).length, type: info.types[0], searchable: true, custom: true, autoAdded: true, ...(p === 'id' ? { unique: true } : {}) });
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

async function storedRecords(ds, ids) {
  const docs = await ds.findAsync({ _id: { $in: ids } }, { body: 1 });
  const byId = new Map(docs.map((d) => [d._id, JSON.parse(d.body)]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) throw { status: 500, message: `Record ${missing.join(', ')} was not stored` };
  return ids.map((id) => byId.get(id));
}

const sendRecords = (res, bodies, fields) => {
  if (!fields) return res.type('application/json').send(`[${bodies.join(',')}]`);
  res.json(bodies.map((b) => project(JSON.parse(b), fields)));
};

const listRecords = wrap(async (req, res) => {
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
});

const getRecord = wrap(async (req, res) => {
  const doc = await req.ds.findOneAsync({ _id: req.params.id });
  if (!doc) return res.status(404).json({ error: `Record ${req.params.id} not found` });
  const fields = parseFields(req.query.fields);
  if (fields) return res.json(project(JSON.parse(doc.body), fields));
  res.type('application/json').send(doc.body);
});

data.head('/', listRecords);
data.get('/', listRecords);
data.head('/:id', getRecord);
data.get('/:id', getRecord);

data.post(
  '/',
  wrap(async (req, res) => {
    const body = req.body;
    const many = Array.isArray(body);
    const records = many ? body : [body];
    if (!records.length || records.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) {
      return res.status(400).json({ error: 'Body must be a JSON object or an array of JSON objects' });
    }
    const stored0 = await req.ds.countAsync({});
    if (stored0 + records.length > req.mockApi.maxRecords) throw limitError(req.mockApi, stored0, records.length);
    const generate = String(req.query.generate ?? '').toLowerCase() !== 'false';
    const tags = req.mockApi.tags;
    const refs = await store.referenceRecords(req.mockApi._id);
    const rootTag = tags.find((t) => t.path === 'id');
    const rootGenerated = generate && rootTag && createOn(rootTag);
    if (generate) {
      for (const [i, r] of records.entries()) {
        records[i] = fillIds(r, tags, { refs }).value;
        records[i] = fillMissing(records[i], tags, { refs }).value;
      }
    }
    if (rootGenerated) {
      for (const r of records) {
        for (let n = 0; n < 10 && (await req.ds.findOneAsync({ _id: String(r.id) })); n++) {
          r.id = fillIds({ id: r.id }, [rootTag], { refs }).value.id;
        }
      }
    }
    for (const [i, r] of records.entries()) {
      if (r.id == null || r.id === '') r.id = crypto.randomUUID();
      if (generate) records[i] = applyMaps(r, tags).value;
      const bad = mustViolations(records[i], tags, { refs });
      if (bad.length) throw mustError(bad, many ? `Record [${i}]: ` : '');
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
    const stored = await storedRecords(req.ds, records.map((r) => String(r.id)));
    if (!many) res.set('Location', `${req.mockApi.basePath}/${encodeURIComponent(stored[0].id)}`);
    res.status(201).json(many ? stored : stored[0]);
  })
);

async function patchContext(req) {
  const tags = req.mockApi.tags;
  const refs = await store.referenceRecords(req.mockApi._id);
  const generate = String(req.query.generate ?? '').toLowerCase() !== 'false';
  const keys = String(req.query.pathMode || '').toLowerCase() === 'index' ? null : uniqueKeys(tags);
  const onAdd = (op, current) => {
    const base = tagPathOfPointer(current, op.path);
    let value = op.value;
    if (generate) {
      value = fillIds(structuredClone(value), tags, { base, doc: current, refs, skipRoot: true }).value;
      value = fillMissing(value, tags, { base, refs }).value;
      value = applyMaps(value, tags, { base, pointer: op.path, doc: current }).value;
    }
    const bad = mustViolations(value, tags, { base, pointer: op.path, refs });
    if (bad.length) throw mustError(bad);
    return value;
  };
  return { keys, onAdd, sync: !!req.mockApi.arraySync };
}

function patchOne(req, ctx, doc, body, mode, label = '') {
  const record = JSON.parse(doc.body);
  const id = doc._id;
  let out;
  try {
    out = applyPatch(record, body, mode, ctx.keys, ctx.onAdd, { sync: ctx.sync });
  } catch (e) {
    if (label && e && e.message) e.message = `${label}${e.message}`;
    throw e;
  }
  const next = out.doc;
  if (!next || typeof next !== 'object' || Array.isArray(next)) {
    throw { status: 422, message: `${label}Patched document must remain a JSON object` };
  }
  if (String(next.id) !== id) throw { status: 400, message: `${label}The id of a record cannot be changed` };
  const bad = enumViolations(next, req.mockApi.tags, record);
  if (bad.length) {
    const err = enumError(bad);
    err.message = `${label}${err.message}`;
    throw err;
  }
  return { next, resolved: out.resolved };
}

data.patch(
  '/:id',
  wrap(async (req, res) => {
    const id = req.params.id;
    const mode = detectMode(req);
    const ctx = await patchContext(req);
    const result = await store.withLock(`${req.mockApi._id}/${id}`, async () => {
      const doc = await req.ds.findOneAsync({ _id: id });
      if (!doc) throw { status: 404, message: `Record ${id} not found` };
      const { next, resolved } = patchOne(req, ctx, doc, req.body, mode);
      if (resolved.length) {
        const h = JSON.stringify(resolved.map((r) => ({ [r.path]: r.resolvedPath })));
        if (h.length < 4000) res.set('X-Patch-Resolved', h);
      }
      await req.ds.updateAsync({ _id: id }, store.toDoc(req.mockApi, next, doc), {});
      return (await storedRecords(req.ds, [id]))[0];
    });
    const fields = parseFields(req.query.fields);
    res.set('X-Patch-Mode', mode).set('X-Array-Patch', ctx.sync ? 'sync' : 'merge').json(fields ? project(result, fields) : result);
  })
);

data.patch(
  '/',
  wrap(async (req, res) => {
    const body = req.body;
    const many = Array.isArray(body);
    const items = many ? body : [body];
    if (String(req.headers['content-type'] || '').includes('json-patch+json')) {
      throw { status: 400, code: 'JSON_PATCH_NEEDS_ID', message: 'JSON Patch (application/json-patch+json) needs the record id in the URL; send records (with their id) as JSON or merge-patch+json to patch several records' };
    }
    if (!items.length || items.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) {
      throw { status: 400, message: 'Body must be a record or an array of records, each with its id' };
    }
    const ids = items.map((r, i) => {
      if (r.id === undefined || r.id === null || r.id === '') throw { status: 400, code: 'ID_REQUIRED', message: `Record [${i}] has no "id" – the id identifies the record to update` };
      return String(r.id);
    });
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dup) throw { status: 400, message: `Duplicate id ${dup} in request` };
    const ctx = await patchContext(req);
    const result = await store.withLock(`${req.mockApi._id}/*patch`, async () => {
      const docs = await req.ds.findAsync({ _id: { $in: ids } });
      const byId = new Map(docs.map((d) => [d._id, d]));
      const missing = ids.filter((id) => !byId.has(id));
      if (missing.length) throw { status: 404, code: 'RECORD_NOT_FOUND', message: `Record${missing.length === 1 ? '' : 's'} not found: ${missing.join(', ')}`, notFound: missing };
      const updates = items.map((item, i) => {
        const doc = byId.get(ids[i]);
        return { doc, next: patchOne(req, ctx, doc, item, 'merge', many ? `Record [${i}] (id ${ids[i]}): ` : '').next };
      });
      for (const { doc, next } of updates) await req.ds.updateAsync({ _id: doc._id }, store.toDoc(req.mockApi, next, doc), {});
      return storedRecords(req.ds, ids);
    });
    const fields = parseFields(req.query.fields);
    const out = fields ? result.map((r) => project(r, fields)) : result;
    res.set('X-Patch-Mode', 'merge').set('X-Array-Patch', ctx.sync ? 'sync' : 'merge').json(many ? out : out[0]);
  })
);

data.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = req.params.id;
    const n = await store.withLock(`${req.mockApi._id}/${id}`, () => req.ds.removeAsync({ _id: id }, {}));
    if (!n) return res.status(404).json({ error: `Record ${id} not found` });
    res.json({ deleted: id });
  })
);

app.get('/health', (_req, res) => res.json({ ok: true, storage: store.remote.enabled ? `redis ${store.remote.describe()}` : `files ${store.DATA_DIR}` }));

const DIST = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get(/^\/(?!apis?(\/|$)|admin(\/|$)|health$).*/, (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

app.use((req, res) => {
  res.status(404).json({
    error: `No route for ${req.method} ${req.path}`,
    hint: 'Data endpoints are /api/{basePath}/{name}/{version} and /api/{basePath}/{name}/{version}/{id}',
    registered: store.listApis().map((a) => a.basePath),
  });
});

app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: `Invalid JSON body: ${err.message}` });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: `Body larger than ${BODY_LIMIT}` });
  const status = err?.status || 500;
  if (status >= 500) console.error(err);
  const { status: _s, message, ...rest } = err || {};
  res.status(status).json({ error: message || 'Internal error', ...rest });
});

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
    const [groupPart, namePart] = rawName.includes('/') ? rawName.split('/') : [null, rawName];
    const name = slugify(namePart);
    let scope = null;
    if (groupPart) {
      const parts = groupPart.trim().toLowerCase().split('-');
      const [domain, team, technology, role, env] = parts;
      scope = { domain, team, technology, role, env, group: parts.join('-') };
    }
    try {
      const api = (await store.createApi(name, version.trim(), scope)) || store.getApi(store.apiKey(name, version.trim(), scope?.group));
      if (api.hasSample) continue;
      const sample = JSON.parse(fs.readFileSync(path.resolve(root, file.trim()), 'utf8'));
      const { seeded } = await applySample(api, sample, asRecords(sample).filter((r) => r && typeof r === 'object'));
      console.log(`SEED_APIS: ${api.basePath} seeded with ${seeded} record(s)`);
    } catch (e) {
      console.warn(`SEED_APIS: ${item} failed – ${e.message}`);
    }
  }
}

const ready = store.init().then(async () => {
  if (store.remote.enabled) {
    const n = await store.pull();
    console.log(`Remote store ${store.remote.describe()}: ${n} API(s) loaded`);
  }
  await seedFromEnv();
  await store.flush();
});

if (require.main === module) {
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.once(sig, () => {
      analytics
        .persist()
        .catch(() => {})
        .finally(() => process.exit(0));
    });
  }
  ready.then(
    () => app.listen(PORT, () => console.log(`Mock API server listening on http://localhost:${PORT}`)),
    (e) => {
      console.error(`Startup failed: ${e.message}`);
      if (e.code === 'EACCES') {
        console.error(
          `The data folder ${store.DATA_DIR} is not writable for this user (uid ${process.getuid?.()}, gid ${process.getgid?.()}). ` +
            'On OpenShift: make the volume group-writable (fsGroup) or run e.g. `chmod -R g+rwX` on it from a debug pod.'
        );
      }
      process.exit(1);
    }
  );
}

module.exports = { app, ready };
