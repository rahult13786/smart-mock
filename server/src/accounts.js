const crypto = require('crypto');
const express = require('express');
const store = require('./store');

const CONFIG_TYPES = { DOMAIN: 'domain', TEAM: 'team', TECHNOLOGY: 'technology', ROLE: 'role' };
const USER_SCOPE = Object.values(CONFIG_TYPES);
const DEFAULT_CONFIG = [
  ['DOMAIN', 'fixedline'],
  ['DOMAIN', 'gsm'],
  ['TEAM', 'bau'],
  ['TEAM', 'project'],
  ['TECHNOLOGY', 'ms'],
  ['TECHNOLOGY', 'esb'],
  ['TECHNOLOGY', 'portal'],
  ['ROLE', 'dev'],
  ['ROLE', 'test'],
];
const CONFIG_VALUE = /^[a-z0-9_]{1,40}$/;
const TYPE_ORDER = Object.keys(CONFIG_TYPES);

async function configList() {
  const ds = await store.getCollection('configs');
  let docs = await ds.findAsync({});
  if (!docs.length) {
    docs = await store.withLock('configs-seed', async () => {
      const again = await ds.findAsync({});
      if (again.length) return again;
      const now = Date.now();
      const seed = DEFAULT_CONFIG.map(([type, value], i) => ({ _id: `${type}:${value}`, type, value, createdAt: new Date(now + i).toISOString() }));
      await ds.insertAsync(seed);
      return seed;
    });
  }
  return docs.sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.createdAt.localeCompare(b.createdAt));
}

async function userOptions() {
  const out = Object.fromEntries(USER_SCOPE.map((k) => [k, []]));
  for (const c of await configList()) out[CONFIG_TYPES[c.type]]?.push(c.value);
  return out;
}
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
  const options = await userOptions();
  for (const k of USER_SCOPE) {
    const v = text(body[k]).toLowerCase();
    if (!v) problems.push(`${k} is required`);
    else if (!options[k].includes(v)) problems.push(`${k} must be one of ${options[k].join(', ')}`);
    user[k] = v;
  }
  if (problems.length) throw { status: 400, code: 'INVALID_USER', message: problems.join('; '), problems };
  const clash = await users.findOneAsync({ email: user.email });
  if (clash && clash._id !== selfId) throw { status: 409, code: 'EMAIL_EXISTS', message: `A user with email ${user.email} already exists` };
  return user;
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

authRouter.get('/auth/options', wrap(async (_req, res) => res.json({ ...(await userOptions()), env: ENVS })));

const router = express.Router();

router.get(
  '/users',
  wrap(async (_req, res) => {
    const users = await store.getCollection('users');
    res.json((await users.findAsync({})).map(publicUser).sort(byName));
  })
);

router.get('/users/options', wrap(async (_req, res) => res.json(await userOptions())));

router.get(
  '/configurations',
  wrap(async (_req, res) => {
    const users = await (await store.getCollection('users')).findAsync({});
    res.json(
      (await configList()).map((c) => ({
        ...c,
        usedBy: users.filter((u) => u[CONFIG_TYPES[c.type]] === c.value).length,
      }))
    );
  })
);

router.post(
  '/configurations',
  wrap(async (req, res) => {
    const type = text(req.body?.type).toUpperCase();
    const value = text(req.body?.value).toLowerCase();
    if (!CONFIG_TYPES[type]) throw { status: 400, code: 'INVALID_TYPE', message: `TYPE must be one of ${TYPE_ORDER.join(', ')}` };
    if (!CONFIG_VALUE.test(value)) {
      throw { status: 400, code: 'INVALID_VALUE', message: 'VALUE must be 1–40 lower-case letters, digits or _ (no spaces or "-", it becomes part of the API base path)' };
    }
    await configList();
    const ds = await store.getCollection('configs');
    const doc = await store.withLock('configs', async () => {
      if (await ds.findOneAsync({ type, value })) throw { status: 409, code: 'CONFIG_EXISTS', message: `${type} "${value}" already exists` };
      const d = { _id: `${type}:${value}`, type, value, createdAt: new Date().toISOString() };
      await ds.insertAsync(d);
      return d;
    });
    res.status(201).json({ ...doc, usedBy: 0 });
  })
);

router.delete(
  '/configurations/:id',
  wrap(async (req, res) => {
    const ds = await store.getCollection('configs');
    const c = await ds.findOneAsync({ _id: req.params.id });
    if (!c) return res.status(404).json({ error: 'Configuration value not found' });
    const field = CONFIG_TYPES[c.type];
    const used = await (await store.getCollection('users')).countAsync({ [field]: c.value });
    if (used) throw { status: 409, code: 'CONFIG_IN_USE', message: `${c.type} "${c.value}" is used by ${used} user${used === 1 ? '' : 's'} – change them first` };
    await ds.removeAsync({ _id: c._id }, {});
    res.json({ deleted: c._id });
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
    res.json({ deleted: req.params.id });
  })
);

module.exports = { router, authRouter, authenticate, requireAdmin, canAccess, scopePrefix, generatePassword, userOptions, USER_SCOPE, ENVS, ADMIN_LOGIN };
