// TMF630-style query helpers: attribute selection (fields), sorting, filter operators.
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/* ---------- fields ---------------------------------------------------------------------------
 * ?fields=id,name,item.id,item.status,tags
 * Returns only the listed attributes. Dotted paths select inside objects and inside every element
 * of a list. "id" is always returned (TMF630). Unknown attributes are simply not present.
 */
function parseFields(raw) {
  if (raw == null || raw === '') return null;
  const list = (Array.isArray(raw) ? raw : [raw])
    .flatMap((s) => String(s).split(','))
    .map((s) => s.trim())
    .filter(Boolean);
  if (!list.length) return null;
  const tree = { id: true };
  for (const p of list) {
    const segs = p.replace(/^\$\.?/, '').replace(/\[\d*\]/g, '').split('.').filter(Boolean);
    let node = tree;
    segs.forEach((seg, i) => {
      if (i === segs.length - 1) node[seg] = true; // whole value
      else {
        if (node[seg] === true) return; // parent already fully selected
        node[seg] = node[seg] || {};
        node = node[seg];
      }
    });
  }
  return tree;
}

function project(value, tree) {
  if (tree === true) return value;
  if (Array.isArray(value)) return value.map((el) => project(el, tree));
  if (!isObj(value)) return undefined;
  const out = {};
  for (const [k, sub] of Object.entries(tree)) {
    if (!Object.prototype.hasOwnProperty.call(value, k)) continue;
    const v = project(value[k], sub);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/* ---------- sort -----------------------------------------------------------------------------
 * ?sort=-updatedAt,name     "-" = descending, "+" or nothing = ascending
 * A key is read from the record (dotted paths allowed); updatedAt / createdAt fall back to the time
 * the record was stored / last changed in the mock when the record has no such field.
 */
function parseSort(raw) {
  if (raw == null || raw === '') return null;
  const keys = (Array.isArray(raw) ? raw : [raw])
    .flatMap((s) => String(s).split(','))
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ({ desc: s.startsWith('-'), path: s.replace(/^[-+ ]/, '') }));
  return keys.length ? keys : null;
}

const META = new Set(['updatedAt', 'createdAt', 'lastUpdate', 'lastModified']);

function getPath(obj, path) {
  let cur = obj;
  for (const seg of path.split('.')) {
    if (Array.isArray(cur)) cur = cur[0]; // lists: the first item decides
    if (!isObj(cur)) return undefined;
    cur = cur[seg];
  }
  return Array.isArray(cur) ? cur[0] : cur;
}

/** value used to sort `doc` (stored document) by `path` */
function sortValue(doc, record, path) {
  const v = path.includes('.') ? getPath(record, path) : (doc.summary || {})[path];
  if (v !== undefined && v !== null) return v;
  if (META.has(path)) return path === 'createdAt' ? doc.createdAt : doc.updatedAt;
  return undefined;
}

function compareValues(a, b) {
  if (a === undefined || a === null) return b === undefined || b === null ? 0 : 1; // empty last
  if (b === undefined || b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const na = Number(a);
  const nb = Number(b);
  if (a !== '' && b !== '' && !Number.isNaN(na) && !Number.isNaN(nb) && typeof a !== 'boolean') return na - nb;
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
}

function sortDocs(docs, keys, recordOf) {
  return docs
    .map((d, i) => ({ d, i, r: recordOf(d) }))
    .sort((x, y) => {
      for (const k of keys) {
        const c = compareValues(sortValue(x.d, x.r, k.path), sortValue(y.d, y.r, k.path));
        if (c) return k.desc ? -c : c;
      }
      return x.i - y.i;
    })
    .map((x) => x.d);
}

/* ---------- filter operators ------------------------------------------------------------------
 * status=Active           equality (case-insensitive); "a,b" = a OR b
 * status.eq=Active        same
 * name.like=agree         contains (case-insensitive)
 * status.ne=Closed        not equal
 */
const OPS = new Set(['eq', 'ne', 'like']);
function splitOperator(key) {
  const i = key.lastIndexOf('.');
  if (i > 0 && OPS.has(key.slice(i + 1))) return { path: key.slice(0, i), op: key.slice(i + 1) };
  return { path: key, op: 'eq' };
}

module.exports = { parseFields, project, parseSort, sortDocs, splitOperator };
