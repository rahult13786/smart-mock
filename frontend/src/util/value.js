export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const isScalar = (v) => v === null || v === undefined || ['string', 'number', 'boolean'].includes(typeof v);

/** "stcAgreementBusinessId" -> "Stc Agreement Business Id", "@referredType" -> "@referred Type" */
export function humanize(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

export function getIn(obj, path) {
  let cur = obj;
  for (const p of path) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/** Immutable set with structural sharing – only the nodes along `path` are copied. */
export function setIn(obj, path, value) {
  if (!path.length) return value;
  const [head, ...rest] = path;
  const copy = Array.isArray(obj) ? obj.slice() : { ...obj };
  copy[head] = setIn(obj?.[head], rest, value);
  return copy;
}

/** Union of keys across rows, in first-seen order (scans at most `max` rows). */
export function columnsOf(rows, max = 300) {
  const seen = new Set();
  for (const r of rows.slice(0, max)) if (isObj(r)) Object.keys(r).forEach((k) => seen.add(k));
  return [...seen];
}

export function summarize(v) {
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`;
  if (isObj(v)) {
    const label = v.name ?? v['@referredType'] ?? v['@type'] ?? v.id;
    const n = Object.keys(v).length;
    return label != null && isScalar(label) ? String(label) : `${n} field${n === 1 ? '' : 's'}`;
  }
  return v === null || v === undefined ? '' : String(v);
}

/** RFC 7396 merge patch that turns `from` into `to` (arrays are replaced wholesale). */
export function createMergePatch(from, to) {
  if (!isObj(from) || !isObj(to)) return to;
  const patch = {};
  for (const k of Object.keys(from)) if (!(k in to)) patch[k] = null;
  for (const [k, v] of Object.entries(to)) {
    if (!(k in from)) patch[k] = v;
    else if (from[k] !== v) {
      if (isObj(from[k]) && isObj(v)) {
        const sub = createMergePatch(from[k], v);
        if (Object.keys(sub).length) patch[k] = sub;
      } else if (JSON.stringify(from[k]) !== JSON.stringify(v)) patch[k] = v;
    }
  }
  return patch;
}

/** Parse text typed into a scalar input, keeping the original type where possible. */
export function coerce(text, original) {
  if (typeof original === 'number') {
    if (text.trim() === '') return null;
    const n = Number(text);
    return Number.isNaN(n) ? text : n;
  }
  if (typeof original === 'boolean') return text === 'true';
  if (original === null && text === '') return null;
  return text;
}

/** "v1" -> "v2", "1.0" -> "1.1", "beta" -> "beta-2"; skips versions already taken. */
export function nextVersion(version, taken = []) {
  const bump = (v) => {
    const m = String(v).match(/^(.*?)(\d+)(\D*)$/);
    return m ? `${m[1]}${Number(m[2]) + 1}${m[3]}` : `${v}-2`;
  };
  let v = bump(version);
  while (taken.includes(v)) v = bump(v);
  return v;
}

/** JSON Pointer (RFC 6901) for a path array, e.g. ["a", 0, "b/c"] -> "/a/0/b~1c" */
export const toPointer = (path) => path.map((p) => '/' + String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('');

const typeName = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const isEmpty = (v) => v === undefined || v === null || v === '' || (isObj(v) && !Object.keys(v).length);

/**
 * Structure of an existing list, used to build the "add item" form and to validate new items.
 *  kind: 'object' | 'scalar' | 'empty'
 *  fields: [{key, types:[...], kind:'scalar'|'object'|'array', common, constant?}]
 *  common: keys filled in at least 75% of the items – the criteria a new item must meet
 */
const COMMON_RATIO = 0.75;

export function listShape(rows) {
  const items = rows.filter((r) => r !== undefined);
  if (!items.length) return { kind: 'empty', fields: [], common: [] };
  if (items.every((r) => !isObj(r))) {
    return { kind: 'scalar', types: [...new Set(items.map(typeName))], fields: [], common: [] };
  }
  const objs = items.filter(isObj).slice(0, 500);
  if (objs.every((o) => !Object.keys(o).length)) return { kind: 'empty', fields: [], common: [] }; // e.g. [{}]
  const fields = new Map();
  for (const o of objs) {
    for (const [k, v] of Object.entries(o)) {
      if (!fields.has(k)) fields.set(k, { key: k, types: new Set(), count: 0, values: new Set() });
      const f = fields.get(k);
      if (!isEmpty(v)) f.count++;
      f.types.add(typeName(v));
      if (isScalar(v) && f.values.size < 3) f.values.add(v);
    }
  }
  const nonEmpty = objs.filter((o) => Object.keys(o).length);
  const out = [...fields.values()].map((f) => {
    const types = [...f.types].filter((t) => t !== 'null');
    const kind = types.includes('object') ? 'object' : types.includes('array') ? 'array' : 'scalar';
    return {
      key: f.key,
      types,
      kind,
      // "common" = used by (almost) every item; a tolerance keeps the criteria stable
      // when a few sparse items have been added over time
      common: nonEmpty.length > 0 && f.count >= Math.max(1, Math.ceil(nonEmpty.length * COMMON_RATIO)),
      // e.g. "@type": "CharacteristicValue" on every item -> prefilled in the form
      constant: f.values.size === 1 && f.count === nonEmpty.length && f.key.startsWith('@') ? [...f.values][0] : undefined,
    };
  });
  return { kind: 'object', fields: out, common: out.filter((f) => f.common).map((f) => f.key) };
}

/**
 * Check new items against the list they are added to.
 * Rule: an object must contain at least one of the keys every existing item has (the "common tags");
 * when the items have no key in common, at least one key that the list already uses.
 * Returns {errors:[], warnings:[], newKeys:[]}.
 */
export function validateNewItems(items, rows) {
  const shape = listShape(rows);
  const errors = [];
  const warnings = [];
  const newKeys = new Set();
  items.forEach((item, i) => {
    const label = items.length > 1 ? `Item [${i}]: ` : '';
    if (shape.kind === 'empty') {
      if (isEmpty(item)) errors.push(`${label}the item is empty`);
      return;
    }
    if (shape.kind === 'scalar') {
      if (!isScalar(item) || item === null || item === '') errors.push(`${label}this list holds plain values – enter a ${shape.types.join(' / ')}`);
      else if (!shape.types.includes(typeName(item))) warnings.push(`${label}existing values are ${shape.types.join(' / ')}, this one is ${typeName(item)}`);
      return;
    }
    if (!isObj(item)) {
      errors.push(`${label}this list holds objects – enter a JSON object`);
      return;
    }
    const known = shape.fields.map((f) => f.key);
    const criteria = shape.common.length ? shape.common : known;
    const filled = criteria.filter((k) => !isEmpty(item[k]));
    if (!criteria.length) {
      if (!Object.keys(item).length) errors.push(`${label}the item is empty`);
    } else if (!filled.length) {
      errors.push(`${label}at least one of ${criteria.map((k) => `"${k}"`).join(' or ')} must be filled`);
    }
    for (const [k, v] of Object.entries(item)) {
      const f = shape.fields.find((x) => x.key === k);
      if (!f) newKeys.add(k);
      else if (v !== null && f.types.length && !f.types.includes(typeName(v))) {
        warnings.push(`${label}"${k}" is ${typeName(v)} here but ${f.types.join(' / ')} in existing items`);
      }
    }
  });
  return { errors, warnings, newKeys: [...newKeys] };
}

/** Immutable remove: list items are spliced out, object keys deleted. */
export function removeIn(obj, path) {
  if (path.length === 1) {
    const [k] = path;
    if (Array.isArray(obj)) return obj.filter((_, i) => i !== k);
    const { [k]: _gone, ...rest } = obj;
    return rest;
  }
  const [head, ...rest] = path;
  const copy = Array.isArray(obj) ? obj.slice() : { ...obj };
  copy[head] = removeIn(obj[head], rest);
  return copy;
}

/** Concrete path ["characteristic", 3, "name"] -> tag path "characteristic.name" */
export const tagPathOf = (path) => path.filter((p) => typeof p !== 'number').join('.');
