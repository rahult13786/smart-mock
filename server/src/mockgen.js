const { listPaths } = require('./tags');
const { locate } = require('./enums');

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const ID_KEY = /^id$/i;
const MAX_MOCKS = 10;

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const WORDS = ('alpha beta gamma delta omega nova prime core smart flex plus pro max lite basic standard premium ' +
  'gold silver bronze active pending approved draft review service contract channel region north south east west ' +
  'central digital physical enterprise retail partner customer account plan bundle offer level tier value').split(' ');

const pad = (n, l = 2) => String(n).padStart(l, '0');
const DMY = /^(\d{2})\/(\d{2})\/(\d{4})( \d{2}:\d{2}:\d{2})?$/;
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function shiftDate(d) {
  return new Date(d.getTime() + (rnd(730) - 365) * 86400000 + rnd(86400) * 1000);
}

function generateLike(v, { enumValues, pool } = {}) {
  if (enumValues && enumValues.length) return pick(enumValues);
  if (typeof v === 'boolean') return Math.random() < 0.5;
  if (typeof v === 'number') {
    if (Number.isInteger(v)) {
      const digits = String(Math.abs(v)).length;
      if (v === 0) return rnd(10);
      const min = 10 ** (digits - 1);
      return (v < 0 ? -1 : 1) * (min + rnd(9 * min));
    }
    const decimals = (String(v).split('.')[1] || '').length;
    return Number((v * (0.5 + Math.random())).toFixed(decimals));
  }
  if (typeof v !== 'string' || v === '') return v;
  if (pool && pool.length > 1 && Math.random() < 0.6) {
    const others = pool.filter((p) => p !== v && typeof p === 'string');
    if (others.length) return pick(others);
  }
  const dmy = v.match(DMY);
  if (dmy) {
    const d = shiftDate(new Date(+dmy[3], +dmy[2] - 1, +dmy[1]));
    const t = dmy[4] ? ` ${pad(rnd(24))}:${pad(rnd(60))}:${pad(rnd(60))}` : '';
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}${t}`;
  }
  if (ISO.test(v) && !Number.isNaN(Date.parse(v))) {
    const iso = shiftDate(new Date(v)).toISOString();
    return v.length === 10 ? iso.slice(0, 10) : v.includes('.') ? iso : iso.replace(/\.\d{3}Z$/, 'Z');
  }
  if (/\d/.test(v)) return randomizeDigits(v);
  const words = v.trim().split(/\s+/);
  const out = words.map((w) => {
    const n = pick(WORDS);
    return /^[A-Z]/.test(w) ? n[0].toUpperCase() + n.slice(1) : n;
  });
  return out.join(' ');
}

function randomizeDigits(s) {
  let first = true;
  return s.replace(/\d/g, (d) => {
    const r = first && d !== '0' ? 1 + rnd(9) : rnd(10);
    first = false;
    return String(r);
  });
}

function generateId(old, used) {
  for (let i = 0; i < 50; i++) {
    let v;
    if (typeof old === 'number') v = generateLike(old);
    else if (/\d/.test(String(old))) v = randomizeDigits(String(old));
    else v = `${old}-${Math.random().toString(36).slice(2, 6)}`;
    if (!used.has(String(v))) {
      used.add(String(v));
      return v;
    }
  }
  const v = `${old}-${Date.now().toString(36)}${rnd(1000)}`;
  used.add(v);
  return v;
}

function nodesAt(doc, segs) {
  let nodes = [doc];
  for (const seg of segs) {
    const next = [];
    for (const n of nodes) {
      if (Array.isArray(n)) {
        for (const el of n) if (isObj(el) && seg in el) next.push(el[seg]);
      } else if (isObj(n) && seg in n) next.push(n[seg]);
    }
    nodes = next;
  }
  return nodes;
}

function nearestList(doc, path) {
  const segs = path.split('.');
  for (let k = segs.length - 1; k >= 1; k--) {
    if (nodesAt(doc, segs.slice(0, k)).some(Array.isArray)) return { listPath: segs.slice(0, k).join('.'), rel: segs.slice(k).join('.') };
  }
  return null;
}

function itemPointer(pointer, listPath) {
  const keys = listPath.split('.');
  const segs = pointer.split('/').slice(1);
  let matched = 0;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i].replace(/~1/g, '/').replace(/~0/g, '~');
    if (/^\d+$/.test(seg)) {
      if (matched === keys.length) return '/' + segs.slice(0, i + 1).join('/');
      continue;
    }
    if (seg === keys[matched]) matched++;
  }
  return null;
}

function matchOccurrences(doc, path, filter) {
  const occ = locate(doc, path);
  if (!filter || !filter.key) return occ;
  const list = nearestList(doc, path);
  if (!list) return occ;
  return occ.filter((o) => {
    const ip = itemPointer(o.pointer, list.listPath);
    const item = ip ? getByPtr(doc, ip) : undefined;
    return isObj(item) && item[filter.key] !== undefined && String(item[filter.key]) === String(filter.value);
  });
}

function currentValues(doc, path, filter) {
  const occ = matchOccurrences(doc, path, filter);
  return { count: occ.length, values: [...new Set(occ.slice(0, 200).map((o) => o.value))].slice(0, 10) };
}

const tagPathOf = (pointerSegs) => pointerSegs.filter((s) => !/^\d+$/.test(s)).join('.');

function idPaths(template) {
  const groups = new Map();
  const walk = (node, segs) => {
    if (Array.isArray(node)) return node.forEach((el, i) => walk(el, [...segs, String(i)]));
    if (!isObj(node)) return;
    for (const [k, v] of Object.entries(node)) {
      if (ID_KEY.test(k) && v !== null && typeof v !== 'object') {
        const path = tagPathOf([...segs, k]);
        if (!groups.has(path)) groups.set(path, { path, values: [], count: 0, root: segs.length === 0 });
        const g = groups.get(path);
        g.count++;
        if (!g.values.includes(v)) g.values.push(v);
      }
      if (v && typeof v === 'object') walk(v, [...segs, k]);
    }
  };
  walk(template, []);
  return [...groups.values()]
    .sort((a, b) => (b.root ? 1 : 0) - (a.root ? 1 : 0) || a.path.split('.').length - b.path.split('.').length)
    .map((g) => ({ path: g.path, root: g.root, count: g.count, distinct: g.values.length, sample: g.values.slice(0, 5) }));
}

function fieldPaths(template, tags) {
  const enums = new Map(tags.filter((t) => t.enum?.length).map((t) => [t.path, t.enum]));
  return listPaths([template], { scan: 50, limit: 3000, maxDepth: 8 })
    .filter((p) => !ID_KEY.test(p.path.split('.').pop()))
    .map((p) => {
      const occ = locate(template, p.path);
      const list = nearestList(template, p.path);
      let filterKeys;
      if (list) {
        const items = locate(template, list.listPath).map((x) => x.value).filter(isObj);
        const keys = new Map();
        for (const it of items) {
          for (const [k, v] of Object.entries(it)) {
            if (v === null || typeof v === 'object' || k === list.rel) continue;
            if (!keys.has(k)) keys.set(k, new Set());
            if (keys.get(k).size < 200) keys.get(k).add(v);
          }
        }
        filterKeys = [...keys.entries()].map(([key, vals]) => ({ key, values: [...vals] }));
      }
      return {
        path: p.path,
        type: p.type,
        count: occ.length,
        sample: [...new Set(occ.slice(0, 50).map((o) => o.value))].slice(0, 5),
        enum: enums.get(p.path),
        listPath: list ? list.listPath : null,
        rel: list ? list.rel : null,
        filterKeys,
      };
    });
}

function setByPointer(doc, pointer, value) {
  const segs = pointer.split('/').slice(1).map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cur = doc;
  for (let i = 0; i < segs.length - 1; i++) cur = cur[Array.isArray(cur) ? +segs[i] : segs[i]];
  const last = segs[segs.length - 1];
  cur[Array.isArray(cur) ? +last : last] = value;
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function replaceAll(doc, mapping, skip) {
  const strOld = [...mapping.keys()].filter((k) => typeof k === 'string' && k.length >= 3).sort((a, b) => b.length - a.length);
  const re = strOld.length ? new RegExp(strOld.map(escRe).join('|'), 'g') : null;
  const walk = (node, ptr) => {
    if (Array.isArray(node)) return node.map((el, i) => walk(el, `${ptr}/${i}`));
    if (isObj(node)) {
      const out = {};
      for (const [k, v] of Object.entries(node)) out[k] = walk(v, `${ptr}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`);
      return out;
    }
    if (skip.has(ptr)) return node;
    if (mapping.has(node) && typeof node !== 'string') return mapping.get(node);
    if (typeof node === 'string') {
      if (mapping.has(node)) return mapping.get(node);
      if (re) return node.replace(re, (m) => String(mapping.get(m)));
    }
    return node;
  };
  return walk(doc, '');
}

function buildMocks(template, spec, tags, existingIds) {
  const count = Number(spec.count);
  if (!Number.isInteger(count) || count < 1 || count > MAX_MOCKS) {
    throw { status: 400, message: `Number of mocks must be between 1 and ${MAX_MOCKS}` };
  }
  const enums = new Map(tags.filter((t) => t.enum?.length).map((t) => [t.path, t.enum]));
  const warnings = [];
  const usedIds = new Set([...existingIds].map(String));
  const records = [];
  const rootRule = (spec.idRules || []).find((r) => r.path === 'id') || { path: 'id', auto: true, replaceAll: true, values: [] };

  for (let m = 0; m < count; m++) {
    let doc = structuredClone(template);
    const mapping = new Map();
    const setPtrs = new Set();
    for (const r of (spec.idRules || []).filter((x) => x.reuse && x.path !== 'id')) locate(doc, r.path).forEach((o) => setPtrs.add(o.pointer));
    for (const r of (spec.fieldRules || []).filter((x) => x.reuse)) matchOccurrences(doc, r.path, r.filter).forEach((o) => setPtrs.add(o.pointer));

    const rules = [rootRule, ...(spec.idRules || []).filter((r) => r.path !== 'id')];
    for (const rule of rules) {
      if (rule.reuse) {
        if (rule.path === 'id') throw { status: 400, message: 'The record id cannot be reused – every mock needs its own id' };
        continue;
      }
      const occ = locate(doc, rule.path);
      if (!occ.length) continue;
      const given = (rule.values || [])[m];
      if ((given === undefined || given === '') && !rule.auto) {
        if (rule.path === 'id') throw { status: 400, message: 'The record id must change: enter ids or tick auto-generate' };
        continue;
      }
      const distinct = [...new Set(occ.map((o) => o.value))];
      const local = new Map();
      distinct.forEach((old, j) => {
        let nv;
        if (given !== undefined && given !== '') {
          nv = j === 0 ? given : `${given}-${j}`;
          if (typeof old === 'number' && !Number.isNaN(Number(nv))) nv = Number(nv);
          if (rule.path === 'id' && usedIds.has(String(nv))) {
            throw { status: 409, message: `Mock ${m + 1}: id "${nv}" already exists – choose another id` };
          }
          usedIds.add(String(nv));
        } else {
          nv = generateId(old, usedIds);
        }
        local.set(old, nv);
      });
      for (const o of occ) {
        setByPointer(doc, o.pointer, local.get(o.value));
        setPtrs.add(o.pointer);
      }
      if (rule.replaceAll) for (const [o, n] of local) mapping.set(o, n);
    }
    if (mapping.size) doc = replaceAll(doc, mapping, setPtrs);

    for (const rule of spec.fieldRules || []) {
      if (rule.reuse) continue;
      const occ = matchOccurrences(doc, rule.path, rule.filter);
      if (!occ.length) {
        if (m === 0) warnings.push(`"${rule.path}"${rule.filter?.key ? ` where ${rule.filter.key} = ${rule.filter.value}` : ''} not found in the template – skipped`);
        continue;
      }
      const given = (rule.values || [])[m];
      const enumValues = enums.get(rule.path);
      const pool = [...new Set(locate(template, rule.path).map((o) => o.value))];
      for (const o of occ) {
        let nv;
        if (given !== undefined && given !== '') {
          nv = given;
          if (typeof o.value === 'number' && !Number.isNaN(Number(nv))) nv = Number(nv);
          if (typeof o.value === 'boolean' && (nv === 'true' || nv === 'false')) nv = nv === 'true';
        } else if (rule.auto || (rule.values || []).length) {
          nv = generateLike(o.value, { enumValues, pool });
        } else continue;
        setByPointer(doc, o.pointer, nv);
      }
    }
    records.push(doc);
  }
  return { records, warnings };
}

function getByPtr(doc, pointer) {
  let cur = doc;
  for (const raw of pointer.split('/').slice(1)) {
    const seg = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (cur == null) return undefined;
    cur = cur[Array.isArray(cur) ? +seg : seg];
  }
  return cur;
}

module.exports = { idPaths, fieldPaths, buildMocks, generateLike, generateId, currentValues, nearestList, MAX_MOCKS };
