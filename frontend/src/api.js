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
  mapCandidates: (key, path) => request('GET', `/admin/apis/${enc(key)}/tags/map?path=${enc(path)}`),
  regex: (key, path, pattern) =>
    request('GET', `/admin/apis/${enc(key)}/tags/regex?path=${enc(path)}${pattern !== undefined ? `&pattern=${enc(pattern)}` : ''}`),
  values: (key, path) => request('GET', `/admin/apis/${enc(key)}/values?path=${enc(path)}`),
  mockPlan: (key, source) => request('GET', `/admin/apis/${enc(key)}/mocks/plan?source=${enc(source)}`),
  createMocks: (key, spec) => request('POST', `/admin/apis/${enc(key)}/mocks`, spec),
  remove: (key) => request('DELETE', `/admin/apis/${enc(key)}`),
};

export const accounts = {
  users: () => request('GET', '/admin/users'),
  newPassword: () => request('GET', '/admin/users/password'),
  password: (id) => request('GET', `/admin/users/${enc(id)}/password`),
  createUser: (user) => request('POST', '/admin/users', user),
  updateUser: (id, user) => request('PATCH', `/admin/users/${enc(id)}`, user),
  removeUser: (id) => request('DELETE', `/admin/users/${enc(id)}`),
  folderOptions: () => request('GET', '/admin/folders/options'),
  folders: () => request('GET', '/admin/folders'),
  folder: (id) => request('GET', `/admin/folders/${enc(id)}`),
  createFolder: (folder) => request('POST', '/admin/folders', folder),
  setFolderUsers: (id, userIds) => request('PUT', `/admin/folders/${enc(id)}/users`, { userIds }),
  removeFolder: (id) => request('DELETE', `/admin/folders/${enc(id)}`),
};

export const data = (basePath) => ({
  summary: (params = {}) => {
    const qs = new URLSearchParams({ view: 'summary' });
    for (const [k, v] of Object.entries(params)) if (v !== '' && v != null) qs.set(k, v);
    return request('GET', `${basePath}?${qs}`);
  },
  get: (id) => request('GET', `${basePath}/${enc(id)}`),
  create: (record, { copy = false } = {}) => request('POST', copy ? `${basePath}?generate=false` : basePath, record),
  remove: (id) => request('DELETE', `${basePath}/${enc(id)}`),
  jsonPatch: (id, ops, { copy = false } = {}) =>
    request('PATCH', `${basePath}/${enc(id)}?pathMode=index${copy ? '&generate=false' : ''}`, ops, 'application/json-patch+json'),
  mergePatch: (id, patch) => request('PATCH', `${basePath}/${enc(id)}?pathMode=index`, patch, 'application/merge-patch+json'),
});
