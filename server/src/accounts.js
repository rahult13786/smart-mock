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
const USER_OPTIONS = {
  domain: ['fixedline', 'gsm'],
  team: ['bau', 'project'],
  technology: ['ms', 'esb', 'portal'],
  role: ['dev', 'test'],
};
const USER_SCOPE = Object.keys(USER_OPTIONS);
const ENVS = ['dev', 'st', 'sit'];
const ADMIN_LOGIN = 'smadmin';
const ADMIN_PASSWORD = () => process.env.SMADMIN_PASSWORD || 'smadmin';
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 12);
const ADMIN_USER = { _id: ADMIN_LOGIN, firstName: 'SM', lastName: 'Admin', email: ADMIN_LOGIN, role: ADMIN_LOGIN, active: true, isAdmin: true };

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
  domain: u.domain || '',
  team: u.team || '',
  technology: u.technology || '',
  role: u.role || '',
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
  if (user.email === ADMIN_LOGIN) throw { status: 409, code: 'EMAIL_EXISTS', message: `"${ADMIN_LOGIN}" is reserved` };
  const problems = [];
  for (const k of USER_SCOPE) {
    const v = text(body[k]).toLowerCase();
    if (!v) problems.push(`${k} is required`);
    else if (!USER_OPTIONS[k].includes(v)) problems.push(`${k} must be one of ${USER_OPTIONS[k].join(', ')}`);
    user[k] = v;
  }
  if (problems.length) throw { status: 400, code: 'INVALID_USER', message: problems.join('; '), problems };
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

const scopePrefix = (u) => (u && !u.isAdmin ? USER_SCOPE.map((k) => u[k]).join('-') : null);

function canAccess(user, api) {
  if (!user) return false;
  if (user.isAdmin) return true;
  if (!api.group) return false;
  const prefix = scopePrefix(user);
  return ENVS.some((env) => api.group === `${prefix}-${env}`);
}

function sessionUser(u) {
  if (u.isAdmin) return { ...ADMIN_USER, scope: null, envs: ENVS };
  return { ...publicUser(u), isAdmin: false, scope: scopePrefix(u), envs: ENVS };
}

const equal = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const bearer = (req) => {
  const h = String(req.headers.authorization || '');
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
};

async function resolveSession(token) {
  if (!token) return null;
  const sessions = await store.getCollection('sessions');
  const s = await sessions.findOneAsync({ _id: token });
  if (!s) return null;
  if (Date.parse(s.expiresAt) < Date.now()) {
    await sessions.removeAsync({ _id: token }, {});
    return null;
  }
  if (s.userId === ADMIN_LOGIN) return sessionUser(ADMIN_USER);
  const users = await store.getCollection('users');
  const u = await users.findOneAsync({ _id: s.userId });
  return u && u.active ? sessionUser(u) : null;
}

const authenticate = (req, res, next) =>
  resolveSession(bearer(req)).then((user) => {
    if (!user) return res.status(401).json({ error: 'Login required', code: 'LOGIN_REQUIRED' });
    req.user = user;
    next();
  }, next);

const requireAdmin = (req, res, next) => (req.user?.isAdmin ? next() : res.status(403).json({ error: 'Only smadmin can do this', code: 'ADMIN_ONLY' }));

const authRouter = express.Router();

authRouter.post(
  '/auth/login',
  wrap(async (req, res) => {
    const login = text(req.body?.email).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!login || !password) throw { status: 400, code: 'REQUIRED', message: 'Email and password are required' };
    let user = null;
    if (login === ADMIN_LOGIN) {
      if (equal(password, ADMIN_PASSWORD())) user = ADMIN_USER;
    } else {
      const users = await store.getCollection('users');
      const u = await users.findOneAsync({ email: login });
      if (u && equal(password, u.password)) {
        if (!u.active) throw { status: 403, code: 'INACTIVE', message: 'This user is inactive' };
        user = u;
      }
    }
    if (!user) throw { status: 401, code: 'BAD_LOGIN', message: 'Wrong email or password' };
    const sessions = await store.getCollection('sessions');
    await sessions.removeAsync({ expiresAt: { $lt: new Date().toISOString() } }, { multi: true });
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    await sessions.insertAsync({ _id: token, userId: user._id, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + SESSION_HOURS * 3600e3).toISOString() });
    res.json({ token, user: sessionUser(user), expiresInHours: SESSION_HOURS });
  })
);

authRouter.get(
  '/auth/me',
  wrap(async (req, res) => {
    const user = await resolveSession(bearer(req));
    if (!user) return res.status(401).json({ error: 'Login required', code: 'LOGIN_REQUIRED' });
    res.json(user);
  })
);

authRouter.post(
  '/auth/logout',
  wrap(async (req, res) => {
    const token = bearer(req);
    if (token) await (await store.getCollection('sessions')).removeAsync({ _id: token }, {});
    res.json({ ok: true });
  })
);

authRouter.get('/auth/options', (_req, res) => res.json({ ...USER_OPTIONS, env: ENVS }));

const router = express.Router();

router.get(
  '/users',
  wrap(async (_req, res) => {
    const users = await store.getCollection('users');
    res.json((await users.findAsync({})).map(publicUser).sort(byName));
  })
);

router.get('/users/options', (_req, res) => res.json(USER_OPTIONS));

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

module.exports = { router, authRouter, authenticate, requireAdmin, canAccess, scopePrefix, generatePassword, FOLDER_OPTIONS, USER_OPTIONS, ENVS, ADMIN_LOGIN };
