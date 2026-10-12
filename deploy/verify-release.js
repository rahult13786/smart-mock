const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = path.resolve(process.argv[2] || 'release');
const port = 4700 + Math.floor(Math.random() * 200);
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-release-'));
const fail = (msg) => {
  console.error(`  ✗ ${msg}`);
  process.exitCode = 1;
};

const child = spawn(process.execPath, ['src/index.js'], {
  cwd: path.join(dir, 'server'),
  env: { ...process.env, PORT: String(port), DATA_DIR: data, NODE_ENV: 'production', SEED_APIS: 'agreement@v1=samples/agreement.json', UPSTASH_REDIS_REST_URL: '', KV_REST_API_URL: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (d) => (log += d));
child.stderr.on('data', (d) => (log += d));

const timer = setTimeout(() => {
  fail(`server did not start within 20 s\n${log}`);
  child.kill();
}, 20000);

let token = '';
const check = async (url, test, label) => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, token ? { headers: { authorization: `Bearer ${token}` } } : undefined);
    const body = await res.text();
    if (res.status !== 200 || !test(body, res)) fail(`${label}: HTTP ${res.status} ${body.slice(0, 120)}`);
    else console.log(`  ✓ ${label}`);
  } catch (e) {
    fail(`${label}: ${e.message}`);
  }
};

const wait = setInterval(async () => {
  if (!log.includes('listening')) return;
  clearInterval(wait);
  clearTimeout(timer);
  await check('/health', (b) => JSON.parse(b).ok === true, 'GET /health');
  await check('/register', (b) => b.includes('<div id="root">'), 'portal page served');
  const anon = await fetch(`http://127.0.0.1:${port}/admin/apis`).catch(() => null);
  if (!anon || anon.status !== 401) fail(`GET /admin/apis without login: expected 401, got ${anon && anon.status}`);
  else console.log('  ✓ GET /admin/apis without login is refused (401)');
  try {
    const r = await fetch(`http://127.0.0.1:${port}/admin/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'smadmin', password: process.env.SMADMIN_PASSWORD || 'smadmin' }) });
    token = (await r.json()).token || '';
    if (!token) fail('smadmin login failed');
    else console.log('  ✓ smadmin login');
  } catch (e) {
    fail(`smadmin login: ${e.message}`);
  }
  await check('/admin/apis', (b) => JSON.parse(b).length === 1, 'GET /admin/apis (demo API seeded)');
  await check('/api/agreement/v1?fields=id,status', (b) => JSON.parse(b)[0]?.id, 'GET /api/agreement/v1?fields=id,status');
  child.kill();
}, 100);

child.on('exit', () => {
  clearInterval(wait);
  clearTimeout(timer);
  fs.rmSync(data, { recursive: true, force: true });
});
