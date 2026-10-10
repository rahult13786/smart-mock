// Tag (searchable path) helpers.
//
// Auto tags  : the 1st- and 2nd-level scalar paths of the sample, excluding arrays.
// Custom tags: any dotted path the user adds (may go deeper and may pass through arrays,
//              e.g. "characteristic.name" or "agreementItem.productOfferingPrice.priceType").
//              They are validated against the sample before they are saved.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isScalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

const DEFAULT_SEARCHABLE = new Set(['id', 'name', 'status']);
const TAG_TYPES = ['string', 'number', 'boolean'];

/** "a.b.c", "/a/b/c" or "a[].b" -> ["a","b","c"] */
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

/**
 * Resolve a path in a record. Arrays met on the way are flattened (every element is visited);
 * a numeric segment on an array selects that index.
 * Returns { found, values: [terminal values] }.
 */
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
  // a path ending on an array of scalars yields those scalars
  const values = cur.flatMap((v) => (Array.isArray(v) ? v : [v]));
  return { found: true, values };
}

/** Types of the scalar values found at `path` across the reference records. */
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

/** Every scalar path in the records (arrays flattened), with its type – used for suggestions. */
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

/** Paths whose last segment looks like `key` – for "did you mean" hints. */
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

/** Collect auto tags from up to `limit` sample records, keeping previous flags and custom tags. */
function computeTags(records, previous = [], limit = 50) {
  const prev = new Map(previous.map((t) => [t.path, t]));
  const found = new Map(); // path -> {path, level, type}
  for (const rec of records.slice(0, limit)) {
    if (!isObj(rec)) continue;
    for (const [k, v] of Object.entries(rec)) {
      if (Array.isArray(v)) continue;
      if (isScalar(v)) {
        if (!found.has(k)) found.set(k, { path: k, level: 1, type: typeOf(v) });
      } else if (isObj(v)) {
        for (const [k2, v2] of Object.entries(v)) {
          if (!isScalar(v2)) continue; // excludes arrays (and deeper objects)
          const p = `${k}.${k2}`;
          if (!found.has(p)) found.set(p, { path: p, level: 2, type: typeOf(v2) });
        }
      }
    }
  }
  const auto = [...found.values()].map((t) => ({
    ...t,
    searchable: prev.has(t.path) ? !!prev.get(t.path).searchable : DEFAULT_SEARCHABLE.has(t.path),
    ...(prev.get(t.path)?.enum ? { enum: prev.get(t.path).enum } : {}),
    ...(prev.get(t.path)?.unique ? { unique: true, uniqueIn: prev.get(t.path).uniqueIn } : {}),
  }));
  // keep custom tags that still exist in the new sample
  const kept = [];
  const dropped = [];
  for (const t of previous) {
    if (!t.custom || found.has(t.path)) continue;
    const info = inspectPath(records, t.path);
    if (info.found && info.types.length) kept.push(t);
    else dropped.push(t.path);
  }
  return { tags: withIdUnique([...auto, ...kept]), dropped };
}

/**
 * Validate tags against the sample. Returns [{path, ok, reason?, actualTypes?, suggestions?}]
 * A tag is valid when its path exists in the sample, ends on a value (not an object/array of
 * objects), and its declared type matches the type found in the sample.
 */
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

/**
 * The list a field belongs to: for "agreementItem.productOfferingPrice.name" the items of
 * "agreementItem.productOfferingPrice". Returns {listPath, itemsHaveId, idKey} (listPath null when the
 * field is not directly inside list items).
 */
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

/** Values of a unique field that occur more than once inside the same list instance. */
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

/** "id" / "x.id" / "a.b.Id" tags are always unique (the id is the key) – locked on. */
const isIdPath = (p) => /^id$/i.test(String(p).split('.').pop());
const withIdUnique = (tags) => tags.map((t) => (isIdPath(t.path) && !t.unique ? { ...t, unique: true } : t));

/** NeDB field names cannot contain "." or start with "$"; map a tag path to a safe key. */
function safeKey(p) {
  return p.replace(/%/g, '%25').replace(/\./g, '%2E').replace(/^\$/, '%24');
}

/** Lower-cased string values for every searchable tag – stored on the document for fast filtering. */
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

/** Root-level scalar fields only – used for list views so huge nested arrays are never sent. */
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
