const URL_ = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const PREFIX = process.env.REMOTE_PREFIX || 'mockportal:';
const enabled = !!(URL_ && TOKEN);
const MAX_BATCH_BYTES = 8 * 1024 * 1024;

const k = {
  version: `${PREFIX}version`,
  registry: `${PREFIX}registry`,
  sample: (key) => `${PREFIX}sample:${key}`,
  data: (key) => `${PREFIX}data:${key}`,
  collection: (name) => `${PREFIX}admin:${name}`,
};

async function post(path, body) {
  const res = await fetch(URL_ + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Redis ${res.status}: ${json.error || res.statusText}`);
  return json;
}

async function cmd(...args) {
  const json = await post('', args);
  if (json.error) throw new Error(`Redis: ${json.error}`);
  return json.result;
}

async function pipeline(commands) {
  const results = [];
  let batch = [];
  let size = 0;
  const send = async () => {
    if (!batch.length) return;
    const out = await post('/pipeline', batch);
    for (const r of out) {
      if (r.error) throw new Error(`Redis: ${r.error}`);
      results.push(r.result);
    }
    batch = [];
    size = 0;
  };
  for (const c of commands) {
    const bytes = c.reduce((n, a) => n + String(a).length, 16);
    if (size + bytes > MAX_BATCH_BYTES) await send();
    batch.push(c);
    size += bytes;
  }
  await send();
  return results;
}

const pairs = (flat) => {
  const out = [];
  for (let i = 0; i + 1 < (flat || []).length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
};

async function getVersion() {
  const v = await cmd('GET', k.version);
  return v == null ? 0 : Number(v);
}

module.exports = { enabled, k, cmd, pipeline, pairs, getVersion, describe: () => (enabled ? `${new URL(URL_).host} (prefix ${PREFIX})` : 'off') };
