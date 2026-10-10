// End-to-end smoke test: starts the server on a temp data dir and exercises every endpoint.
// Usage: npm test   (optionally SAMPLE=../samples/agreement.json)
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');

const PORT = 4999;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mockapi-'));
const SAMPLE = process.env.SAMPLE || path.join(__dirname, '..', '..', 'samples', 'agreement.json');

const req = async (method, url, body, headers = {}) => {
  const r = await fetch(BASE + url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json', ...headers } : headers,
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
      assert.equal((await req('GET', '/api/agreement/v1')).status, 404);
      assert.equal((await req('POST', '/api/agreement/v1', { id: 'x' })).status, 404);
      assert.equal((await req('PATCH', '/api/agreement/v1/x', { a: 1 })).status, 404);
    });

    await step('register API', async () => {
      const r = await req('POST', '/admin/apis', { name: 'Agreement', version: 'v1' });
      assert.equal(r.status, 201);
      assert.equal(r.json.basePath, '/api/agreement/v1');
      assert.equal((await req('POST', '/admin/apis', { name: 'agreement', version: 'v1' })).status, 409);
    });

    await step('save sample -> tags + seeded record', async () => {
      const r = await req('PUT', '/admin/apis/agreement__v1/sample', { sample });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.json.seeded, 1);
      const paths = r.json.tags.map((t) => t.path);
      assert.ok(paths.includes('id') && paths.includes('agreementPeriod.startDateTime'));
      assert.ok(!paths.some((p) => p.startsWith('agreementItem')), 'arrays excluded');
    });

    await step('GET collection / summary / by id', async () => {
      const all = await req('GET', '/api/agreement/v1');
      assert.equal(all.status, 200);
      assert.equal(all.json.length, 1);
      assert.deepEqual(all.json[0], sample[0]);
      const s = await req('GET', '/api/agreement/v1?view=summary');
      assert.equal(s.json.total, 1);
      assert.equal(s.json.items[0].id, id);
      assert.equal((await req('GET', `/api/agreement/v1/${encodeURIComponent(id)}`)).json.name, sample[0].name);
      assert.equal((await req('GET', '/api/agreement/v1/nope')).status, 404);
    });

    await step('POST new record (generated id) + duplicate 409', async () => {
      const r = await req('POST', '/api/agreement/v1', { name: 'Second', status: 'Draft', '@type': 'Agreement' });
      assert.equal(r.status, 201);
      assert.ok(r.json.id);
      assert.equal((await req('POST', '/api/agreement/v1', { id })).status, 409);
    });

    await step('search on searchable tags', async () => {
      const r = await req('GET', '/api/agreement/v1?view=summary&name=second');
      assert.equal(r.json.total, 1);
      assert.equal((await req('GET', '/api/agreement/v1?view=summary&q=draft')).json.total, 1);
      const bad = await req('GET', '/api/agreement/v1?doesNotExist=x');
      assert.equal(bad.status, 400);
      assert.equal(bad.json.code, 'FILTER_PATH_NOT_FOUND');
    });

    await step('/apis alias + JSON 404 for unknown routes', async () => {
      const r = await req('GET', `/apis/agreement/v1/${id}`);
      assert.equal(r.status, 200);
      assert.equal(r.json.id, id);
      const r2 = await req('GET', '/apis/Agreement/v1');
      assert.equal(r2.status, 200);
      const nf = await req('GET', '/api/agreement');
      assert.equal(nf.status, 404);
      assert.ok(nf.json.error);
    });

    await step('GET ?id=a,b,c returns array in requested order', async () => {
      const second = (await req('GET', '/api/agreement/v1?name=second')).json[0].id;
      const r = await req('GET', `/api/agreement/v1?id=${second},${id},missing-1`);
      assert.equal(r.status, 200);
      assert.deepEqual(r.json.map((x) => x.id), [second, id]);
      assert.equal(r.headers.get('x-not-found-ids'), 'missing-1');
      const one = await req('GET', `/api/agreement/v1?id=${id}`);
      assert.equal(one.json.length, 1);
    });

    await step('filter on a non-searchable / unconfigured path updates the configuration', async () => {
      // agreementType is a tag but not searchable -> switched on
      const r = await req('GET', '/api/agreement/v1?agreementType.like=physical&status.like=awaiting,draft');
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.json.length, 1);
      assert.match(r.headers.get('x-search-config-updated'), /agreementType/);
      // deep path through arrays, not configured at all -> added as custom tag
      const r2 = await req('GET', '/api/agreement/v1?view=summary&characteristic.name.like=contract');
      assert.equal(r2.status, 200, JSON.stringify(r2.json));
      assert.equal(r2.json.total, 1);
      const api = (await req('GET', '/admin/apis/agreement__v1')).json;
      const t = api.tags.find((x) => x.path === 'characteristic.name');
      assert.ok(t && t.searchable && t.custom);
      // second call: no config change
      const r3 = await req('GET', '/api/agreement/v1?agreementType.like=physical');
      assert.equal(r3.headers.get('x-search-config-updated'), null);
    });

    await step('custom tags validated against sample', async () => {
      const bad = await req('PUT', '/admin/apis/agreement__v1/tags', { tags: [{ path: 'agreementItem.nope', type: 'string', searchable: true }] });
      assert.equal(bad.status, 422);
      assert.equal(bad.json.code, 'PATH_NOT_IN_SAMPLE');
      assert.ok(bad.json.hint.includes('new version'));
      const mismatch = await req('POST', '/admin/apis/agreement__v1/tags/validate', { tags: [{ path: 'agreementItem.productOfferingPrice.priceType', type: 'number' }] });
      assert.equal(mismatch.json.valid, false);
      assert.equal(mismatch.json.results[0].code, 'TYPE_MISMATCH');
      const obj = await req('POST', '/admin/apis/agreement__v1/tags/validate', { tags: [{ path: 'agreementPeriod', type: 'string' }] });
      assert.equal(obj.json.results[0].code, 'NOT_A_VALUE');
      const ok = await req('PUT', '/admin/apis/agreement__v1/tags', { tags: [{ path: 'agreementItem.productOfferingPrice.priceType', type: 'string', searchable: true }] });
      assert.equal(ok.status, 200, JSON.stringify(ok.json));
      assert.equal((await req('GET', '/api/agreement/v1?view=summary&agreementItem.productOfferingPrice.priceType=recurring')).json.total, 1);
      const rm = await req('PUT', '/admin/apis/agreement__v1/tags', { tags: [{ path: 'agreementItem.productOfferingPrice.priceType', remove: true }] });
      assert.ok(!rm.json.tags.some((x) => x.path === 'agreementItem.productOfferingPrice.priceType'));
    });

    await step('PATCH JSON Patch (RFC 6902)', async () => {
      const ops = [
        { op: 'replace', path: '/status', value: 'Patched' },
        { op: 'replace', path: '/agreementItem/0/productOfferingPrice/0/name', value: 'renamed' },
        { op: 'add', path: '/characteristic/-', value: { name: 'new', value: 'x' } },
      ];
      const r = await req('PATCH', `/api/agreement/v1/${id}`, ops, { 'content-type': 'application/json-patch+json' });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.headers.get('x-patch-mode'), 'json-patch');
      const g = (await req('GET', `/api/agreement/v1/${id}`)).json;
      assert.equal(g.status, 'Patched');
      assert.equal(g.agreementItem[0].productOfferingPrice[0].name, 'renamed');
      assert.equal(g.characteristic.at(-1).name, 'new');
      const bad = await req('PATCH', `/api/agreement/v1/${id}`, [{ op: 'replace', path: '/nope/x', value: 1 }], { 'content-type': 'application/json-patch+json' });
      assert.equal(bad.status, 422);
      const t = await req('PATCH', `/api/agreement/v1/${id}`, [{ op: 'test', path: '/status', value: 'other' }], { 'content-type': 'application/json-patch+json' });
      assert.equal(t.status, 409);
    });

    await step('PATCH Merge Patch (RFC 7396)', async () => {
      const r = await req('PATCH', `/api/agreement/v1/${id}`, { description: 'merged', agreementPeriod: { endDateTime: '2030-01-01T00:00:00Z' }, stcTarget: null }, { 'content-type': 'application/merge-patch+json' });
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('x-patch-mode'), 'merge');
      const g = (await req('GET', `/api/agreement/v1/${id}`)).json;
      assert.equal(g.description, 'merged');
      assert.equal(g.agreementPeriod.endDateTime, '2030-01-01T00:00:00Z');
      assert.equal(g.agreementPeriod.startDateTime, sample[0].agreementPeriod.startDateTime);
      assert.ok(!('stcTarget' in g));
      assert.equal((await req('PATCH', `/api/agreement/v1/${id}`, { id: 'other' })).status, 400);
    });

    await step('tags update reindexes', async () => {
      const r = await req('PUT', '/admin/apis/agreement__v1/tags', { tags: [{ path: 'description', searchable: true }] });
      assert.equal(r.status, 200);
      assert.equal((await req('GET', '/api/agreement/v1?view=summary&description.like=merg')).json.total, 1);
    });

    await step('enum on tags: configured, validated on POST and PATCH', async () => {
      const bad = await req('PUT', '/admin/apis/agreement__v1/tags', { tags: [{ path: 'agreementType', enum: ['Standard Physical', 42] }] });
      assert.equal(bad.status, 400);
      const r = await req('PUT', '/admin/apis/agreement__v1/tags', {
        tags: [
          { path: 'agreementType', enum: ['Standard Physical', 'Standard Digital'] },
          { path: 'characteristic.name', enum: ['Created Date', 'Modified Date'] },
        ],
      });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.deepEqual(r.json.tags.find((t) => t.path === 'agreementType').enum, ['Standard Physical', 'Standard Digital']);
      assert.ok(r.json.enumWarnings.some((w) => w.path === 'characteristic.name' && w.count > 0)); // existing data outside enum
      const vals = await req('GET', '/admin/apis/agreement__v1/values?path=characteristic.name');
      assert.ok(vals.json.length > 5);
      // POST with a wrong value
      const p1 = await req('POST', '/api/agreement/v1', { id: 'enum-1', agreementType: 'Wrong' });
      assert.equal(p1.status, 422);
      assert.equal(p1.json.code, 'ENUM_VIOLATION');
      assert.match(p1.json.error, /Wrong data sent on path "\/agreementType"/);
      assert.equal((await req('POST', '/api/agreement/v1', { id: 'enum-2', agreementType: 'Standard Digital' })).status, 201);
      // PATCH: wrong value at nested list path -> 422 with the concrete path
      const p2 = await req('PATCH', `/api/agreement/v1/${id}`, [{ op: 'replace', path: '/characteristic/0/name', value: 'Bogus' }], { 'content-type': 'application/json-patch+json' });
      assert.equal(p2.status, 422);
      assert.equal(p2.json.violations[0].path, '/characteristic/0/name');
      // PATCH of an unrelated field passes although stored data has old values outside the enum
      const p3 = await req('PATCH', `/api/agreement/v1/${id}`, { description: 'enum ok' }, { 'content-type': 'application/merge-patch+json' });
      assert.equal(p3.status, 200, JSON.stringify(p3.json));
      const p4 = await req('PATCH', `/api/agreement/v1/${id}`, { agreementType: 'Standard Digital' });
      assert.equal(p4.status, 200);
      // enum survives a sample re-save; [] removes it
      const again = await req('PUT', '/admin/apis/agreement__v1/sample', { sample, seed: false });
      assert.ok(again.json.tags.find((t) => t.path === 'agreementType').enum);
      const rm = await req('PUT', '/admin/apis/agreement__v1/tags', { tags: [{ path: 'agreementType', enum: [] }, { path: 'characteristic.name', enum: null }] });
      assert.ok(!rm.json.tags.find((t) => t.path === 'agreementType').enum);
      assert.equal((await req('POST', '/api/agreement/v1', { id: 'enum-3', agreementType: 'Anything' })).status, 201);
    });

    await step('DELETE record', async () => {
      const d = await req('DELETE', '/api/agreement/v1/enum-3');
      assert.equal(d.status, 200);
      assert.equal((await req('GET', '/api/agreement/v1/enum-3')).status, 404);
      assert.equal((await req('DELETE', '/api/agreement/v1/enum-3')).status, 404);
      // removing a node is a JSON Patch "remove"
      const before = (await req('GET', `/api/agreement/v1/${id}`)).json.engagedParty.length;
      const r = await req('PATCH', `/api/agreement/v1/${id}`, [{ op: 'remove', path: '/engagedParty/0' }], { 'content-type': 'application/json-patch+json' });
      assert.equal(r.json.engagedParty.length, before - 1);
    });

    await step('unique tags: validation rules', async () => {
      const root = await req('PUT', '/admin/apis/agreement__v1/tags', { tags: [{ path: 'name', unique: true }] });
      assert.equal(root.status, 422);
      assert.equal(root.json.code, 'INVALID_UNIQUE');
      const add = await req('PUT', '/admin/apis/agreement__v1/tags', { tags: [{ path: 'agreementItem.productOfferingPrice.name', type: 'string' }] });
      assert.equal(add.status, 200);
      const withId = await req('PUT', '/admin/apis/agreement__v1/tags', { tags: [{ path: 'agreementItem.productOfferingPrice.name', unique: true }] });
      assert.equal(withId.status, 422);
      assert.match(withId.json.error, /already their key/);
      const ok = await req('PUT', '/admin/apis/agreement__v1/tags', {
        tags: [{ path: 'characteristic.name', unique: true }, { path: 'agreementItem.characteristic.name', type: 'string', unique: true }],
      });
      assert.equal(ok.status, 200, JSON.stringify(ok.json));
      const t = ok.json.tags.find((x) => x.path === 'characteristic.name');
      assert.equal(t.unique, true);
      assert.equal(t.uniqueIn, 'characteristic');
      assert.ok(ok.json.uniqueWarnings.some((w) => w.path === 'characteristic.name')); // sample has duplicate names
    });

    await step('PATCH paths: id -> unique key -> index', async () => {
      const rec = (await req('GET', `/api/agreement/v1/${id}`)).json;
      const itemId = rec.agreementItem[0].id;
      const popId = rec.agreementItem[0].productOfferingPrice[1].id;
      const jp = (ops, q = '') => req('PATCH', `/api/agreement/v1/${id}${q}`, ops, { 'content-type': 'application/json-patch+json' });
      // id of agreementItem + index of productOfferingPrice
      let r = await jp([{ op: 'replace', path: `/agreementItem/${itemId}/productOfferingPrice/1/price/value`, value: 111 }]);
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.json.agreementItem[0].productOfferingPrice[1].price.value, 111);
      assert.match(r.headers.get('x-patch-resolved'), /\/agreementItem\/0\/productOfferingPrice\/1\/price\/value/);
      // id at both levels
      r = await jp([{ op: 'replace', path: `/agreementItem/${itemId}/productOfferingPrice/${popId}/priceType`, value: 'ById' }]);
      assert.equal(r.json.agreementItem[0].productOfferingPrice[1].priceType, 'ById');
      // unique key (characteristic has no id; name is unique)
      const ci = r.json.characteristic.findIndex((c) => c.name === 'Contract level');
      r = await jp([{ op: 'replace', path: '/characteristic/Contract level/value', value: 'Enterprise' }]);
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.json.characteristic[ci].value, 'Enterprise');
      // nested unique key under an id
      r = await jp([{ op: 'replace', path: `/agreementItem/${itemId}/characteristic/Validity End Date/value`, value: 'x' }]);
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.json.agreementItem[0].characteristic.find((c) => c.name === 'Validity End Date').value, 'x');
      // ambiguous unique key (duplicate names in data) -> 409
      const dupName = (() => { const seen = new Set(); for (const c of r.json.characteristic) { if (seen.has(c.name)) return c.name; seen.add(c.name); } })();
      if (dupName) assert.equal((await jp([{ op: 'replace', path: `/characteristic/${dupName}/value`, value: 'y' }])).status, 409);
      // unknown -> 422
      const nf = await jp([{ op: 'replace', path: '/agreementItem/NOPE/name', value: 1 }]);
      assert.equal(nf.status, 422);
      assert.equal(nf.json.code, 'ITEM_NOT_FOUND');
      // remove by id
      const before = r.json.agreementItem[0].productOfferingPrice.length;
      r = await jp([{ op: 'remove', path: `/agreementItem/${itemId}/productOfferingPrice/${popId}` }]);
      assert.equal(r.json.agreementItem[0].productOfferingPrice.length, before - 1);
      assert.notEqual(r.json.agreementItem[0].productOfferingPrice[1].id, popId);
      // pathMode=index: id lookup off
      assert.equal((await jp([{ op: 'replace', path: `/agreementItem/${itemId}/name`, value: 1 }], '?pathMode=index')).status, 422);
      // merge patch with ids / unique keys inside lists
      const m = await req('PATCH', `/api/agreement/v1/${id}`, {
        agreementItem: { [itemId]: { productOfferingPrice: { 0: { priceType: 'Merged' } } } },
        characteristic: { 'Contract level': { value: 'Merged value' } },
      }, { 'content-type': 'application/merge-patch+json' });
      assert.equal(m.status, 200, JSON.stringify(m.json));
      assert.equal(m.json.agreementItem[0].productOfferingPrice[0].priceType, 'Merged');
      assert.equal(m.json.characteristic[ci].value, 'Merged value');
      assert.ok(Array.isArray(m.json.agreementItem));
    });

    await step('id tags are always unique', async () => {
      const api = (await req('GET', '/admin/apis/agreement__v1')).json;
      assert.equal(api.tags.find((t) => t.path === 'id').unique, true);
      assert.equal(api.tags.find((t) => t.path === 'agreementSpecification.id').unique, true);
      const r = await req('PUT', '/admin/apis/agreement__v1/tags', { tags: [{ path: 'id', unique: false }] });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.json.tags.find((t) => t.path === 'id').unique, true); // cannot be unchecked
    });

    await step('TMF630 GET: filter (equality / like / ne), fields, sort, offset, limit', async () => {
      await req('PATCH', `/api/agreement/v1/${id}`, { status: 'Awaiting approval' });
      // config is updated for every new filter param (Fix 1)
      const f = await req('GET', '/api/agreement/v1?status=Awaiting approval&version=1');
      assert.equal(f.json.length, 1);
      assert.equal(f.status, 200);
      const cfg = (await req('GET', '/admin/apis/agreement__v1')).json;
      assert.equal(cfg.tags.find((t) => t.path === 'version').searchable, true);
      assert.equal(cfg.tags.find((t) => t.path === 'status').searchable, true);
      // equality is exact (case-insensitive); like = contains
      assert.equal((await req('GET', '/api/agreement/v1?status=awaiting')).json.length, 0);
      assert.equal((await req('GET', '/api/agreement/v1?status=AWAITING APPROVAL')).json.length, 1);
      assert.equal((await req('GET', '/api/agreement/v1?status.like=await')).json.length, 1);
      assert.ok((await req('GET', '/api/agreement/v1?status.ne=Awaiting approval')).json.every((x) => x.status !== 'Awaiting approval'));
      // fields only
      const fo = await req('GET', '/api/agreement/v1?fields=name,description');
      assert.deepEqual(Object.keys(fo.json[0]).sort(), ['description', 'id', 'name'].filter((k) => k in fo.json[0]).sort());
      assert.ok(!('agreementItem' in fo.json[0]));
      // filter + fields + nested list fields
      const ff = await req('GET', `/api/agreement/v1?id=${id}&fields=id,name,agreementItem.id,agreementItem.productOfferingPrice.id,characteristic`);
      const one = ff.json[0];
      assert.deepEqual(Object.keys(one).sort(), ['agreementItem', 'characteristic', 'id', 'name']);
      assert.deepEqual(Object.keys(one.agreementItem[0]).sort(), ['id', 'productOfferingPrice']);
      assert.deepEqual(Object.keys(one.agreementItem[0].productOfferingPrice[0]), ['id']);
      assert.ok(one.characteristic[0].name); // whole value
      // single record with fields
      const sf = await req('GET', `/api/agreement/v1/${id}?fields=status`);
      assert.deepEqual(Object.keys(sf.json).sort(), ['id', 'status']);
      // sort + offset + limit
      await req('POST', '/api/agreement/v1', [{ id: 's-b', name: 'Bravo', version: '2' }, { id: 's-a', name: 'Alpha', version: '10' }, { id: 's-c', name: 'Charlie', version: '2' }]);
      const asc = await req('GET', '/api/agreement/v1?id=s-a,s-b,s-c&sort=name&fields=name');
      assert.deepEqual(asc.json.map((x) => x.name), ['Alpha', 'Bravo', 'Charlie']);
      const multi = await req('GET', '/api/agreement/v1?id=s-a,s-b,s-c&sort=-version,name&fields=name,version');
      assert.deepEqual(multi.json.map((x) => x.id), ['s-a', 's-b', 's-c']); // 10 > 2 numerically, then name
      const page = await req('GET', '/api/agreement/v1?id=s-a,s-b,s-c&sort=-name&offset=1&limit=1&fields=name');
      assert.deepEqual(page.json.map((x) => x.name), ['Bravo']);
      assert.equal(page.headers.get('x-total-count'), '3');
      assert.equal(page.headers.get('x-result-count'), '1');
      const upd = await req('GET', '/api/agreement/v1?sort=-updatedAt&limit=1&fields=id');
      assert.equal(upd.status, 200);
      const tmf = await req('GET', `/api/agreement/v1?status=Awaiting approval&fields=id,name,description,status,agreementItem.id,agreementItem.status,characteristic&sort=-updatedAt,name&offset=0&limit=20`);
      assert.equal(tmf.status, 200);
      for (const sid of ['s-a', 's-b', 's-c']) await req('DELETE', `/api/agreement/v1/${sid}`);
    });

    await step('create mocks', async () => {
      const plan = (await req('GET', '/admin/apis/agreement__v1/mocks/plan?source=sample:0')).json;
      assert.equal(plan.max, 10);
      assert.equal(plan.idPaths[0].path, 'id');
      assert.ok(plan.idPaths.some((p) => p.path === 'agreementItem.productOfferingPrice.id' && p.count >= 1000));
      const cv = plan.fields.find((f) => f.path === 'characteristic.value');
      assert.ok(cv.filterKeys.some((k) => k.key === 'name'));
      assert.equal((await req('POST', '/admin/apis/agreement__v1/mocks', { count: 11 })).status, 400);
      const r = await req('POST', '/admin/apis/agreement__v1/mocks', {
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
      const m1 = (await req('GET', '/api/agreement/v1/MOCK-1')).json;
      assert.equal(m1.status, 'Approved');
      assert.equal(m1.stcAgreementBusinessId, 'MOCK-1'); // replace all
      assert.notEqual(m1.agreementItem[0].id, sample[0].agreementItem[0].id);
      assert.equal(m1.characteristic.find((c) => c.name === 'Contract level').value, 'Gold');
      assert.equal(m1.characteristic.find((c) => c.name === 'Created Date').value, sample[0].characteristic.find((c) => c.name === 'Created Date').value);
      const m3 = (await req('GET', `/api/agreement/v1/${r.json.created[2].id}`)).json;
      assert.match(m3.id, /^MSA-\d{6}-\d{6}$/); // generated like the sample
      assert.notEqual(m3.characteristic.find((c) => c.name === 'Contract level').value, undefined);
      // current value of a list field depends on the filter
      const all = (await req('GET', '/admin/apis/agreement__v1/mocks/current?source=sample:0&path=characteristic.value')).json;
      assert.ok(all.count > 10);
      const one = (await req('GET', '/admin/apis/agreement__v1/mocks/current?source=sample:0&path=characteristic.value&filterKey=name&filterValue=Contract%20level')).json;
      assert.deepEqual(one, { count: 1, values: ['Service'] });
      // nested field of a list item (price.value inside productOfferingPrice) filtered by the item's id
      const popId = sample[0].agreementItem[0].productOfferingPrice[3].id;
      const nested = (await req('GET', `/admin/apis/agreement__v1/mocks/current?source=sample:0&path=agreementItem.productOfferingPrice.price.value&filterKey=id&filterValue=${popId}`)).json;
      assert.equal(nested.count, 1);
      const pv = plan.fields.find((f) => f.path === 'agreementItem.productOfferingPrice.price.value');
      assert.equal(pv.listPath, 'agreementItem.productOfferingPrice');
      // reuse: keep source values (ids and fields), even when auto is also sent
      const ru = await req('POST', '/admin/apis/agreement__v1/mocks', {
        count: 1,
        idRules: [{ path: 'id', values: ['MOCK-R'], replaceAll: true }, { path: 'agreementItem.id', auto: true, reuse: true }],
        fieldRules: [
          { path: 'status', auto: true, reuse: true },
          { path: 'agreementItem.productOfferingPrice.price.value', values: ['999'], filter: { key: 'id', value: popId } },
        ],
      });
      assert.equal(ru.status, 201, JSON.stringify(ru.json));
      const mr = (await req('GET', '/api/agreement/v1/MOCK-R')).json;
      assert.equal(mr.agreementItem[0].id, sample[0].agreementItem[0].id); // reused – not touched by replace all
      assert.equal(mr.stcAgreementBusinessId, 'MOCK-R'); // replace all still applies elsewhere
      assert.equal(mr.agreementItem[0].productOfferingPrice[3].price.value, 999);
      assert.equal(mr.agreementItem[0].productOfferingPrice[4].price.value, sample[0].agreementItem[0].productOfferingPrice[4].price.value);
      assert.equal((await req('POST', '/admin/apis/agreement__v1/mocks', { count: 1, idRules: [{ path: 'id', reuse: true }] })).status, 400);
      // clash with an existing id
      const clash = await req('POST', '/admin/apis/agreement__v1/mocks', { count: 1, idRules: [{ path: 'id', values: ['MOCK-1'] }] });
      assert.equal(clash.status, 409);
    });

    await step('persisted across restart', async () => {
      srv.kill();
      await new Promise((r) => srv.on('exit', r));
      const srv2 = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'index.js')], {
        env: { ...process.env, PORT: String(PORT), DATA_DIR },
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      await new Promise((resolve) => srv2.stdout.on('data', (d) => d.toString().includes('listening') && resolve()));
      const g = (await req('GET', `/api/agreement/v1/${id}`)).json;
      assert.equal(g.description, 'enum ok');
      srv2.kill();
    });

    console.log(`\n${passed} checks passed`);
  } catch (e) {
    console.error('FAILED:', e);
    process.exitCode = 1;
  } finally {
    srv.kill();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  }
})();
