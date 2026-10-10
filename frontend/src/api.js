// Thin fetch wrapper for the admin + mock data endpoints.
async function request(method, url, body, contentType = 'application/json') {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': contentType } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = (data && data.error) || `${res.status} ${res.statusText}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const enc = encodeURIComponent;

export const admin = {
  list: () => request('GET', '/admin/apis'),
  get: (key) => request('GET', `/admin/apis/${enc(key)}`),
  create: (name, version) => request('POST', '/admin/apis', { name, version }),
  sample: (key) => request('GET', `/admin/apis/${enc(key)}/sample`),
  saveSample: (key, sample, seed = true) => request('PUT', `/admin/apis/${enc(key)}/sample`, { sample, seed }),
  saveTags: (key, tags) => request('PUT', `/admin/apis/${enc(key)}/tags`, { tags }),
  validateTags: (key, tags) => request('POST', `/admin/apis/${enc(key)}/tags/validate`, { tags }),
  paths: (key) => request('GET', `/admin/apis/${enc(key)}/paths`),
  values: (key, path) => request('GET', `/admin/apis/${enc(key)}/values?path=${enc(path)}`),
  mockPlan: (key, source) => request('GET', `/admin/apis/${enc(key)}/mocks/plan?source=${enc(source)}`),
  createMocks: (key, spec) => request('POST', `/admin/apis/${enc(key)}/mocks`, spec),
  remove: (key) => request('DELETE', `/admin/apis/${enc(key)}`),
};

export const data = (basePath) => ({
  summary: (params = {}) => {
    const qs = new URLSearchParams({ view: 'summary' });
    for (const [k, v] of Object.entries(params)) if (v !== '' && v != null) qs.set(k, v);
    return request('GET', `${basePath}?${qs}`);
  },
  get: (id) => request('GET', `${basePath}/${enc(id)}`),
  create: (record) => request('POST', basePath, record),
  remove: (id) => request('DELETE', `${basePath}/${enc(id)}`),
  // the portal always sends exact index paths, so id / unique-key lookup is turned off (?pathMode=index)
  jsonPatch: (id, ops) => request('PATCH', `${basePath}/${enc(id)}?pathMode=index`, ops, 'application/json-patch+json'),
  mergePatch: (id, patch) => request('PATCH', `${basePath}/${enc(id)}?pathMode=index`, patch, 'application/merge-patch+json'),
});
