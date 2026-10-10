// Optional remote persistence in Redis (Upstash REST API) – for hosts without a persistent disk
// (Vercel, Render free). Enabled when these environment variables are set:
//   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN   (Upstash console)
//   or KV_REST_API_URL + KV_REST_API_TOKEN              (added by Vercel's Upstash integration)
// Optional: REMOTE_PREFIX (default "mockportal:") to share one database between several deployments.
//
// Layout (one value per record, so no request comes near Upstash's 10 MB request limit):
//   <p>version            counter, +1 on every change – instances reload when it moved
//   <p>registry           hash  apiKey -> API configuration (JSON)
//   <p>sample:<apiKey>    sample JSON (string)
//   <p>data:<apiKey>      hash  recordId -> {"b": body, "c": createdAt, "u": updatedAt}
// The NeDB files in DATA_DIR become a local working copy of this data.

const URL_ = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const PREFIX = process.env.REMOTE_PREFIX || 'mockportal:';
const enabled = !!(URL_ && TOKEN);
const MAX_BATCH_BYTES = 8 * 1024 * 1024; // stay below the 10 MB request limit

const k = {
  version: `${PREFIX}version`,
  registry: `${PREFIX}registry`,
  sample: (key) => `${PREFIX}sample:${key}`,
  data: (key) => `${PREFIX}data:${key}`,
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

/** one command, e.g. cmd('GET', key) */
async function cmd(...args) {
  const json = await post('', args);
  if (json.error) throw new Error(`Redis: ${json.error}`);
  return json.result;
}

/** many commands, sent in batches below the request size limit */
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

/** HGETALL returns [field, value, field, value, ...] */
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
