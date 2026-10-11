const crypto = require('crypto');
const regexgen = require('regexgen');
const RandExp = require('randexp');
const { locate } = require('./enums');
const { isIdPath, isObj, splitPath } = require('./tags');
const { generateId, generateLike } = require('./mockgen');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const QUANT = /^[?*+{]/;

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      out.push(src.slice(i, i + 2));
      i += 2;
    } else if (c === '[') {
      let j = i + 1;
      while (j < src.length && src[j] !== ']') j += src[j] === '\\' ? 2 : 1;
      out.push(src.slice(i, j + 1));
      i = j + 1;
    } else if (c === '{') {
      const j = src.indexOf('}', i);
      out.push(src.slice(i, j + 1));
      i = j + 1;
    } else if (c === '(' && src.startsWith('(?:', i)) {
      out.push('(?:');
      i += 3;
    } else {
      out.push(c);
      i++;
    }
  }
  return out;
}

const DIGIT = '\uE000';

function compress(src) {
  const tokens = tokenize(src);
  const out = [];
  for (let i = 0; i < tokens.length; ) {
    if (tokens[i] !== '\\d') {
      out.push(tokens[i++]);
      continue;
    }
    let j = i;
    while (tokens[j] === '\\d') j++;
    let run = j - i;
    const quantified = j < tokens.length && QUANT.test(tokens[j]);
    if (quantified) run--;
    if (run > 1) out.push(`\\d{${run}}`);
    else if (run === 1) out.push('\\d');
    if (quantified) out.push('\\d');
    i = j;
  }
  return out.join('');
}

function generalize(strings) {
  const shapes = [...new Set(strings.map((s) => s.replace(/\d/g, DIGIT)))].slice(0, 500);
  const src = regexgen(shapes).source.replace(/\\uE000/gi, '\\d').split(DIGIT).join('\\d');
  return compress(src);
}

function buildRegex(values) {
  const strings = [...new Set(values.filter((v) => v !== null && v !== undefined && typeof v !== 'object').map(String))].filter(Boolean);
  if (!strings.length) return { exact: '', pattern: '', count: 0 };
  const exact = regexgen(strings.slice(0, 200)).source;
  if (strings.every((s) => UUID.test(s))) return { exact, pattern: UUID_PATTERN, count: strings.length };
  return { exact, pattern: generalize(strings), count: strings.length };
}

function compileRegex(pattern, label = 'regex') {
  if (typeof pattern !== 'string' || !pattern.trim()) throw { status: 400, code: 'INVALID_REGEX', message: `${label} is empty` };
  try {
    return new RegExp(pattern);
  } catch (e) {
    throw { status: 400, code: 'INVALID_REGEX', message: `${label} is not a valid regular expression: ${e.message}` };
  }
}

function fromRegex(pattern, type) {
  const r = new RandExp(compileRegex(pattern));
  r.max = 8;
  const v = r.gen();
  return type === 'number' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : v;
}

function examples(pattern, type, n = 3) {
  const out = new Set();
  for (let i = 0; i < n * 5 && out.size < n; i++) out.add(fromRegex(pattern, type));
  return [...out];
}

const activePattern = (tag) => {
  const r = tag && tag.regex;
  if (!r || !r.enabled) return null;
  return r.override && r.pattern ? r.pattern : r.built || null;
};
const createOn = (tag) => (tag.create === undefined ? tag.path === 'id' : !!tag.create);

function newValue(tag, old, sampleValue, used) {
  const pattern = activePattern(tag);
  for (let i = 0; i < 25; i++) {
    let v;
    if (pattern) v = fromRegex(pattern, tag.type);
    else if (sampleValue !== undefined && sampleValue !== null && sampleValue !== '') v = generateId(sampleValue, new Set(used));
    else if (old !== undefined && old !== null && old !== '') v = generateId(old, new Set(used));
    else v = crypto.randomUUID();
    if (!used.has(String(v))) {
      used.add(String(v));
      return v;
    }
  }
  const v = `${old ?? sampleValue ?? 'id'}-${crypto.randomUUID().slice(0, 8)}`;
  used.add(v);
  return v;
}

function relative(tagPath, base) {
  if (!base) return tagPath;
  if (tagPath === base) return '';
  return tagPath.startsWith(`${base}.`) ? tagPath.slice(base.length + 1) : null;
}

function containers(value, parentRel) {
  if (!parentRel) return isObj(value) ? [value] : [];
  return locate(value, parentRel).map((x) => x.value).filter(isObj);
}

function fillIds(value, tags, { base = '', doc, refs = [], skipRoot = false } = {}) {
  let out = value;
  const changed = [];
  for (const tag of tags) {
    if (!isIdPath(tag.path) || (skipRoot && tag.path === 'id')) continue;
    const rel = relative(tag.path, base);
    if (rel === null) continue;
    const regenerate = createOn(tag);
    const pattern = activePattern(tag);
    if (!regenerate && !pattern) continue;
    const used = new Set([...locate(doc || value, tag.path), ...(doc ? locate(value, rel || '') : [])].map((x) => String(x.value)));
    const sampleValue = refs.length ? locate(refs[0], tag.path)[0]?.value : undefined;
    if (rel === '') {
      if (regenerate && out !== null && typeof out !== 'object') {
        out = newValue(tag, out, sampleValue, used);
        changed.push(tag.path);
      }
      continue;
    }
    const segs = splitPath(rel);
    const key = segs.pop();
    for (const c of containers(out, segs.join('.'))) {
      const cur = c[key];
      if (cur !== null && typeof cur === 'object') continue;
      const empty = cur === undefined || cur === null || cur === '';
      if (regenerate || (empty && pattern)) {
        c[key] = newValue(tag, cur, sampleValue, used);
        changed.push(tag.path);
      }
    }
  }
  return { value: out, changed: [...new Set(changed)] };
}

const esc = (s) => String(s).replace(/~/g, '~0').replace(/\//g, '~1');
const unesc = (s) => s.replace(/~1/g, '/').replace(/~0/g, '~');
const isEmpty = (v) => v === undefined || v === null || v === '';
const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'nova', 'prime', 'core', 'smart', 'flex', 'standard', 'premium', 'gold', 'silver'];

function randomValue(tag, refs) {
  if (Array.isArray(tag.enum) && tag.enum.length) return tag.enum[Math.floor(Math.random() * tag.enum.length)];
  const pool = [...new Set(refs.slice(0, 20).flatMap((r) => locate(r, tag.path).map((x) => x.value)))].filter(
    (v) => v !== null && v !== '' && typeof v !== 'object'
  );
  if (pool.length) return generateLike(pool[Math.floor(Math.random() * pool.length)], { pool });
  if (tag.type === 'number') return 1 + Math.floor(Math.random() * 9999);
  if (tag.type === 'boolean') return Math.random() < 0.5;
  return `${WORDS[Math.floor(Math.random() * WORDS.length)]}-${Math.random().toString(36).slice(2, 7)}`;
}

function fillMissing(value, tags, { base = '', refs = [] } = {}) {
  let out = value;
  const baseSegs = splitPath(base);
  const filled = [];
  for (const tag of tags) {
    if (isIdPath(tag.path) || !createOn(tag)) continue;
    const rel = relative(tag.path, base);
    if (rel === null) continue;
    if (rel === '') {
      if (isEmpty(out)) {
        out = randomValue(tag, refs);
        filled.push(tag.path);
      }
      continue;
    }
    const segs = splitPath(rel);
    const walk = (node, i, done) => {
      if (Array.isArray(node)) return node.forEach((el) => walk(el, i, done));
      if (!isObj(node)) return;
      const seg = segs[i];
      if (i === segs.length - 1) {
        if (isEmpty(node[seg])) {
          node[seg] = randomValue(tag, refs);
          filled.push(tag.path);
        }
        return;
      }
      if (node[seg] === undefined || node[seg] === null) {
        if (listAt(refs, [...baseSegs, ...done, seg])) return;
        node[seg] = {};
      }
      walk(node[seg], i + 1, [...done, seg]);
    };
    walk(out, 0, []);
  }
  return { value: out, filled: [...new Set(filled)] };
}

function getAt(root, pointer) {
  if (!pointer) return root;
  let cur = root;
  for (const raw of pointer.split('/').slice(1)) {
    if (cur === null || typeof cur !== 'object') return undefined;
    const seg = unesc(raw);
    cur = Array.isArray(cur) ? cur[seg === '-' ? cur.length : Number(seg)] : cur[seg];
  }
  return cur;
}

function ancestorPointer(pointer, keyPath) {
  if (!keyPath) return '';
  const want = splitPath(keyPath);
  const segs = pointer.split('/').slice(1);
  let k = 0;
  for (let i = 0; i < segs.length; i++) {
    if (k < want.length && unesc(segs[i]) === want[k]) {
      k++;
      if (k === want.length) {
        const end = i + 1 < segs.length && /^(\d+|-)$/.test(segs[i + 1]) ? i + 2 : i + 1;
        return '/' + segs.slice(0, end).join('/');
      }
    }
  }
  return null;
}

const parentOf = (p) => splitPath(p).slice(0, -1).join('.');
const lastOf = (p) => splitPath(p).pop();

function mapCandidates(refs, tagPath, listPaths) {
  const parent = parentOf(tagPath);
  const prefixes = new Set(['']);
  const segs = splitPath(parent);
  for (let i = 1; i <= segs.length; i++) prefixes.add(segs.slice(0, i).join('.'));
  return listPaths(refs)
    .filter((p) => p.path !== tagPath && prefixes.has(parentOf(p.path)))
    .map((p) => {
      const sample = refs.length ? locate(refs[0], p.path)[0]?.value : undefined;
      return { path: p.path, type: p.type, relation: parentOf(p.path) === parent ? 'sibling' : 'parent', sample };
    })
    .sort((a, b) => (a.relation === b.relation ? 0 : a.relation === 'sibling' ? -1 : 1) || splitPath(b.path).length - splitPath(a.path).length || a.path.localeCompare(b.path));
}

function applyMaps(value, tags, { base = '', pointer = '', doc } = {}) {
  let out = value;
  const mapped = [];
  const read = (abs) => {
    if (pointer === '' || abs === pointer || abs.startsWith(`${pointer}/`)) return getAt(out, abs.slice(pointer.length));
    return getAt(doc, abs);
  };
  for (const tag of tags) {
    const m = tag.map;
    if (!m || !m.enabled || !m.source || isIdPath(tag.path)) continue;
    const rel = relative(tag.path, base);
    if (rel === null) continue;
    const srcParent = parentOf(m.source);
    const srcKey = lastOf(m.source);
    const sourceAt = (containerPtr) => {
      const anc = ancestorPointer(containerPtr, srcParent);
      if (anc === null) return undefined;
      const holder = read(anc);
      return isObj(holder) ? holder[srcKey] : undefined;
    };
    if (rel === '') {
      const segs = pointer.split('/');
      const v = sourceAt(segs.slice(0, -1).join('/'));
      if (v !== undefined && (v === null || typeof v !== 'object')) {
        out = v;
        mapped.push(tag.path);
      }
      continue;
    }
    const segs = splitPath(rel);
    const key = segs.pop();
    const parentRel = segs.join('.');
    const holders = parentRel ? locate(out, parentRel).filter((x) => isObj(x.value)) : isObj(out) ? [{ pointer: '', value: out }] : [];
    for (const h of holders) {
      const v = sourceAt(pointer + h.pointer);
      if (v === undefined || (v !== null && typeof v === 'object')) continue;
      h.value[key] = v;
      mapped.push(tag.path);
    }
  }
  return { value: out, mapped: [...new Set(mapped)] };
}

function listAt(refs, segs) {
  let nodes = refs.slice(0, 20);
  for (const seg of segs) {
    const next = [];
    for (const n of nodes) {
      if (Array.isArray(n)) for (const el of n) isObj(el) && seg in el && next.push(el[seg]);
      else if (isObj(n) && seg in n) next.push(n[seg]);
    }
    nodes = next;
  }
  return nodes.some(Array.isArray);
}

function mustViolations(value, tags, { base = '', pointer = '', refs = [] } = {}) {
  const out = [];
  const baseSegs = splitPath(base);
  const walk = (node, segs, done, ptr, tag) => {
    if (!segs.length) {
      if (node === undefined || node === null || node === '') out.push({ path: ptr, tag: tag.path });
      return;
    }
    if (Array.isArray(node)) return node.forEach((el, i) => walk(el, segs, done, `${ptr}/${i}`, tag));
    if (!isObj(node)) {
      if ((node === undefined || node === null) && done.length && listAt(refs, [...baseSegs, ...done])) return;
      return out.push({ path: `${ptr}/${segs.map(esc).join('/')}`, tag: tag.path });
    }
    const [s, ...rest] = segs;
    walk(node[s], rest, [...done, s], `${ptr}/${esc(s)}`, tag);
  };
  for (const tag of tags) {
    if (!tag.must) continue;
    const rel = relative(tag.path, base);
    if (rel === null) continue;
    walk(value, splitPath(rel), [], pointer, tag);
  }
  return out;
}

function mustError(violations, prefix = '') {
  const first = violations[0];
  return {
    status: 422,
    code: 'MUST_VIOLATION',
    message:
      `${prefix}Required data missing on path "${first.path || '/'}": "${first.tag}" is marked as must` +
      (violations.length > 1 ? ` (and ${violations.length - 1} more)` : ''),
    violations: violations.slice(0, 50),
  };
}

function tagPathOfPointer(doc, pointer) {
  const names = [];
  let cur = doc;
  for (const raw of String(pointer).split('/').slice(1)) {
    const seg = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(cur)) {
      cur = seg === '-' ? undefined : cur[Number(seg)];
      continue;
    }
    names.push(seg);
    cur = isObj(cur) ? cur[seg] : undefined;
  }
  return names.join('.');
}

module.exports = {
  buildRegex,
  generalize,
  compileRegex,
  fromRegex,
  examples,
  activePattern,
  createOn,
  fillIds,
  fillMissing,
  applyMaps,
  mapCandidates,
  mustViolations,
  mustError,
  tagPathOfPointer,
};
