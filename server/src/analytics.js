const express = require('express');
const morgan = require('morgan');
const store = require('./store');

const UNREGISTERED = '__unregistered__';
const stats = new Map();
const dirty = new Set();
let loading = null;
let timer = null;
let resolver = null;
const setResolver = (fn) => (resolver = fn);

function load() {
  if (!loading) {
    loading = store.getCollection('analytics').then(async (ds) => {
      for (const d of await ds.findAsync({})) if (!stats.has(d._id)) stats.set(d._id, d);
    });
    loading.catch(() => (loading = null));
  }
  return loading;
}

function schedule() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    persist().catch((e) => console.error('Analytics: saving failed –', e.message));
  }, 2000);
  timer.unref?.();
}

async function persist() {
  if (!dirty.size) return;
  const ds = await store.getCollection('analytics');
  const keys = [...dirty];
  dirty.clear();
  for (const key of keys) {
    const doc = stats.get(key);
    if (doc) await ds.updateAsync({ _id: key }, doc, { upsert: true });
  }
}

function record({ key, basePath, method, status, ms }) {
  let s = stats.get(key);
  if (!s) {
    s = { _id: key, basePath, requests: 0, success: 0, failed: 0, totalMs: 0, maxMs: 0, methods: {}, statuses: {}, firstAt: new Date().toISOString(), lastAt: null };
    stats.set(key, s);
  }
  s.basePath = basePath || s.basePath;
  s.requests++;
  if (status >= 200 && status < 400) s.success++;
  else s.failed++;
  s.totalMs += ms;
  s.maxMs = Math.max(s.maxMs, ms);
  s.methods[method] = (s.methods[method] || 0) + 1;
  s.statuses[status] = (s.statuses[status] || 0) + 1;
  s.lastAt = new Date().toISOString();
  dirty.add(key);
  schedule();
}

const apiOf = (req) => {
  if (req.mockApi) return req.mockApi;
  try {
    return resolver ? resolver(req.originalUrl) : null;
  } catch {
    return null;
  }
};

const format = (tokens, req, res) => {
  const api = apiOf(req);
  return JSON.stringify({
    key: api ? api._id : UNREGISTERED,
    basePath: api ? api.basePath : null,
    method: tokens.method(req, res),
    status: Number(tokens.status(req, res) || 0),
    ms: Number(tokens['response-time'](req, res) || 0),
  });
};

const logger = morgan(format, {
  skip: (req) => !/^\/apis?(\/|$)/.test(req.originalUrl) || String(req.headers['x-mock-portal'] || '') === '1',
  stream: {
    write: (line) => {
      try {
        const entry = JSON.parse(line);
        load().then(() => record(entry), () => record(entry));
      } catch {
        return;
      }
    },
  },
});

const round = (n) => Math.round(n * 10) / 10;

async function report() {
  await load();
  const rows = new Map();
  for (const api of store.listApis()) {
    rows.set(api._id, { key: api._id, name: api.name, version: api.version, basePath: api.basePath, env: api.env || null, registered: true, requests: 0, success: 0, failed: 0, avgMs: 0, maxMs: 0, methods: {}, statuses: {}, lastAt: null });
  }
  for (const s of stats.values()) {
    const base = rows.get(s._id) || {
      key: s._id,
      name: s._id === UNREGISTERED ? '(unregistered paths)' : s._id,
      version: '',
      basePath: s._id === UNREGISTERED ? '/api/…' : s.basePath,
      env: null,
      registered: false,
    };
    rows.set(s._id, {
      ...base,
      requests: s.requests,
      success: s.success,
      failed: s.failed,
      successRate: s.requests ? round((s.success / s.requests) * 100) : null,
      avgMs: s.requests ? round(s.totalMs / s.requests) : 0,
      maxMs: round(s.maxMs),
      methods: s.methods,
      statuses: s.statuses,
      lastAt: s.lastAt,
    });
  }
  const list = [...rows.values()].sort((a, b) => b.requests - a.requests || a.basePath.localeCompare(b.basePath));
  const total = list.reduce((t, r) => ({ requests: t.requests + r.requests, success: t.success + r.success, failed: t.failed + r.failed }), { requests: 0, success: 0, failed: 0 });
  return { since: [...stats.values()].map((s) => s.firstAt).sort()[0] || null, total, apis: list };
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const router = express.Router();

router.get('/analytics', wrap(async (_req, res) => res.json(await report())));

router.delete(
  '/analytics',
  wrap(async (_req, res) => {
    await load();
    stats.clear();
    dirty.clear();
    await (await store.getCollection('analytics')).removeAsync({}, { multi: true });
    res.json({ reset: true });
  })
);

module.exports = { logger, router, persist, report, setResolver };
