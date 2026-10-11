const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isScalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

const TAG_TYPES = ['string', 'number', 'boolean'];

function splitPath(p) {
  return String(p || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\[\]/g, '')
    .split(/[./]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
const normalizePath = (p) => splitPath(p).join('.');

function resolve(record, path) {
  const segs = Array.isArray(path) ? path : splitPath(path);
  let cur = [record];
  for (const seg of segs) {
    const next = [];
    for (const node of cur) {
      if (Array.isArray(node)) {
        if (/^\d+$/.test(seg)) {
          if (node[+seg] !== undefined) next.push(node[+seg]);
        } else {
          for (const el of node) if (isObj(el) && Object.prototype.hasOwnProperty.call(el, seg)) next.push(el[seg]);
        }
      } else if (isObj(node) && Object.prototype.hasOwnProperty.call(node, seg)) {
        next.push(node[seg]);
      }
    }
    cur = next;
    if (!cur.length) return { found: false, values: [] };
  }
  const values = cur.flatMap((v) => (Array.isArray(v) ? v : [v]));
  return { found: true, values };
}

function inspectPath(records, path) {
  const types = new Set();
  let found = false;
  let nonScalar = false;
  for (const r of records) {
    const res = resolve(r, path);
    if (!res.found) continue;
    found = true;
    for (const v of res.values) {
      if (isScalar(v)) {
        if (v !== null) types.add(typeOf(v));
      } else nonScalar = true;
    }
  }
  return { found, types: [...types], nonScalar: nonScalar && types.size === 0 };
}

function listPaths(records, { maxDepth = 6, limit = 2000, scan = 20 } = {}) {
  const out = new Map();
  const walk = (node, prefix, depth) => {
    if (out.size >= limit || depth > maxDepth) return;
    if (Array.isArray(node)) {
      for (const el of node.slice(0, scan)) walk(el, prefix, depth);
      return;
    }
    if (isObj(node)) {
      for (const [k, v] of Object.entries(node)) walk(v, prefix ? `${prefix}.${k}` : k, depth + 1);
      return;
    }
    if (prefix && node !== null && !out.has(prefix)) out.set(prefix, typeOf(node));
  };
  for (const r of records.slice(0, 50)) walk(r, '', 0);
  return [...out.entries()].map(([path, type]) => ({ path, type }));
}

function suggest(records, key, max = 8) {
  const k = String(key).toLowerCase().replace(/^@/, '');
  if (!k) return [];
  const last = (p) => p.split('.').pop().toLowerCase().replace(/^@/, '');
  return listPaths(records)
    .map((x) => x.path)
    .filter((p) => last(p).includes(k) || p.toLowerCase().includes(k))
    .sort((a, b) => (last(a) === k ? -1 : 0) - (last(b) === k ? -1 : 0) || a.length - b.length)
    .slice(0, max);
}

function idTagsOf(records, limit = 50) {
  const found = new Map();
  const walk = (node, segs) => {
    if (Array.isArray(node)) return node.slice(0, 200).forEach((el) => walk(el, segs));
    if (!isObj(node)) return;
    for (const [k, v] of Object.entries(node)) {
      const p = [...segs, k];
      if (isIdPath(k) && isScalar(v) && v !== null) {
        const path = p.join('.');
        if (!found.has(path)) found.set(path, { path, level: p.length, type: typeOf(v) });
      }
      if (v && typeof v === 'object') walk(v, p);
    }
  };
  for (const rec of records.slice(0, limit)) walk(rec, []);
  return [...found.values()].sort((a, b) => a.level - b.level);
}

const configured = (t) => t.custom || t.searchable || t.must || (t.enum && t.enum.length) || (t.unique && !isIdPath(t.path));

function computeTags(records, previous = [], limit = 50) {
  const prev = new Map(previous.map((t) => [t.path, t]));
  const ids = idTagsOf(records, limit).map((t) => {
    const p = prev.get(t.path) || {};
    const { custom: _c, autoAdded: _a, ...rest } = p;
    return {
      ...rest,
      ...t,
      searchable: p.searchable !== undefined ? !!p.searchable : t.path === 'id',
      create: p.create !== undefined ? !!p.create : t.path === 'id',
    };
  });
  const idSet = new Set(ids.map((t) => t.path));
  const kept = [];
  const dropped = [];
  for (const t of previous) {
    if (idSet.has(t.path)) continue;
    if (isIdPath(t.path) || !configured(t)) {
      if (t.custom || isIdPath(t.path)) dropped.push(t.path);
      continue;
    }
    const info = inspectPath(records, t.path);
    if (info.found && info.types.length) kept.push(t);
    else dropped.push(t.path);
  }
  return { tags: withIdUnique([...ids, ...kept]), dropped };
}

function validateTags(records, tags) {
  return tags.map((t) => {
    const path = normalizePath(t.path);
    if (!path) return { path: t.path, ok: false, reason: 'Path is empty' };
    if (t.type && !TAG_TYPES.includes(t.type)) {
      return { path, ok: false, reason: `Type must be one of ${TAG_TYPES.join(', ')}` };
    }
    const info = inspectPath(records, path);
    if (!info.found) {
      return { path, ok: false, code: 'PATH_NOT_IN_SAMPLE', reason: `Path "${path}" does not exist in the sample`, suggestions: suggest(records, path.split('.').pop()) };
    }
    if (!info.types.length) {
      return { path, ok: false, code: 'NOT_A_VALUE', reason: `Path "${path}" points to an object or list, not a value – choose a field inside it`, suggestions: listPaths(records).map((x) => x.path).filter((p) => p.startsWith(`${path}.`)).slice(0, 8) };
    }
    if (t.type && !info.types.includes(t.type)) {
      return { path, ok: false, code: 'TYPE_MISMATCH', reason: `Type "${t.type}" does not match the sample (found ${info.types.join(' / ')})`, actualTypes: info.types };
    }
    return { path, ok: true, actualTypes: info.types };
  });
}

function listContainer(records, path) {
  const segs = splitPath(path);
  if (segs.length < 2) return { listPath: null, itemsHaveId: false };
  const prefix = segs.slice(0, -1);
  let nodes = records.slice(0, 50);
  for (const seg of prefix) {
    const next = [];
    for (const n of nodes) {
      if (Array.isArray(n)) {
        for (const el of n) if (isObj(el) && seg in el) next.push(el[seg]);
      } else if (isObj(n) && seg in n) next.push(n[seg]);
    }
    nodes = next;
  }
  const lists = nodes.filter(Array.isArray);
  if (!lists.length) return { listPath: null, itemsHaveId: false };
  let idKey = null;
  for (const l of lists) for (const el of l) if (isObj(el) && !idKey) idKey = Object.keys(el).find((k) => /^id$/i.test(k)) || null;
  return { listPath: prefix.join('.'), itemsHaveId: !!idKey, idKey };
}

function duplicateKeys(records, listPath, field) {
  const dups = new Set();
  const walk = (node, segs) => {
    if (!segs.length) {
      if (!Array.isArray(node)) return;
      const seen = new Set();
      for (const el of node) {
        if (!isObj(el) || el[field] == null || typeof el[field] === 'object') continue;
        const k = String(el[field]);
        if (seen.has(k)) dups.add(k);
        seen.add(k);
      }
      return;
    }
    const [seg, ...rest] = segs;
    if (Array.isArray(node)) node.forEach((el) => isObj(el) && seg in el && walk(el[seg], rest));
    else if (isObj(node) && seg in node) walk(node[seg], rest);
  };
  for (const r of records) walk(r, splitPath(listPath));
  return [...dups];
}

const isIdPath = (p) => /^id$/i.test(String(p).split('.').pop());
const withIdUnique = (tags) => tags.map((t) => (t.path === 'id' && !t.unique ? { ...t, unique: true } : t));

function safeKey(p) {
  return p.replace(/%/g, '%25').replace(/\./g, '%2E').replace(/^\$/, '%24');
}

function computeIndex(record, tags) {
  const idx = {};
  for (const t of tags) {
    if (!t.searchable) continue;
    const vals = resolve(record, t.path)
      .values.filter((v) => v !== null && v !== undefined && isScalar(v))
      .map((v) => String(v).toLowerCase());
    if (vals.length) idx[safeKey(t.path)] = [...new Set(vals)];
  }
  return idx;
}

function rootSummary(record) {
  const s = {};
  for (const [k, v] of Object.entries(record)) if (isScalar(v)) s[k] = v;
  return s;
}

module.exports = {
  computeTags,
  computeIndex,
  rootSummary,
  safeKey,
  isObj,
  isScalar,
  resolve,
  inspectPath,
  listPaths,
  suggest,
  validateTags,
  listContainer,
  duplicateKeys,
  isIdPath,
  withIdUnique,
  normalizePath,
  splitPath,
  TAG_TYPES,
};
