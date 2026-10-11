const crypto = require('crypto');
const express = require('express');
const store = require('./store');

const FOLDER_OPTIONS = {
  domain: ['fixedline', 'gsm'],
  env: ['dev', 'st', 'sit'],
  team: ['bau', 'project'],
  role: ['dev', 'test'],
  technology: ['ms', 'esb'],
};
const FOLDER_FIELDS = Object.keys(FOLDER_OPTIONS);

const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*_-';
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;
const PASSWORD_LENGTH = 16;
const PASSWORD_SHAPE = new RegExp(`^[${ALL.replace(/[-\]\\^]/g, '\\$&')}]{${PASSWORD_LENGTH}}$`);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MASK = '******';

const pick = (chars) => chars[crypto.randomInt(chars.length)];

function generatePassword() {
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < PASSWORD_LENGTH) chars.push(pick(ALL));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

const strongEnough = (p) =>
  typeof p === 'string' && PASSWORD_SHAPE.test(p) && [LOWER, UPPER, DIGITS, SYMBOLS].every((set) => [...p].some((c) => set.includes(c)));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const text = (v) => (typeof v === 'string' ? v.trim() : '');
const publicUser = (u) => ({
  _id: u._id,
  firstName: u.firstName,
  lastName: u.lastName,
  email: u.email,
  active: !!u.active,
  password: MASK,
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
});
const byName = (a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`) || a.email.localeCompare(b.email);

async function checkUser(body, users, selfId) {
  const user = { firstName: text(body.firstName), lastName: text(body.lastName), email: text(body.email).toLowerCase() };
  const missing = Object.entries({ firstName: 'First name', lastName: 'Last name', email: 'Email' })
    .filter(([k]) => !user[k])
    .map(([, label]) => label);
  if (missing.length) throw { status: 400, code: 'REQUIRED', message: `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required` };
  if (!EMAIL.test(user.email)) throw { status: 400, code: 'INVALID_EMAIL', message: `"${user.email}" is not a valid email address` };
  const clash = await users.findOneAsync({ email: user.email });
  if (clash && clash._id !== selfId) throw { status: 409, code: 'EMAIL_EXISTS', message: `A user with email ${user.email} already exists` };
  return user;
}

const folderName = (f) => FOLDER_FIELDS.map((k) => f[k]).join('-');

async function withUsers(folder) {
  const users = await store.getCollection('users');
  const list = await users.findAsync({ _id: { $in: folder.userIds || [] } });
  return { ...folder, users: list.map(publicUser).sort(byName) };
}

const router = express.Router();

router.get(
  '/users',
  wrap(async (_req, res) => {
    const users = await store.getCollection('users');
    res.json((await users.findAsync({})).map(publicUser).sort(byName));
  })
);

router.get('/users/password', (_req, res) => res.json({ password: generatePassword() }));

router.post(
  '/users',
  wrap(async (req, res) => {
    const users = await store.getCollection('users');
    const user = await checkUser(req.body || {}, users);
    const now = new Date().toISOString();
    const doc = {
      _id: crypto.randomUUID(),
      ...user,
      active: req.body?.active === undefined ? true : !!req.body.active,
      password: strongEnough(req.body?.password) ? req.body.password : generatePassword(),
      createdAt: now,
      updatedAt: now,
    };
    await users.insertAsync(doc);
    res.status(201).json(publicUser(doc));
  })
);

router.get(
  '/users/:id/password',
  wrap(async (req, res) => {
    const users = await store.getCollection('users');
    const u = await users.findOneAsync({ _id: req.params.id });
    if (!u) return res.status(404).json({ error: 'User not found' });
    res.set('Cache-Control', 'no-store').json({ password: u.password });
  })
);

router.patch(
  '/users/:id',
  wrap(async (req, res) => {
    const users = await store.getCollection('users');
    const u = await users.findOneAsync({ _id: req.params.id });
    if (!u) return res.status(404).json({ error: 'User not found' });
    if (req.body && 'password' in req.body) throw { status: 400, code: 'PASSWORD_READONLY', message: 'The password is generated and cannot be changed' };
    const fields = await checkUser({ ...u, ...req.body }, users, u._id);
    const next = { ...u, ...fields, active: req.body?.active === undefined ? !!u.active : !!req.body.active, updatedAt: new Date().toISOString() };
    await users.updateAsync({ _id: u._id }, next, {});
    res.json(publicUser(next));
  })
);

router.delete(
  '/users/:id',
  wrap(async (req, res) => {
    const users = await store.getCollection('users');
    const n = await users.removeAsync({ _id: req.params.id }, {});
    if (!n) return res.status(404).json({ error: 'User not found' });
    const folders = await store.getCollection('folders');
    for (const f of await folders.findAsync({ userIds: req.params.id })) {
      await folders.updateAsync({ _id: f._id }, { ...f, userIds: f.userIds.filter((id) => id !== req.params.id), updatedAt: new Date().toISOString() }, {});
    }
    res.json({ deleted: req.params.id });
  })
);

router.get('/folders/options', (_req, res) => res.json(FOLDER_OPTIONS));

router.get(
  '/folders',
  wrap(async (_req, res) => {
    const folders = await store.getCollection('folders');
    const list = await folders.findAsync({});
    res.json(list.map((f) => ({ ...f, userCount: (f.userIds || []).length })).sort((a, b) => a.name.localeCompare(b.name)));
  })
);

router.post(
  '/folders',
  wrap(async (req, res) => {
    const body = req.body || {};
    const folder = {};
    const problems = [];
    for (const k of FOLDER_FIELDS) {
      const v = text(body[k]).toLowerCase();
      if (!v) problems.push(`${k} is required`);
      else if (!FOLDER_OPTIONS[k].includes(v)) problems.push(`${k} must be one of ${FOLDER_OPTIONS[k].join(', ')}`);
      folder[k] = v;
    }
    if (problems.length) throw { status: 400, code: 'INVALID_FOLDER', message: problems.join('; '), problems };
    const name = folderName(folder);
    const folders = await store.getCollection('folders');
    const doc = await store.withLock('folders', async () => {
      if (await folders.findOneAsync({ name })) throw { status: 409, code: 'FOLDER_EXISTS', message: `Folder ${name} already exists` };
      const now = new Date().toISOString();
      const d = { _id: name, name, ...folder, userIds: [], createdAt: now, updatedAt: now };
      await folders.insertAsync(d);
      return d;
    });
    res.status(201).json({ ...doc, userCount: 0 });
  })
);

router.get(
  '/folders/:id',
  wrap(async (req, res) => {
    const folders = await store.getCollection('folders');
    const f = await folders.findOneAsync({ _id: req.params.id });
    if (!f) return res.status(404).json({ error: 'Folder not found' });
    res.json(await withUsers(f));
  })
);

router.put(
  '/folders/:id/users',
  wrap(async (req, res) => {
    const ids = req.body?.userIds;
    if (!Array.isArray(ids)) throw { status: 400, message: 'userIds must be an array' };
    const unique = [...new Set(ids.map(String))];
    const users = await store.getCollection('users');
    const found = new Set((await users.findAsync({ _id: { $in: unique } })).map((u) => u._id));
    const unknown = unique.filter((id) => !found.has(id));
    if (unknown.length) throw { status: 400, code: 'UNKNOWN_USER', message: `Unknown user id(s): ${unknown.join(', ')}` };
    const folders = await store.getCollection('folders');
    const updated = await store.withLock(`folder:${req.params.id}`, async () => {
      const f = await folders.findOneAsync({ _id: req.params.id });
      if (!f) throw { status: 404, message: 'Folder not found' };
      const next = { ...f, userIds: unique, updatedAt: new Date().toISOString() };
      await folders.updateAsync({ _id: f._id }, next, {});
      return next;
    });
    res.json(await withUsers(updated));
  })
);

router.delete(
  '/folders/:id',
  wrap(async (req, res) => {
    const folders = await store.getCollection('folders');
    const n = await folders.removeAsync({ _id: req.params.id }, {});
    if (!n) return res.status(404).json({ error: 'Folder not found' });
    res.json({ deleted: req.params.id });
  })
);

module.exports = { router, generatePassword, FOLDER_OPTIONS };
