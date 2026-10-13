const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');

const PORT = 4999;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mockapi-'));
const SAMPLE = process.env.SAMPLE || path.join(__dirname, '..', '..', 'samples', 'agreement.json');

let token = '';
const SC = { domain: 'fixedline', team: 'bau', technology: 'ms', role: 'dev' };
const req = async (method, url, body, headers = {}) => {
  const auth = token && !('authorization' in headers) ? { authorization: `Bearer ${token}` } : {};
  const r = await fetch(BASE + url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json', ...auth, ...headers } : { ...auth, ...headers },
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  const text = await r.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
  return { status: r.status, json, headers: r.headers };
};

let passed = 0;
const step = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve) => srv.stdout.on('data', (d) => d.toString().includes('listening') && resolve()));

  try {
    const sample = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
    const id = sample[0].id;

    await step('unregistered GET/POST/PATCH fail with 404', async () => {
      assert.equal((await req('GET', '/api/fixedline-bau-ms-dev-dev/agreement/v1')).status, 404);
      assert.equal((await req('POST', '/api/fixedline-bau-ms-dev-dev/agreement/v1', { id: 'x' })).status, 404);
      assert.equal((await req('PATCH', '/api/fixedline-bau-ms-dev-dev/agreement/v1/x', { a: 1 })).status, 404);
    });

    await step('login: portal endpoints need a session; smadmin logs in', async () => {
      assert.equal((await req('GET', '/admin/apis')).status, 401);
      assert.equal((await req('POST', '/admin/auth/login', { email: 'smadmin', password: 'wrong' })).status, 401);
      const r = await req('POST', '/admin/auth/login', { email: 'SMADMIN', password: 'smadmin' });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.json.user.role, 'smadmin');
      assert.equal(r.json.user.isAdmin, true);
      token = r.json.token;
      assert.equal((await req('GET', '/admin/auth/me')).json.email, 'smadmin');
    });

    await step('register API', async () => {
      assert.equal((await req('POST', '/admin/apis', { name: 'Agreement', version: 'v1', env: 'dev' })).status, 400);
      const scope = { domain: 'fixedline', team: 'bau', technology: 'ms', role: 'dev', env: 'dev' };
      const r = await req('POST', '/admin/apis', { name: 'Agreement', version: 'v1', ...scope });
      assert.equal(r.status, 201, JSON.stringify(r.json));
      assert.equal(r.json.group, 'fixedline-bau-ms-dev-dev');
      assert.equal(r.json.maxRecords, 10);
      assert.equal((await req('POST', '/admin/apis', { name: 'agreement', version: 'v1', ...scope })).status, 409);
      assert.equal((await req('POST', '/admin/apis', { name: 'agreement', version: 'v1', ...scope, env: 'st' })).status, 201);
      assert.equal((await req('PATCH', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1', { maxRecords: 0 })).status, 400);
      assert.equal((await req('PATCH', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1', { maxRecords: 1000 })).json.maxRecords, 1000);
      assert.equal(r.json.basePath, '/api/fixedline-bau-ms-dev-dev/agreement/v1');
    });

    await step('save sample -> only id tags + seeded record', async () => {
      const r = await req('PUT', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/sample', { sample });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.json.seeded, 1);
      const paths = r.json.tags.map((t) => t.path);
      assert.ok(paths.every((p) => /(^|\.)id$/i.test(p)), paths.join());
      assert.ok(paths.includes('id') && paths.includes('agreementItem.productOfferingPrice.id'));
      const root = r.json.tags.find((t) => t.path === 'id');
      assert.equal(root.create, true);
      assert.equal(root.searchable, true);
      assert.equal(r.json.tags.find((t) => t.path === 'agreementItem.id').create, false);
    });

    await step('GET collection / summary / by id', async () => {
      const all = await req('GET', '/api/fixedline-bau-ms-dev-dev/agreement/v1');
      assert.equal(all.status, 200);
      assert.equal(all.json.length, 1);
      assert.deepEqual(all.json[0], sample[0]);
      const s = await req('GET', '/api/fixedline-bau-ms-dev-dev/agreement/v1?view=summary');
      assert.equal(s.json.total, 1);
      assert.equal(s.json.items[0].id, id);
      assert.equal((await req('GET', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${encodeURIComponent(id)}`)).json.name, sample[0].name);
      assert.equal((await req('GET', '/api/fixedline-bau-ms-dev-dev/agreement/v1/nope')).status, 404);
    });

    await step('POST: root id regenerated (create checked), kept for copies, duplicate 409', async () => {
      const r = await req('POST', '/api/fixedline-bau-ms-dev-dev/agreement/v1', { id: 'GIVEN-1', name: 'Second', status: 'Draft', '@type': 'Agreement' });
      assert.equal(r.status, 201, JSON.stringify(r.json));
      assert.notEqual(r.json.id, 'GIVEN-1');
      assert.match(r.json.id, /^MSA-\d{6}-\d{6}$/);
      const copy = await req('POST', '/api/fixedline-bau-ms-dev-dev/agreement/v1?generate=false', { id: 'COPY-1', name: 'Copy' });
      assert.equal(copy.json.id, 'COPY-1');
      await req('DELETE', '/api/fixedline-bau-ms-dev-dev/agreement/v1/COPY-1');
      const off = await req('PUT', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/tags', { tags: [{ path: 'id', create: false }] });
      assert.equal(off.json.tags.find((t) => t.path === 'id').create, false);
      const kept = await req('POST', '/api/fixedline-bau-ms-dev-dev/agreement/v1', { id: 'GIVEN-2', name: 'Kept' });
      assert.equal(kept.json.id, 'GIVEN-2');
      await req('DELETE', '/api/fixedline-bau-ms-dev-dev/agreement/v1/GIVEN-2');
      assert.equal((await req('POST', '/api/fixedline-bau-ms-dev-dev/agreement/v1', { id })).status, 409);
    });

    await step('search on searchable tags', async () => {
      const r = await req('GET', '/api/fixedline-bau-ms-dev-dev/agreement/v1?view=summary&name=second');
      assert.equal(r.json.total, 1);
      assert.equal((await req('GET', '/api/fixedline-bau-ms-dev-dev/agreement/v1?view=summary&q=second')).json.total, 1);
      const bad = await req('GET', '/api/fixedline-bau-ms-dev-dev/agreement/v1?doesNotExist=x');
      assert.equal(bad.status, 400);
      assert.equal(bad.json.code, 'FILTER_PATH_NOT_FOUND');
    });

    await step('/apis alias + JSON 404 for unknown routes', async () => {
      const r = await req('GET', `/apis/fixedline-bau-ms-dev-dev/agreement/v1/${id}`);
      assert.equal(r.status, 200);
      assert.equal(r.json.id, id);
      const r2 = await req('GET', '/apis/FIXEDLINE-BAU-MS-DEV-DEV/Agreement/v1');
      assert.equal(r2.status, 200);
      const nf = await req('GET', '/api/agreement');
      assert.equal(nf.status, 404);
      assert.ok(nf.json.error);
    });

    await step('GET ?id=a,b,c returns array in requested order', async () => {
      const second = (await req('GET', '/api/fixedline-bau-ms-dev-dev/agreement/v1?name=second')).json[0].id;
      const r = await req('GET', `/api/fixedline-bau-ms-dev-dev/agreement/v1?id=${second},${id},missing-1`);
      assert.equal(r.status, 200);
      assert.deepEqual(r.json.map((x) => x.id), [second, id]);
      assert.equal(r.headers.get('x-not-found-ids'), 'missing-1');
      const one = await req('GET', `/api/fixedline-bau-ms-dev-dev/agreement/v1?id=${id}`);
      assert.equal(one.json.length, 1);
    });

    await step('filter on a non-searchable / unconfigured path updates the configuration', async () => {
      const r = await req('GET', '/api/fixedline-bau-ms-dev-dev/agreement/v1?agreementType.like=physical&status.like=awaiting,draft');
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.json.length, 1);
      assert.match(r.headers.get('x-search-config-updated'), /agreementType/);
      const r2 = await req('GET', '/api/fixedline-bau-ms-dev-dev/agreement/v1?view=summary&characteristic.name.like=contract');
      assert.equal(r2.status, 200, JSON.stringify(r2.json));
      assert.equal(r2.json.total, 1);
      const api = (await req('GET', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1')).json;
      const t = api.tags.find((x) => x.path === 'characteristic.name');
      assert.ok(t && t.searchable && t.custom);
      const r3 = await req('GET', '/api/fixedline-bau-ms-dev-dev/agreement/v1?agreementType.like=physical');
      assert.equal(r3.headers.get('x-search-config-updated'), null);
    });

    await step('custom tags validated against sample', async () => {
      const bad = await req('PUT', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/tags', { tags: [{ path: 'agreementItem.nope', type: 'string', searchable: true }] });
      assert.equal(bad.status, 422);
      assert.equal(bad.json.code, 'PATH_NOT_IN_SAMPLE');
      assert.ok(bad.json.hint.includes('new version'));
      const mismatch = await req('POST', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/tags/validate', { tags: [{ path: 'agreementItem.productOfferingPrice.priceType', type: 'number' }] });
      assert.equal(mismatch.json.valid, false);
      assert.equal(mismatch.json.results[0].code, 'TYPE_MISMATCH');
      const obj = await req('POST', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/tags/validate', { tags: [{ path: 'agreementPeriod', type: 'string' }] });
      assert.equal(obj.json.results[0].code, 'NOT_A_VALUE');
      const ok = await req('PUT', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/tags', { tags: [{ path: 'agreementItem.productOfferingPrice.priceType', type: 'string', searchable: true }] });
      assert.equal(ok.status, 200, JSON.stringify(ok.json));
      assert.equal((await req('GET', '/api/fixedline-bau-ms-dev-dev/agreement/v1?view=summary&agreementItem.productOfferingPrice.priceType=recurring')).json.total, 1);
      const rm = await req('PUT', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/tags', { tags: [{ path: 'agreementItem.productOfferingPrice.priceType', remove: true }] });
      assert.ok(!rm.json.tags.some((x) => x.path === 'agreementItem.productOfferingPrice.priceType'));
    });

    await step('PATCH JSON Patch (RFC 6902)', async () => {
      const ops = [
        { op: 'replace', path: '/status', value: 'Patched' },
        { op: 'replace', path: '/agreementItem/0/productOfferingPrice/0/name', value: 'renamed' },
        { op: 'add', path: '/characteristic/-', value: { name: 'new', value: 'x' } },
      ];
      const r = await req('PATCH', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${id}`, ops, { 'content-type': 'application/json-patch+json' });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.headers.get('x-patch-mode'), 'json-patch');
      const g = (await req('GET', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${id}`)).json;
      assert.equal(g.status, 'Patched');
      assert.equal(g.agreementItem[0].productOfferingPrice[0].name, 'renamed');
      assert.equal(g.characteristic.at(-1).name, 'new');
      const bad = await req('PATCH', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${id}`, [{ op: 'replace', path: '/nope/x', value: 1 }], { 'content-type': 'application/json-patch+json' });
      assert.equal(bad.status, 422);
      const t = await req('PATCH', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${id}`, [{ op: 'test', path: '/status', value: 'other' }], { 'content-type': 'application/json-patch+json' });
      assert.equal(t.status, 409);
    });

    await step('PATCH Merge Patch (RFC 7396)', async () => {
      const r = await req('PATCH', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${id}`, { description: 'merged', agreementPeriod: { endDateTime: '2030-01-01T00:00:00Z' }, stcTarget: null }, { 'content-type': 'application/merge-patch+json' });
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('x-patch-mode'), 'merge');
      const g = (await req('GET', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${id}`)).json;
      assert.equal(g.description, 'merged');
      assert.equal(g.agreementPeriod.endDateTime, '2030-01-01T00:00:00Z');
      assert.equal(g.agreementPeriod.startDateTime, sample[0].agreementPeriod.startDateTime);
      assert.ok(!('stcTarget' in g));
      assert.equal((await req('PATCH', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${id}`, { id: 'other' })).status, 400);
    });

    await step('tags update reindexes', async () => {
      const r = await req('PUT', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/tags', { tags: [{ path: 'description', searchable: true }] });
      assert.equal(r.status, 200);
      assert.equal((await req('GET', '/api/fixedline-bau-ms-dev-dev/agreement/v1?view=summary&description.like=merg')).json.total, 1);
    });

    await step('enum on tags: configured, validated on POST and PATCH', async () => {
      const bad = await req('PUT', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/tags', { tags: [{ path: 'agreementType', enum: ['Standard Physical', 42] }] });
      assert.equal(bad.status, 400);
      const r = await req('PUT', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/tags', {
        tags: [
          { path: 'agreementType', enum: ['Standard Physical', 'Standard Digital'] },
          { path: 'characteristic.name', enum: ['Created Date', 'Modified Date'] },
        ],
      });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.deepEqual(r.json.tags.find((t) => t.path === 'agreementType').enum, ['Standard Physical', 'Standard Digital']);
      assert.ok(r.json.enumWarnings.some((w) => w.path === 'characteristic.name' && w.count > 0));
      const vals = await req('GET', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/values?path=characteristic.name');
      assert.ok(vals.json.length > 5);
      const p1 = await req('POST', '/api/fixedline-bau-ms-dev-dev/agreement/v1', { id: 'enum-1', agreementType: 'Wrong' });
      assert.equal(p1.status, 422);
      assert.equal(p1.json.code, 'ENUM_VIOLATION');
      assert.match(p1.json.error, /Wrong data sent on path "\/agreementType"/);
      assert.equal((await req('POST', '/api/fixedline-bau-ms-dev-dev/agreement/v1', { id: 'enum-2', agreementType: 'Standard Digital' })).status, 201);
      const p2 = await req('PATCH', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${id}`, [{ op: 'replace', path: '/characteristic/0/name', value: 'Bogus' }], { 'content-type': 'application/json-patch+json' });
      assert.equal(p2.status, 422);
      assert.equal(p2.json.violations[0].path, '/characteristic/0/name');
      const p3 = await req('PATCH', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${id}`, { description: 'enum ok' }, { 'content-type': 'application/merge-patch+json' });
      assert.equal(p3.status, 200, JSON.stringify(p3.json));
      const p4 = await req('PATCH', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${id}`, { agreementType: 'Standard Digital' });
      assert.equal(p4.status, 200);
      const again = await req('PUT', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/sample', { sample, seed: false });
      assert.ok(again.json.tags.find((t) => t.path === 'agreementType').enum);
      const rm = await req('PUT', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/tags', { tags: [{ path: 'agreementType', enum: [] }, { path: 'characteristic.name', enum: null }] });
      assert.ok(!rm.json.tags.find((t) => t.path === 'agreementType').enum);
      assert.equal((await req('POST', '/api/fixedline-bau-ms-dev-dev/agreement/v1', { id: 'enum-3', agreementType: 'Anything' })).status, 201);
    });

    await step('DELETE record', async () => {
      const d = await req('DELETE', '/api/fixedline-bau-ms-dev-dev/agreement/v1/enum-3');
      assert.equal(d.status, 200);
      assert.equal((await req('GET', '/api/fixedline-bau-ms-dev-dev/agreement/v1/enum-3')).status, 404);
      assert.equal((await req('DELETE', '/api/fixedline-bau-ms-dev-dev/agreement/v1/enum-3')).status, 404);
      const before = (await req('GET', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${id}`)).json.engagedParty.length;
      const r = await req('PATCH', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${id}`, [{ op: 'remove', path: '/engagedParty/0' }], { 'content-type': 'application/json-patch+json' });
      assert.equal(r.json.engagedParty.length, before - 1);
    });

    await step('unique tags: validation rules', async () => {
      const root = await req('PUT', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/tags', { tags: [{ path: 'name', unique: true }] });
      assert.equal(root.status, 422);
      assert.equal(root.json.code, 'INVALID_UNIQUE');
      const add = await req('PUT', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/tags', { tags: [{ path: 'agreementItem.productOfferingPrice.name', type: 'string' }] });
      assert.equal(add.status, 200);
      const withId = await req('PUT', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/tags', { tags: [{ path: 'agreementItem.productOfferingPrice.name', unique: true }] });
      assert.equal(withId.status, 422);
      assert.match(withId.json.error, /already their key/);
      const ok = await req('PUT', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/tags', {
        tags: [{ path: 'characteristic.name', unique: true }, { path: 'agreementItem.characteristic.name', type: 'string', unique: true }],
      });
      assert.equal(ok.status, 200, JSON.stringify(ok.json));
      const t = ok.json.tags.find((x) => x.path === 'characteristic.name');
      assert.equal(t.unique, true);
      assert.equal(t.uniqueIn, 'characteristic');
      assert.ok(ok.json.uniqueWarnings.some((w) => w.path === 'characteristic.name'));
    });

    await step('PATCH paths: id -> unique key -> index', async () => {
      const rec = (await req('GET', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${id}`)).json;
      const itemId = rec.agreementItem[0].id;
      const popId = rec.agreementItem[0].productOfferingPrice[1].id;
      const jp = (ops, q = '') => req('PATCH', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${id}${q}`, ops, { 'content-type': 'application/json-patch+json' });
      let r = await jp([{ op: 'replace', path: `/agreementItem/${itemId}/productOfferingPrice/1/price/value`, value: 111 }]);
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.json.agreementItem[0].productOfferingPrice[1].price.value, 111);
      assert.match(r.headers.get('x-patch-resolved'), /\/agreementItem\/0\/productOfferingPrice\/1\/price\/value/);
      r = await jp([{ op: 'replace', path: `/agreementItem/${itemId}/productOfferingPrice/${popId}/priceType`, value: 'ById' }]);
      assert.equal(r.json.agreementItem[0].productOfferingPrice[1].priceType, 'ById');
      const ci = r.json.characteristic.findIndex((c) => c.name === 'Contract level');
      r = await jp([{ op: 'replace', path: '/characteristic/Contract level/value', value: 'Enterprise' }]);
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.json.characteristic[ci].value, 'Enterprise');
      r = await jp([{ op: 'replace', path: `/agreementItem/${itemId}/characteristic/Validity End Date/value`, value: 'x' }]);
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.json.agreementItem[0].characteristic.find((c) => c.name === 'Validity End Date').value, 'x');
      const dupName = (() => { const seen = new Set(); for (const c of r.json.characteristic) { if (seen.has(c.name)) return c.name; seen.add(c.name); } })();
      if (dupName) assert.equal((await jp([{ op: 'replace', path: `/characteristic/${dupName}/value`, value: 'y' }])).status, 409);
      const nf = await jp([{ op: 'replace', path: '/agreementItem/NOPE/name', value: 1 }]);
      assert.equal(nf.status, 422);
      assert.equal(nf.json.code, 'ITEM_NOT_FOUND');
      const before = r.json.agreementItem[0].productOfferingPrice.length;
      r = await jp([{ op: 'remove', path: `/agreementItem/${itemId}/productOfferingPrice/${popId}` }]);
      assert.equal(r.json.agreementItem[0].productOfferingPrice.length, before - 1);
      assert.notEqual(r.json.agreementItem[0].productOfferingPrice[1].id, popId);
      assert.equal((await jp([{ op: 'replace', path: `/agreementItem/${itemId}/name`, value: 1 }], '?pathMode=index')).status, 422);
      const m = await req('PATCH', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${id}`, {
        agreementItem: { [itemId]: { productOfferingPrice: { 0: { priceType: 'Merged' } } } },
        characteristic: { 'Contract level': { value: 'Merged value' } },
      }, { 'content-type': 'application/merge-patch+json' });
      assert.equal(m.status, 200, JSON.stringify(m.json));
      assert.equal(m.json.agreementItem[0].productOfferingPrice[0].priceType, 'Merged');
      assert.equal(m.json.characteristic[ci].value, 'Merged value');
      assert.ok(Array.isArray(m.json.agreementItem));
    });

    await step('root id always unique; nested ids unique only when chosen', async () => {
      const api = (await req('GET', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1')).json;
      assert.equal(api.tags.find((t) => t.path === 'id').unique, true);
      assert.ok(!api.tags.find((t) => t.path === 'agreementSpecification.id').unique);
      assert.ok(!api.tags.find((t) => t.path === 'agreementItem.productOfferingPrice.id').unique);
      const r = await req('PUT', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/tags', { tags: [{ path: 'id', unique: false }, { path: 'agreementItem.productOfferingPrice.id', unique: true }] });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.json.tags.find((t) => t.path === 'id').unique, true);
      const pop = r.json.tags.find((t) => t.path === 'agreementItem.productOfferingPrice.id');
      assert.equal(pop.unique, true);
      assert.equal(pop.uniqueIn, 'agreementItem.productOfferingPrice');
      const off = await req('PUT', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/tags', { tags: [{ path: 'agreementItem.productOfferingPrice.id', unique: false }] });
      assert.ok(!off.json.tags.find((t) => t.path === 'agreementItem.productOfferingPrice.id').unique);
    });

    await step('TMF630 GET: filter (equality / like / ne), fields, sort, offset, limit', async () => {
      await req('PATCH', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${id}`, { status: 'Awaiting approval' });
      const f = await req('GET', '/api/fixedline-bau-ms-dev-dev/agreement/v1?status=Awaiting approval&version=1');
      assert.equal(f.json.length, 1);
      assert.equal(f.status, 200);
      const cfg = (await req('GET', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1')).json;
      assert.equal(cfg.tags.find((t) => t.path === 'version').searchable, true);
      assert.equal(cfg.tags.find((t) => t.path === 'status').searchable, true);
      assert.equal((await req('GET', '/api/fixedline-bau-ms-dev-dev/agreement/v1?status=awaiting')).json.length, 0);
      assert.equal((await req('GET', '/api/fixedline-bau-ms-dev-dev/agreement/v1?status=AWAITING APPROVAL')).json.length, 1);
      assert.equal((await req('GET', '/api/fixedline-bau-ms-dev-dev/agreement/v1?status.like=await')).json.length, 1);
      assert.ok((await req('GET', '/api/fixedline-bau-ms-dev-dev/agreement/v1?status.ne=Awaiting approval')).json.every((x) => x.status !== 'Awaiting approval'));
      const fo = await req('GET', '/api/fixedline-bau-ms-dev-dev/agreement/v1?fields=name,description');
      assert.deepEqual(Object.keys(fo.json[0]).sort(), ['description', 'id', 'name'].filter((k) => k in fo.json[0]).sort());
      assert.ok(!('agreementItem' in fo.json[0]));
      const ff = await req('GET', `/api/fixedline-bau-ms-dev-dev/agreement/v1?id=${id}&fields=id,name,agreementItem.id,agreementItem.productOfferingPrice.id,characteristic`);
      const one = ff.json[0];
      assert.deepEqual(Object.keys(one).sort(), ['agreementItem', 'characteristic', 'id', 'name']);
      assert.deepEqual(Object.keys(one.agreementItem[0]).sort(), ['id', 'productOfferingPrice']);
      assert.deepEqual(Object.keys(one.agreementItem[0].productOfferingPrice[0]), ['id']);
      assert.ok(one.characteristic[0].name);
      const sf = await req('GET', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${id}?fields=status`);
      assert.deepEqual(Object.keys(sf.json).sort(), ['id', 'status']);
      await req('POST', '/api/fixedline-bau-ms-dev-dev/agreement/v1', [{ id: 's-b', name: 'Bravo', version: '2' }, { id: 's-a', name: 'Alpha', version: '10' }, { id: 's-c', name: 'Charlie', version: '2' }]);
      const asc = await req('GET', '/api/fixedline-bau-ms-dev-dev/agreement/v1?id=s-a,s-b,s-c&sort=name&fields=name');
      assert.deepEqual(asc.json.map((x) => x.name), ['Alpha', 'Bravo', 'Charlie']);
      const multi = await req('GET', '/api/fixedline-bau-ms-dev-dev/agreement/v1?id=s-a,s-b,s-c&sort=-version,name&fields=name,version');
      assert.deepEqual(multi.json.map((x) => x.id), ['s-a', 's-b', 's-c']);
      const page = await req('GET', '/api/fixedline-bau-ms-dev-dev/agreement/v1?id=s-a,s-b,s-c&sort=-name&offset=1&limit=1&fields=name');
      assert.deepEqual(page.json.map((x) => x.name), ['Bravo']);
      assert.equal(page.headers.get('x-total-count'), '3');
      assert.equal(page.headers.get('x-result-count'), '1');
      const upd = await req('GET', '/api/fixedline-bau-ms-dev-dev/agreement/v1?sort=-updatedAt&limit=1&fields=id');
      assert.equal(upd.status, 200);
      const tmf = await req('GET', `/api/fixedline-bau-ms-dev-dev/agreement/v1?status=Awaiting approval&fields=id,name,description,status,agreementItem.id,agreementItem.status,characteristic&sort=-updatedAt,name&offset=0&limit=20`);
      assert.equal(tmf.status, 200);
      for (const sid of ['s-a', 's-b', 's-c']) await req('DELETE', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${sid}`);
    });

    await step('create mocks', async () => {
      const plan = (await req('GET', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/mocks/plan?source=sample:0')).json;
      assert.equal(plan.max, 10);
      assert.equal(plan.idPaths[0].path, 'id');
      assert.ok(plan.idPaths.some((p) => p.path === 'agreementItem.productOfferingPrice.id' && p.count >= 1000));
      const cv = plan.fields.find((f) => f.path === 'characteristic.value');
      assert.ok(cv.filterKeys.some((k) => k.key === 'name'));
      assert.equal((await req('POST', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/mocks', { count: 11 })).status, 400);
      const r = await req('POST', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/mocks', {
        source: 'sample:0',
        count: 3,
        idRules: [
          { path: 'id', values: ['MOCK-1', 'MOCK-2'], auto: true, replaceAll: true },
          { path: 'agreementItem.id', auto: true },
        ],
        fieldRules: [
          { path: 'status', values: ['Approved', 'Rejected', 'Approved'] },
          { path: 'description', auto: true },
          { path: 'characteristic.value', values: ['Gold'], filter: { key: 'name', value: 'Contract level' } },
        ],
      });
      assert.equal(r.status, 201, JSON.stringify(r.json));
      assert.equal(r.json.created.length, 3);
      assert.deepEqual(r.json.created.slice(0, 2).map((c) => c.id), ['MOCK-1', 'MOCK-2']);
      const m1 = (await req('GET', '/api/fixedline-bau-ms-dev-dev/agreement/v1/MOCK-1')).json;
      assert.equal(m1.status, 'Approved');
      assert.equal(m1.stcAgreementBusinessId, 'MOCK-1');
      assert.notEqual(m1.agreementItem[0].id, sample[0].agreementItem[0].id);
      assert.equal(m1.characteristic.find((c) => c.name === 'Contract level').value, 'Gold');
      assert.equal(m1.characteristic.find((c) => c.name === 'Created Date').value, sample[0].characteristic.find((c) => c.name === 'Created Date').value);
      const m3 = (await req('GET', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${r.json.created[2].id}`)).json;
      assert.match(m3.id, /^MSA-\d{6}-\d{6}$/);
      assert.notEqual(m3.characteristic.find((c) => c.name === 'Contract level').value, undefined);
      const all = (await req('GET', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/mocks/current?source=sample:0&path=characteristic.value')).json;
      assert.ok(all.count > 10);
      const one = (await req('GET', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/mocks/current?source=sample:0&path=characteristic.value&filterKey=name&filterValue=Contract%20level')).json;
      assert.deepEqual(one, { count: 1, values: ['Service'] });
      const popId = sample[0].agreementItem[0].productOfferingPrice[3].id;
      const nested = (await req('GET', `/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/mocks/current?source=sample:0&path=agreementItem.productOfferingPrice.price.value&filterKey=id&filterValue=${popId}`)).json;
      assert.equal(nested.count, 1);
      const pv = plan.fields.find((f) => f.path === 'agreementItem.productOfferingPrice.price.value');
      assert.equal(pv.listPath, 'agreementItem.productOfferingPrice');
      const ru = await req('POST', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/mocks', {
        count: 1,
        idRules: [{ path: 'id', values: ['MOCK-R'], replaceAll: true }, { path: 'agreementItem.id', auto: true, reuse: true }],
        fieldRules: [
          { path: 'status', auto: true, reuse: true },
          { path: 'agreementItem.productOfferingPrice.price.value', values: ['999'], filter: { key: 'id', value: popId } },
        ],
      });
      assert.equal(ru.status, 201, JSON.stringify(ru.json));
      const mr = (await req('GET', '/api/fixedline-bau-ms-dev-dev/agreement/v1/MOCK-R')).json;
      assert.equal(mr.agreementItem[0].id, sample[0].agreementItem[0].id);
      assert.equal(mr.stcAgreementBusinessId, 'MOCK-R');
      assert.equal(mr.agreementItem[0].productOfferingPrice[3].price.value, 999);
      assert.equal(mr.agreementItem[0].productOfferingPrice[4].price.value, sample[0].agreementItem[0].productOfferingPrice[4].price.value);
      assert.equal((await req('POST', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/mocks', { count: 1, idRules: [{ path: 'id', reuse: true }] })).status, 400);
      const clash = await req('POST', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/mocks', { count: 1, idRules: [{ path: 'id', values: ['MOCK-1'] }] });
      assert.equal(clash.status, 409);
    });

    await step('must: required data on POST and PATCH op add', async () => {
      const T = '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/tags';
      const t = await req('PUT', T, { tags: [{ path: 'name', must: true }, { path: 'agreementItem.stcAgreementItemBusinessId', type: 'string', must: true }] });
      assert.equal(t.status, 200, JSON.stringify(t.json));
      assert.equal(t.json.tags.find((x) => x.path === 'name').must, true);
      const p1 = await req('POST', '/api/fixedline-bau-ms-dev-dev/agreement/v1', { id: 'must-1', status: 'x' });
      assert.equal(p1.status, 422);
      assert.equal(p1.json.code, 'MUST_VIOLATION');
      assert.match(p1.json.error, /"\/name"/);
      assert.equal((await req('POST', '/api/fixedline-bau-ms-dev-dev/agreement/v1', { id: 'must-1', name: '' })).status, 422);
      const bad = await req('POST', '/api/fixedline-bau-ms-dev-dev/agreement/v1', { id: 'must-1', name: 'n', agreementItem: [{ id: 'i' }] });
      assert.equal(bad.status, 422);
      assert.equal(bad.json.violations[0].path, '/agreementItem/0/stcAgreementItemBusinessId');
      assert.equal((await req('POST', '/api/fixedline-bau-ms-dev-dev/agreement/v1', { id: 'must-1', name: 'ok' })).status, 201);
      const jp = (ops, q = '') => req('PATCH', `/api/fixedline-bau-ms-dev-dev/agreement/v1/must-1${q}`, ops, { 'content-type': 'application/json-patch+json' });
      const a1 = await jp([{ op: 'add', path: '/agreementItem', value: [{ id: 'it-1' }] }]);
      assert.equal(a1.status, 422);
      assert.equal(a1.json.violations[0].path, '/agreementItem/0/stcAgreementItemBusinessId');
      const a2 = await jp([{ op: 'add', path: '/agreementItem', value: [{ id: 'it-1', stcAgreementItemBusinessId: 'B1' }] }]);
      assert.equal(a2.status, 200, JSON.stringify(a2.json));
      assert.equal((await jp([{ op: 'add', path: '/agreementItem/-', value: { id: 'it-2' } }])).status, 422);
      assert.equal((await jp([{ op: 'add', path: '/agreementItem/0/stcAgreementItemBusinessId', value: '' }])).status, 422);
      assert.equal((await jp([{ op: 'replace', path: '/name', value: 'y' }])).status, 200);
    });

    await step('create (post) + regex: ids generated for new resources and sub-resources', async () => {
      const T = '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/tags';
      const jp = (ops, q = '') => req('PATCH', `/api/fixedline-bau-ms-dev-dev/agreement/v1/must-1${q}`, ops, { 'content-type': 'application/json-patch+json' });
      assert.equal((await req('GET', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/tags/regex?path=name')).status, 400);
      const rg = (await req('GET', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/tags/regex?path=agreementItem.id')).json;
      assert.equal(rg.built, 'MSA\\-\\d{6}\\-\\d{6}\\-\\d\\-\\d');
      assert.ok(rg.examples.length && rg.examples.every((e) => new RegExp(`^${rg.built}$`).test(e)));
      const pop = (await req('GET', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/tags/regex?path=agreementItem.productOfferingPrice.id')).json;
      assert.equal(pop.built, '\\d{9}');
      assert.equal((await req('GET', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/tags/regex?path=id&pattern=(')).status, 400);
      const on = await req('PUT', T, { tags: [{ path: 'agreementItem.id', regex: { enabled: true, built: rg.built } }] });
      assert.equal(on.status, 200, JSON.stringify(on.json));
      assert.equal(on.json.tags.find((x) => x.path === 'agreementItem.id').regex.enabled, true);
      let r = await jp([{ op: 'add', path: '/agreementItem/-', value: { stcAgreementItemBusinessId: 'B2' } }]);
      assert.match(r.json.agreementItem.at(-1).id, /^MSA-\d{6}-\d{6}-\d-\d$/);
      r = await jp([{ op: 'add', path: '/agreementItem/-', value: { id: 'KEEP', stcAgreementItemBusinessId: 'B3' } }]);
      assert.equal(r.json.agreementItem.at(-1).id, 'KEEP');
      const ov = await req('PUT', T, { tags: [{ path: 'agreementItem.id', create: true, regex: { enabled: true, override: true, pattern: 'ITEM-[0-9]{4}', built: rg.built } }] });
      assert.equal(ov.status, 200, JSON.stringify(ov.json));
      r = await jp([{ op: 'add', path: '/agreementItem/-', value: { id: 'KEEP2', stcAgreementItemBusinessId: 'B4' } }]);
      assert.match(r.json.agreementItem.at(-1).id, /^ITEM-\d{4}$/);
      r = await jp([{ op: 'add', path: '/agreementItem/-', value: { id: 'COPY-ITEM', stcAgreementItemBusinessId: 'B5' } }], '?generate=false');
      assert.equal(r.json.agreementItem.at(-1).id, 'COPY-ITEM');
      r = await jp([{ op: 'replace', path: '/agreementItem/0/id', value: 'REPLACED' }]);
      assert.equal(r.json.agreementItem[0].id, 'REPLACED');
      const p = await req('POST', '/api/fixedline-bau-ms-dev-dev/agreement/v1', { id: 'must-2', name: 'n', agreementItem: [{ id: 'a', stcAgreementItemBusinessId: 'x' }] });
      assert.match(p.json.agreementItem[0].id, /^ITEM-\d{4}$/);
      assert.equal((await req('PUT', T, { tags: [{ path: 'id', regex: { enabled: true, override: true, pattern: '(' } }] })).status, 400);
      await req('PUT', T, { tags: [{ path: 'id', create: true, regex: { enabled: true, override: true, pattern: 'REC-\\d{5}' } }] });
      const rec = await req('POST', '/api/fixedline-bau-ms-dev-dev/agreement/v1', { id: 'given', name: 'r' });
      assert.match(rec.json.id, /^REC-\d{5}$/);
      const again = await req('PUT', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/sample', { sample, seed: false });
      const rootTag = again.json.tags.find((t) => t.path === 'id');
      assert.equal(rootTag.regex.pattern, 'REC-\\d{5}');
      assert.equal(again.json.tags.find((t) => t.path === 'name').must, true);
    });

    await step('create (post) on any tag fills missing values; map copies a parent / sibling value', async () => {
      const T = '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/tags';
      const r = await req('PUT', T, {
        tags: [
          { path: 'status', type: 'string', create: true, enum: ['Draft', 'Approved'] },
          { path: 'agreementPeriod.startDateTime', type: 'string', create: true },
          { path: 'agreementItem.productOfferingPrice.priceType', type: 'string', create: true },
        ],
      });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      const p = await req('POST', '/api/fixedline-bau-ms-dev-dev/agreement/v1', { name: 'fill', agreementItem: [{ stcAgreementItemBusinessId: 'B', productOfferingPrice: [{ id: 'p1' }, { id: 'p2', priceType: 'kept' }] }] });
      assert.equal(p.status, 201, JSON.stringify(p.json));
      assert.ok(['Draft', 'Approved'].includes(p.json.status));
      assert.ok(p.json.agreementPeriod.startDateTime);
      assert.ok(p.json.agreementItem[0].productOfferingPrice[0].priceType);
      assert.equal(p.json.agreementItem[0].productOfferingPrice[1].priceType, 'kept');
      const cand = (await req('GET', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/tags/map?path=agreementItem.productOfferingPrice.name')).json.candidates.map((c) => c.path);
      assert.ok(cand.includes('agreementItem.productOfferingPrice.priceType') && cand.includes('agreementItem.stcAgreementItemBusinessId') && cand.includes('name'));
      assert.ok(!cand.includes('agreementItem.productOfferingPrice.price.value'));
      assert.equal((await req('GET', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/tags/map?path=id')).status, 400);
      const bad = await req('PUT', T, { tags: [{ path: 'agreementItem.productOfferingPrice.name', type: 'string', map: { enabled: true, source: 'agreementItem.productOfferingPrice.price.value' } }] });
      assert.equal(bad.status, 400);
      assert.equal(bad.json.code, 'INVALID_MAP');
      const ok = await req('PUT', T, {
        tags: [
          { path: 'agreementItem.productOfferingPrice.name', type: 'string', map: { enabled: true, source: 'agreementItem.stcAgreementItemBusinessId' } },
          { path: 'stcAgreementBusinessId', type: 'string', map: { enabled: true, source: 'id' } },
        ],
      });
      assert.equal(ok.status, 200, JSON.stringify(ok.json));
      assert.equal(ok.json.tags.find((t) => t.path === 'stcAgreementBusinessId').map.source, 'id');
      const m = await req('POST', '/api/fixedline-bau-ms-dev-dev/agreement/v1', { name: 'map', stcAgreementBusinessId: 'old', agreementItem: [{ stcAgreementItemBusinessId: 'ITEMKEY', productOfferingPrice: [{ id: 'q1', name: 'x' }] }] });
      assert.equal(m.status, 201, JSON.stringify(m.json));
      assert.equal(m.json.stcAgreementBusinessId, m.json.id);
      assert.equal(m.json.agreementItem[0].productOfferingPrice[0].name, 'ITEMKEY');
      const jp = await req('PATCH', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${encodeURIComponent(m.json.id)}`, [{ op: 'add', path: '/agreementItem/0/productOfferingPrice/-', value: { id: 'q2' } }], { 'content-type': 'application/json-patch+json' });
      assert.equal(jp.status, 200, JSON.stringify(jp.json));
      const added = jp.json.agreementItem[0].productOfferingPrice.at(-1);
      assert.equal(added.name, 'ITEMKEY');
      assert.ok(added.priceType);
      const copy = await req('POST', '/api/fixedline-bau-ms-dev-dev/agreement/v1?generate=false', { id: 'copy-map', name: 'c', stcAgreementBusinessId: 'keep' });
      assert.equal(copy.json.stcAgreementBusinessId, 'keep');
      assert.ok(!copy.json.status);
      const en = await req('PUT', T, { tags: [{ path: 'stcAgreementBusinessId', enum: ['A'] }] });
      assert.ok(!en.json.tags.find((t) => t.path === 'stcAgreementBusinessId').map);
      await req('PUT', T, { tags: [{ path: 'stcAgreementBusinessId', enum: [] }, { path: 'status', create: false, enum: [] }, { path: 'agreementPeriod.startDateTime', create: false }, { path: 'agreementItem.productOfferingPrice.priceType', create: false }, { path: 'agreementItem.productOfferingPrice.name', map: null }] });
    });

    await step('POST / PATCH return the final stored payload', async () => {
      await req('PUT', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/tags', { tags: [{ path: 'id', create: true }, { path: 'status', create: true }, { path: 'stcAgreementBusinessId', map: { enabled: true, source: 'id' } }] });
      const p = await req('POST', '/api/fixedline-bau-ms-dev-dev/agreement/v1', { id: 'client-id', name: 'final', agreementItem: [{ id: 'i1', stcAgreementItemBusinessId: 'k' }] });
      assert.equal(p.status, 201, JSON.stringify(p.json));
      const stored = (await req('GET', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${encodeURIComponent(p.json.id)}`)).json;
      assert.deepEqual(p.json, stored);
      assert.notEqual(p.json.id, 'client-id');
      assert.equal(p.json.stcAgreementBusinessId, p.json.id);
      assert.ok(p.json.status);
      assert.equal(p.headers.get('location'), `/api/fixedline-bau-ms-dev-dev/agreement/v1/${encodeURIComponent(p.json.id)}`);
      const many = await req('POST', '/api/fixedline-bau-ms-dev-dev/agreement/v1', [{ name: 'm1' }, { name: 'm2' }]);
      assert.equal(many.json.length, 2);
      for (const r of many.json) assert.deepEqual(r, (await req('GET', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${encodeURIComponent(r.id)}`)).json);
      const jp = await req('PATCH', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${encodeURIComponent(p.json.id)}`, [{ op: 'replace', path: '/name', value: 'patched' }, { op: 'add', path: '/agreementItem/-', value: { stcAgreementItemBusinessId: 'k2' } }], { 'content-type': 'application/json-patch+json' });
      assert.equal(jp.status, 200, JSON.stringify(jp.json));
      const after = (await req('GET', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${encodeURIComponent(p.json.id)}`)).json;
      assert.deepEqual(jp.json, after);
      assert.equal(jp.json.name, 'patched');
      assert.equal(jp.json.agreementItem.length, 2);
      const mp = await req('PATCH', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${encodeURIComponent(p.json.id)}`, { description: 'merged' }, { 'content-type': 'application/merge-patch+json' });
      assert.deepEqual(mp.json, (await req('GET', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${encodeURIComponent(p.json.id)}`)).json);
      assert.equal(mp.json.agreementItem.length, 2);
      await req('PUT', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/tags', { tags: [{ path: 'id', create: false }, { path: 'status', create: false }, { path: 'stcAgreementBusinessId', map: null }] });
    });

    let userId;
    await step('admin users: create, list masked, copy password, edit, delete', async () => {
      const gen = (await req('GET', '/admin/users/password')).json.password;
      assert.equal(gen.length, 16);
      assert.equal((await req('POST', '/admin/users', { firstName: 'A' })).status, 400);
      assert.equal((await req('POST', '/admin/users', { firstName: 'A', lastName: 'B', email: 'nope' })).json.code, 'INVALID_EMAIL');
      const c = await req('POST', '/admin/users', { firstName: 'Rahul', lastName: 'T', email: 'Rahul@Example.com', password: gen, ...SC });
      assert.equal(c.status, 201, JSON.stringify(c.json));
      assert.equal(c.json.password, '******');
      assert.equal(c.json.email, 'rahul@example.com');
      assert.equal(c.json.active, true);
      userId = c.json._id;
      assert.equal((await req('GET', `/admin/users/${userId}/password`)).json.password, gen);
      const weak = await req('POST', '/admin/users', { firstName: 'B', lastName: 'C', email: 'b@example.com', password: 'abc', ...SC });
      const weakPw = (await req('GET', `/admin/users/${weak.json._id}/password`)).json.password;
      assert.notEqual(weakPw, 'abc');
      assert.equal(weakPw.length, 16);
      assert.equal((await req('POST', '/admin/users', { firstName: 'X', lastName: 'Y', email: 'rahul@example.com', ...SC })).status, 409);
      const list = (await req('GET', '/admin/users')).json;
      assert.equal(list.length, 2);
      assert.ok(list.every((u) => u.password === '******'));
      const e = await req('PATCH', `/admin/users/${userId}`, { firstName: 'Rahul K', active: false });
      assert.equal(e.json.firstName, 'Rahul K');
      assert.equal(e.json.active, false);
      assert.equal((await req('PATCH', `/admin/users/${userId}`, { password: 'x' })).status, 400);
      assert.equal((await req('PATCH', `/admin/users/${userId}`, { email: 'b@example.com' })).status, 409);
      assert.equal((await req('GET', `/admin/users/${userId}/password`)).json.password, gen);
      assert.equal((await req('DELETE', `/admin/users/${weak.json._id}`)).status, 200);
      assert.equal((await req('GET', '/admin/users')).json.length, 1);
    });

    await step('configurations: values for Domain / Team / Technology / Role are configurable', async () => {
      const list = (await req('GET', '/admin/configurations')).json;
      assert.deepEqual(list.map((c) => `${c.type}:${c.value}`), ['DOMAIN:fixedline', 'DOMAIN:gsm', 'TEAM:bau', 'TEAM:project', 'TECHNOLOGY:ms', 'TECHNOLOGY:esb', 'TECHNOLOGY:portal', 'ROLE:dev', 'ROLE:test']);
      assert.equal(list.find((c) => c.value === 'fixedline').usedBy, 1);
      assert.equal((await req('POST', '/admin/configurations', { type: 'COLOR', value: 'x' })).json.code, 'INVALID_TYPE');
      assert.equal((await req('POST', '/admin/configurations', { type: 'DOMAIN', value: 'fixed line' })).json.code, 'INVALID_VALUE');
      const add = await req('POST', '/admin/configurations', { type: 'domain', value: 'Wholesale' });
      assert.equal(add.status, 201, JSON.stringify(add.json));
      assert.equal(add.json.value, 'wholesale');
      assert.equal((await req('POST', '/admin/configurations', { type: 'DOMAIN', value: 'wholesale' })).status, 409);
      assert.ok((await req('GET', '/admin/users/options')).json.domain.includes('wholesale'));
      assert.ok((await req('GET', '/admin/auth/options')).json.domain.includes('wholesale'));
      const u = await req('POST', '/admin/users', { firstName: 'W', lastName: 'S', email: 'w@example.com', ...SC, domain: 'wholesale' });
      assert.equal(u.status, 201, JSON.stringify(u.json));
      assert.equal((await req('DELETE', '/admin/configurations/DOMAIN:wholesale')).json.code, 'CONFIG_IN_USE');
      await req('DELETE', `/admin/users/${u.json._id}`);
      assert.equal((await req('DELETE', '/admin/configurations/DOMAIN:wholesale')).status, 200);
      assert.equal((await req('POST', '/admin/users', { firstName: 'W', lastName: 'S', email: 'w@example.com', ...SC, domain: 'wholesale' })).status, 400);
      const api = await req('POST', '/admin/apis', { name: 'x', version: 'v1', ...SC, domain: 'wholesale', env: 'dev' });
      assert.equal(api.status, 400);
    });

    await step('users: scope fields required; normal user logs in and sees only own APIs', async () => {
      assert.equal((await req('POST', '/admin/users', { firstName: 'N', lastName: 'U', email: 'n@example.com' })).json.code, 'INVALID_USER');
      assert.equal((await req('POST', '/admin/users', { firstName: 'N', lastName: 'U', email: 'n@example.com', ...SC, technology: 'portal', role: 'qa' })).status, 400);
      const u = await req('POST', '/admin/users', { firstName: 'Gsm', lastName: 'Tester', email: 'gsm@example.com', domain: 'gsm', team: 'project', technology: 'portal', role: 'test' });
      assert.equal(u.status, 201, JSON.stringify(u.json));
      assert.equal(u.json.technology, 'portal');
      const pw = (await req('GET', `/admin/users/${u.json._id}/password`)).json.password;
      const admin = token;
      const login = await req('POST', '/admin/auth/login', { email: 'gsm@example.com', password: pw });
      assert.equal(login.status, 200, JSON.stringify(login.json));
      assert.equal(login.json.user.scope, 'gsm-project-portal-test');
      assert.equal(login.json.user.isAdmin, false);
      token = login.json.token;
      assert.equal((await req('GET', '/admin/users')).status, 403);
      assert.equal((await req('GET', '/admin/configurations')).status, 403);
      assert.equal((await req('GET', '/admin/analytics')).status, 403);
      assert.equal((await req('GET', '/admin/apis')).json.length, 0);
      assert.equal((await req('GET', '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1')).status, 403);
      const c = await req('POST', '/admin/apis', { name: 'sampleapi', version: 'v1', env: 'sit', domain: 'fixedline' });
      assert.equal(c.status, 201, JSON.stringify(c.json));
      assert.equal(c.json.basePath, '/api/gsm-project-portal-test-sit/sampleapi/v1');
      assert.equal((await req('POST', '/admin/apis', { name: 'sampleapi', version: 'v1', env: 'sit' })).status, 409);
      assert.equal((await req('POST', '/admin/apis', { name: 'sampleapi', version: 'v1', env: 'prod' })).status, 400);
      assert.deepEqual((await req('GET', '/admin/apis')).json.map((a) => a.basePath), ['/api/gsm-project-portal-test-sit/sampleapi/v1']);
      await req('POST', '/admin/auth/logout');
      assert.equal((await req('GET', '/admin/apis')).status, 401);
      token = admin;
      assert.ok((await req('GET', '/admin/apis')).json.length >= 3);
      await req('PATCH', `/admin/users/${u.json._id}`, { active: false });
      assert.equal((await req('POST', '/admin/auth/login', { email: 'gsm@example.com', password: pw })).status, 403);
    });

    await step('# records limit on POST and mocks', async () => {
      const K = 'gsm-project-portal-test-sit__sampleapi__v1';
      await req('PUT', `/admin/apis/${K}/sample`, { sample: { id: 'S-1', name: 'one' } });
      const base = '/api/gsm-project-portal-test-sit/sampleapi/v1';
      await req('PUT', `/admin/apis/${K}/tags`, { tags: [{ path: 'id', create: false }] });
      const nine = await req('POST', base, Array.from({ length: 9 }, (_, i) => ({ id: `S-${i + 2}`, name: `n${i}` })));
      assert.equal(nine.status, 201, JSON.stringify(nine.json));
      const over = await req('POST', base, { id: 'S-11' });
      assert.equal(over.status, 422);
      assert.equal(over.json.code, 'RECORD_LIMIT_REACHED');
      assert.equal((await req('POST', `/admin/apis/${K}/mocks`, { count: 1 })).json.code, 'RECORD_LIMIT_REACHED');
      await req('PATCH', `/admin/apis/${K}`, { maxRecords: 11 });
      assert.equal((await req('POST', base, { id: 'S-11' })).status, 201);
      assert.equal((await req('POST', base, { id: 'S-12' })).status, 422);
    });

    await step('HEAD on collection and record: headers, no body', async () => {
      const base = '/api/gsm-project-portal-test-sit/sampleapi/v1';
      for (const url of [base, `${base}/S-1`, `${base}?fields=name`]) {
        const g = await fetch(BASE + url);
        const gb = await g.text();
        const h = await fetch(BASE + url, { method: 'HEAD' });
        assert.equal(h.status, 200);
        assert.match(h.headers.get('content-type'), /application\/json/);
        assert.equal(h.headers.get('content-length'), String(Buffer.byteLength(gb)));
        assert.equal(await h.text(), '');
      }
      assert.equal((await fetch(BASE + `${base}/nope`, { method: 'HEAD' })).status, 404);
      assert.equal((await fetch(BASE + '/api/x/y/z', { method: 'HEAD' })).status, 404);
    });

    await step('merge patch: list with unique id – new item appended with create (post) + map', async () => {
      const T = '/admin/apis/fixedline-bau-ms-dev-dev__agreement__v1/tags';
      const cfg = await req('PUT', T, {
        tags: [
          { path: 'agreementItem.id', unique: true, create: true, regex: null },
          { path: 'agreementItem.stcAgreementItemBusinessId', type: 'string', create: true, map: { enabled: true, source: 'agreementItem.id' } },
        ],
      });
      assert.equal(cfg.status, 200, JSON.stringify(cfg.json));
      const before = (await req('GET', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${id}`)).json;
      const body = JSON.parse(fs.readFileSync(path.join(__dirname, 'merge-item.json'), 'utf8'));
      const r = await req('PATCH', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${id}`, body, { 'content-type': 'application/merge-patch+json' });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.json.agreementItem.length, before.agreementItem.length + 1);
      assert.deepEqual(r.json.agreementItem[0], before.agreementItem[0]);
      const added = r.json.agreementItem.at(-1);
      assert.ok(added.id && added.id !== before.agreementItem[0].id, JSON.stringify(added.id));
      assert.equal(added.stcAgreementItemBusinessId, added.id);
      assert.equal(added.characteristic.length, 10);
      assert.equal(added.productOffering[1].name, 'SmartpartNumber');
      assert.deepEqual(r.json, (await req('GET', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${id}`)).json);
      const existingId = before.agreementItem[0].id;
      const m2 = await req('PATCH', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${id}?fields=agreementItem.id,agreementItem.stcAgreementItemBusinessId`, { agreementItem: [{ id: existingId, stcAgreementItemBusinessId: 'merged-into-existing' }] }, { 'content-type': 'application/merge-patch+json' });
      assert.equal(m2.status, 200, JSON.stringify(m2.json));
      assert.deepEqual(Object.keys(m2.json).sort(), ['agreementItem', 'id']);
      assert.equal(m2.json.agreementItem.length, before.agreementItem.length + 1);
      assert.equal(m2.json.agreementItem[0].stcAgreementItemBusinessId, 'merged-into-existing');
      assert.deepEqual(Object.keys(m2.json.agreementItem[0]).sort(), ['id', 'stcAgreementItemBusinessId']);
      const plain = await req('PATCH', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${id}?pathMode=index`, { engagedParty: [{ id: 'only' }] }, { 'content-type': 'application/merge-patch+json' });
      assert.deepEqual(plain.json.engagedParty, [{ id: 'only' }]);
      const jp = await req('PATCH', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${id}?fields=name`, [{ op: 'replace', path: '/name', value: 'fields test' }], { 'content-type': 'application/json-patch+json' });
      assert.deepEqual(jp.json, { id, name: 'fields test' });
      await req('PUT', T, { tags: [{ path: 'agreementItem.id', unique: false, create: false }, { path: 'agreementItem.stcAgreementItemBusinessId', create: false, map: null }] });
    });

    await step('analytics (morgan): requests, successful and failed per API, most used first', async () => {
      await new Promise((r) => setTimeout(r, 100));
      const before = (await req('GET', '/admin/analytics')).json;
      assert.ok(before.apis.length >= 3);
      const base = '/api/gsm-project-portal-test-sit/sampleapi/v1';
      const main = '/api/fixedline-bau-ms-dev-dev/agreement/v1';
      const count = (r, k) => (r.apis.find((a) => a.basePath === k) || { requests: 0, success: 0, failed: 0 });
      const b0 = count(before, base);
      for (let i = 0; i < 3; i++) await fetch(BASE + `${base}/S-1`);
      await fetch(BASE + `${base}/nope`);
      await fetch(BASE + base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad json' });
      await fetch(BASE + '/api/not/registered/at-all');
      await new Promise((r) => setTimeout(r, 100));
      const after = (await req('GET', '/admin/analytics')).json;
      const b1 = count(after, base);
      assert.equal(b1.requests - b0.requests, 5);
      assert.equal(b1.success - b0.success, 3);
      assert.equal(b1.failed - b0.failed, 2);
      assert.ok(b1.avgMs >= 0 && b1.methods.GET >= 4);
      assert.ok(after.apis.some((a) => a.key === '__unregistered__' && a.failed >= 1));
      for (let i = 1; i < after.apis.length; i++) assert.ok(after.apis[i - 1].requests >= after.apis[i].requests);
      assert.equal(after.apis[0].basePath, main);
      assert.ok(!after.apis.some((a) => a.basePath.startsWith('/admin')));
    });

    await step('records without an id: sample, mocks and delete', async () => {
      const make = await req('POST', '/admin/apis', { name: 'noid', version: 'v1', ...SC, env: 'dev' });
      assert.equal(make.status, 201, JSON.stringify(make.json));
      const K = 'fixedline-bau-ms-dev-dev__noid__v1';
      const base = '/api/fixedline-bau-ms-dev-dev/noid/v1';
      await req('PATCH', `/admin/apis/${K}`, { maxRecords: 50 });
      await req('PUT', `/admin/apis/${K}/sample`, { sample: [{ name: 'a', value: 1 }, { Name: 'b', code: 'X' }] });
      await req('PUT', `/admin/apis/${K}/sample`, { sample: (await req('GET', `/admin/apis/${K}/sample`)).json });
      let list = (await req('GET', `${base}?view=summary`)).json;
      assert.equal(list.total, 2);
      assert.ok(list.items.every((r) => r.id));
      const mocks = await req('POST', `/admin/apis/${K}/mocks`, { source: 'sample:0', count: 2, fieldRules: [{ path: 'name', auto: true }] });
      assert.equal(mocks.status, 201, JSON.stringify(mocks.json));
      assert.ok(mocks.json.created.every((c) => c.id && c.id !== 'undefined'));
      list = (await req('GET', `${base}?view=summary`)).json;
      assert.equal(list.total, 4);
      for (const r of list.items) assert.equal((await req('DELETE', `${base}/${r.id}`)).status, 200);
      assert.equal((await req('GET', `${base}?view=summary`)).json.total, 0);
    });

    await step('PATCH several records (no id in URL) + Array patch (sync)', async () => {
      const K = 'fixedline-bau-ms-dev-dev__resource__v1';
      const base = '/api/fixedline-bau-ms-dev-dev/resource/v1';
      assert.equal((await req('POST', '/admin/apis', { name: 'resource', version: 'v1', ...SC, env: 'dev' })).status, 201);
      const chars = (n) => [
        { name: 'name', value: n },
        { name: 'vale', value: '**' },
        { name: 'type', value: 'New' },
        { name: 'SubType', value: 'New' },
        { name: 'availability', value: '0' },
      ];
      const sample = [
        { id: '899660111002847564', resourceCharacteristic: chars('352353280000055268284') },
        { id: '899660111002847564434323', operationalState: 'primary', resourceCharacteristic: chars('3232352353280000055268284') },
      ];
      const reset = () => req('PUT', `/admin/apis/${K}/sample`, { sample });
      await reset();
      await req('PUT', `/admin/apis/${K}/tags`, { tags: [{ path: 'id', create: false }] });
      const incoming = ['899660111002847564', '899660111002847564434323'].map((id) => ({
        id,
        operationalState: 'finalize',
        resourceCharacteristic: [
          { name: 'namexyz', value: '352353280000055268284' },
          { name: 'valexyz', value: '**' },
          { name: 'type', value: 'Modify' },
        ],
      }));
      const run = () => req('PATCH', base, incoming);
      let r = await run();
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.headers.get('x-array-patch'), 'merge');
      assert.ok(Array.isArray(r.json) && r.json.length === 2);
      assert.deepEqual(r.json.map((x) => x.operationalState), ['finalize', 'finalize']);
      assert.deepEqual(r.json.map((x) => x.resourceCharacteristic.length), [8, 8]);
      assert.deepEqual(r.json, (await req('GET', `${base}?id=899660111002847564,899660111002847564434323`)).json);
      await reset();
      const u = await req('PUT', `/admin/apis/${K}/tags`, { tags: [{ path: 'resourceCharacteristic.name', type: 'string', unique: true }] });
      assert.equal(u.status, 200, JSON.stringify(u.json));
      r = await run();
      assert.deepEqual(r.json.map((x) => x.resourceCharacteristic.length), [7, 7]);
      assert.equal(r.json[0].resourceCharacteristic.find((c) => c.name === 'type').value, 'Modify');
      assert.equal(r.json[0].resourceCharacteristic.find((c) => c.name === 'SubType').value, 'New');
      await reset();
      assert.equal((await req('PATCH', `/admin/apis/${K}`, { arraySync: true })).json.arraySync, true);
      r = await run();
      assert.equal(r.headers.get('x-array-patch'), 'sync');
      assert.deepEqual(r.json.map((x) => x.resourceCharacteristic.length), [3, 3]);
      await reset();
      const one = await req('PATCH', `${base}/899660111002847564`, { resourceCharacteristic: [{ name: 'only', value: '1' }] }, { 'content-type': 'application/merge-patch+json' });
      assert.deepEqual(one.json.resourceCharacteristic, [{ name: 'only', value: '1' }]);
      assert.equal((await req('PATCH', base, [{ id: 'missing-1', a: 1 }])).status, 404);
      assert.equal((await req('PATCH', base, [{ a: 1 }])).json.code, 'ID_REQUIRED');
      assert.equal((await req('PATCH', base, [{ op: 'add', path: '/a', value: 1 }], { 'content-type': 'application/json-patch+json' })).json.code, 'JSON_PATCH_NEEDS_ID');
      const single = await req('PATCH', `${base}?fields=operationalState`, { id: '899660111002847564434323', operationalState: 'x' });
      assert.deepEqual(single.json, { id: '899660111002847564434323', operationalState: 'x' });
    });

    await step('analytics leaves out calls made by the portal', async () => {
      await new Promise((r) => setTimeout(r, 100));
      const base = '/api/gsm-project-portal-test-sit/sampleapi/v1';
      const n = async () => ((await req('GET', '/admin/analytics')).json.apis.find((a) => a.basePath === base) || { requests: 0 }).requests;
      const before = await n();
      await fetch(BASE + `${base}/S-1`, { headers: { 'x-mock-portal': '1' } });
      await fetch(BASE + `${base}/S-1`);
      await new Promise((r) => setTimeout(r, 100));
      assert.equal((await n()) - before, 1);
    });

    await step('persisted across restart', async () => {
      srv.kill();
      await new Promise((r) => srv.on('exit', r));
      const srv2 = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'index.js')], {
        env: { ...process.env, PORT: String(PORT), DATA_DIR },
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      await new Promise((resolve) => srv2.stdout.on('data', (d) => d.toString().includes('listening') && resolve()));
      const g = (await req('GET', `/api/fixedline-bau-ms-dev-dev/agreement/v1/${id}`)).json;
      assert.equal(g.description, 'enum ok');
      assert.equal((await req('GET', '/admin/users')).json.length, 2);
      assert.ok((await req('GET', '/admin/analytics')).json.total.requests > 0);
      srv2.kill();
      await new Promise((r) => srv2.on('exit', r));
    });

    console.log(`\n${passed} checks passed`);
  } catch (e) {
    console.error('FAILED:', e);
    process.exitCode = 1;
  } finally {
    srv.kill();
    fs.rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})();
