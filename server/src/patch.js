// PATCH support: RFC 6902 JSON Patch and RFC 7396 JSON Merge Patch,
// extended so list items can be addressed by id or by a configured unique key instead of the index.
//
//   /agreementItem/MSA-117198-061026-1-2/productOfferingPrice/1/price/value
//
// Each segment that steps into a list is resolved in this order:
//   1. id      – the item whose "id" / "Id" / "ID" equals the segment
//   2. unique  – the item whose configured unique field (tag marked "unique") equals the segment
//   3. index   – the segment as a 0-based position
// `?pathMode=index` turns the lookup off (plain RFC behaviour; the portal uses it).
const jsonpatch = require('fast-json-patch');

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const ID_KEY = /^id$/i;
const unesc = (s) => s.replace(/~1/g, '/').replace(/~0/g, '~');
const esc = (s) => String(s).replace(/~/g, '~0').replace(/\//g, '~1');

/** Map "list path" (keys only, e.g. "agreementItem.productOfferingPrice") -> unique field name. */
function uniqueKeys(tags = []) {
  const m = new Map();
  for (const t of tags) {
    const field = t.path.split('.').pop();
    if (t.unique && t.uniqueIn != null && !ID_KEY.test(field)) m.set(t.uniqueIn, field); // ids are matched first anyway
  }
  return m;
}

/** Find the item of `arr` addressed by `seg`: id first, unique key second, index third. */
function findItem(arr, seg, listPath, keys, where) {
  const match = (getKey) => {
    const hits = [];
    arr.forEach((el, i) => {
      if (!isObj(el)) return;
      const k = getKey(el);
      if (k !== undefined && el[k] !== null && el[k] !== undefined && typeof el[k] !== 'object' && String(el[k]) === seg) hits.push(i);
    });
    return hits;
  };
  const ambiguous = (by, hits) => ({
    status: 409,
    code: 'AMBIGUOUS_ITEM',
    message: `"${seg}" matches ${hits.length} items by ${by} in ${where || '/'} (positions ${hits.join(', ')}) – use the index instead`,
  });

  const byId = match((el) => Object.keys(el).find((k) => ID_KEY.test(k)));
  if (byId.length === 1) return { index: byId[0], by: 'id' };
  if (byId.length > 1) throw ambiguous('id', byId);

  const field = keys && keys.get(listPath);
  if (field) {
    const byKey = match((el) => (Object.prototype.hasOwnProperty.call(el, field) ? field : undefined));
    if (byKey.length === 1) return { index: byKey[0], by: `unique key "${field}"` };
    if (byKey.length > 1) throw ambiguous(`unique key "${field}"`, byKey);
  }

  if (/^\d+$/.test(seg) && Number(seg) < arr.length) return { index: Number(seg), by: 'index' };
  return null;
}

/**
 * Turn a pointer that may contain ids / unique keys into a pure index pointer, against `doc`.
 * `insert` (add / move / copy target): a final "-" or index ≤ length is an insertion position.
 */
function resolvePointer(doc, pointer, keys, { insert = false } = {}) {
  if (typeof pointer !== 'string' || pointer === '') return pointer;
  if (!pointer.startsWith('/')) throw { status: 400, message: `Invalid JSON Pointer "${pointer}"` };
  const segs = pointer.split('/').slice(1).map(unesc);
  let cur = doc;
  const names = []; // keys walked so far (list path)
  const out = [];
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const last = i === segs.length - 1;
    if (Array.isArray(cur)) {
      if (seg === '-' || (last && insert && /^\d+$/.test(seg) && Number(seg) <= cur.length)) {
        out.push(seg);
        cur = undefined;
        continue;
      }
      const where = '/' + out.map(esc).join('/');
      const hit = findItem(cur, seg, names.join('.'), keys, where);
      if (!hit) {
        const field = keys && keys.get(names.join('.'));
        throw {
          status: 422,
          code: 'ITEM_NOT_FOUND',
          message: `No item "${seg}" in ${where} – looked up by id${field ? `, unique key "${field}"` : ''} and index (list has ${cur.length} items)`,
        };
      }
      out.push(String(hit.index));
      cur = cur[hit.index];
    } else {
      out.push(seg);
      names.push(seg);
      cur = isObj(cur) ? cur[seg] : undefined;
    }
  }
  return '/' + out.map(esc).join('/');
}

/**
 * RFC 7396 merge. Extension: when the target is a list and the patch value is an object, its keys
 * address list items (id → unique key → index) and are merged into them; `null` removes the item.
 * (Plain RFC 7396 would replace the list with the object.) Disabled when `keys` is null.
 */
function mergePatch(target, patch, keys = null, names = [], where = '') {
  if (!isObj(patch)) return patch;
  if (Array.isArray(target) && keys) {
    const out = target.slice();
    const removals = [];
    for (const [k, v] of Object.entries(patch)) {
      const hit = findItem(out, k, names.join('.'), keys, where || '/');
      if (!hit) {
        throw { status: 422, code: 'ITEM_NOT_FOUND', message: `No item "${k}" in ${where || '/'} – looked up by id, unique key and index` };
      }
      if (v === null) removals.push(hit.index);
      else out[hit.index] = mergePatch(out[hit.index], v, keys, names, `${where}/${hit.index}`);
    }
    removals.sort((a, b) => b - a).forEach((i) => out.splice(i, 1));
    return out;
  }
  const out = isObj(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k], v, keys, [...names, k], `${where}/${esc(k)}`);
  }
  return out;
}

/**
 * Decide which patch flavour a request is.
 *  - Content-Type application/json-patch+json, or a JSON array body  -> JSON Patch
 *  - Content-Type application/merge-patch+json, or a JSON object body -> Merge Patch
 *  - ?mode=json-patch | ?mode=merge overrides both.
 */
function detectMode(req) {
  const q = String(req.query.mode || '').toLowerCase();
  if (q === 'json-patch' || q === 'jsonpatch') return 'json-patch';
  if (q === 'merge' || q === 'merge-patch') return 'merge';
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  if (ct.includes('json-patch+json')) return 'json-patch';
  if (ct.includes('merge-patch+json')) return 'merge';
  return Array.isArray(req.body) ? 'json-patch' : 'merge';
}

/**
 * Apply the patch. `keys` = uniqueKeys(tags), or null for plain index paths.
 * Returns {doc, resolved:[{index, path, resolvedPath, from?, resolvedFrom?}]} or throws {status, message}.
 */
function applyPatch(record, body, mode, keys = null) {
  if (mode === 'json-patch') {
    if (!Array.isArray(body)) throw { status: 400, message: 'JSON Patch body must be an array of operations' };
    let doc = jsonpatch.deepClone(record);
    const resolved = [];
    body.forEach((op, index) => {
      if (!isObj(op)) throw { status: 400, message: `Operation ${index} is not an object`, index };
      let o = op;
      if (keys) {
        try {
          const insert = op.op === 'add' || op.op === 'move' || op.op === 'copy';
          o = { ...op, path: resolvePointer(doc, op.path, keys, { insert }) };
          if (typeof op.from === 'string') o.from = resolvePointer(doc, op.from, keys);
        } catch (e) {
          throw { ...e, index, operation: op };
        }
        if (o.path !== op.path || o.from !== op.from) {
          resolved.push({ index, path: op.path, resolvedPath: o.path, ...(op.from ? { from: op.from, resolvedFrom: o.from } : {}) });
        }
      }
      const err = jsonpatch.validate([o], doc);
      if (err) {
        throw {
          status: err.name === 'TEST_OPERATION_FAILED' ? 409 : 422,
          message: `${err.name}: ${err.message.split('\n')[0]}${o.path !== op.path ? ` (path ${op.path} → ${o.path})` : ''}`,
          operation: op,
          index,
        };
      }
      doc = jsonpatch.applyOperation(doc, o, false, true, true, index).newDocument;
    });
    return { doc, resolved };
  }
  if (!isObj(body)) throw { status: 400, message: 'Merge Patch body must be a JSON object' };
  return { doc: mergePatch(record, body, keys), resolved: [] };
}

module.exports = { mergePatch, detectMode, applyPatch, resolvePointer, uniqueKeys, findItem };
