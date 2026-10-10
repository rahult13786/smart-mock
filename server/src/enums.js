// Enum (allowed values) support for tags.
// A tag may carry `enum: [..]`. On POST / PATCH every value found at the tag's path must be one
// of the allowed values (null / missing values are allowed – enum restricts what is sent, not presence).
const { splitPath, isObj, isScalar } = require('./tags');

const esc = (s) => String(s).replace(/~/g, '~0').replace(/\//g, '~1');

/** All concrete locations of a dotted tag path in a record: [{pointer, value}] (arrays are walked). */
function locate(record, path) {
  const segs = splitPath(path);
  let cur = [{ pointer: '', value: record }];
  for (const seg of segs) {
    const next = [];
    for (const { pointer, value } of cur) {
      if (Array.isArray(value)) {
        if (/^\d+$/.test(seg)) {
          if (value[+seg] !== undefined) next.push({ pointer: `${pointer}/${seg}`, value: value[+seg] });
        } else {
          value.forEach((el, i) => {
            if (isObj(el) && Object.prototype.hasOwnProperty.call(el, seg)) next.push({ pointer: `${pointer}/${i}/${esc(seg)}`, value: el[seg] });
          });
        }
      } else if (isObj(value) && Object.prototype.hasOwnProperty.call(value, seg)) {
        next.push({ pointer: `${pointer}/${esc(seg)}`, value: value[seg] });
      }
    }
    cur = next;
    if (!cur.length) return [];
  }
  // a path ending on a list of scalars -> every element
  return cur.flatMap((c) => (Array.isArray(c.value) ? c.value.map((v, i) => ({ pointer: `${c.pointer}/${i}`, value: v })) : [c]));
}

function getByPointer(doc, pointer) {
  if (!pointer) return doc;
  let cur = doc;
  for (const raw of pointer.split('/').slice(1)) {
    const seg = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[Array.isArray(cur) ? Number(seg) : seg];
  }
  return cur;
}

const allowed = (tag, v) => v === null || v === undefined || tag.enum.some((e) => e === v);

/**
 * Enum violations in `record`. With `before` (PATCH), only values that were not stored at that path
 * already are reported, so data stored before an enum was defined does not block other updates.
 */
function enumViolations(record, tags, before) {
  const out = [];
  for (const tag of tags) {
    if (!Array.isArray(tag.enum) || !tag.enum.length) continue;
    // values already stored at this path (PATCH) – re-ordering / deleting items must not fail on legacy values
    const existing = before !== undefined ? new Set(locate(before, tag.path).map((x) => JSON.stringify(x.value))) : null;
    for (const { pointer, value } of locate(record, tag.path)) {
      if (!isScalar(value) && value !== undefined) {
        out.push({ path: pointer, tag: tag.path, value, allowed: tag.enum, reason: 'expected one of the allowed values, got an object/list' });
        continue;
      }
      if (allowed(tag, value)) continue;
      if (existing && existing.has(JSON.stringify(value))) continue; // value was already stored (unchanged)
      out.push({ path: pointer, tag: tag.path, value, allowed: tag.enum });
    }
  }
  return out;
}

function enumError(violations) {
  const first = violations[0];
  const list = (a) => a.map((v) => JSON.stringify(v)).join(', ');
  return {
    status: 422,
    code: 'ENUM_VIOLATION',
    message:
      `Wrong data sent on path "${first.path}": ${JSON.stringify(first.value)} is not allowed for "${first.tag}". ` +
      `Allowed values: ${list(first.allowed)}` +
      (violations.length > 1 ? ` (and ${violations.length - 1} more)` : ''),
    violations: violations.slice(0, 50),
  };
}

/** Clean an enum definition for a tag of `type`. Returns array (possibly empty) or throws. */
function normalizeEnum(values, type, path) {
  if (values == null) return undefined;
  if (!Array.isArray(values)) throw { status: 400, message: `enum of "${path}" must be an array` };
  const out = [];
  for (const raw of values) {
    let v = raw;
    if (type === 'number' && typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) v = Number(v);
    if (type === 'boolean' && (v === 'true' || v === 'false')) v = v === 'true';
    if (type && typeof v !== type) {
      throw { status: 400, code: 'ENUM_TYPE', message: `enum value ${JSON.stringify(raw)} of "${path}" is not a ${type}` };
    }
    if (typeof v === 'string' && v === '') continue;
    if (!out.includes(v)) out.push(v);
  }
  if (out.length > 1000) throw { status: 400, message: `enum of "${path}" has more than 1000 values` };
  return out;
}

module.exports = { locate, enumViolations, enumError, normalizeEnum, getByPointer };
