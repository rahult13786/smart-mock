const TOKEN_KEY = 'mock-portal-token';
let token = (() => {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
})();

export const getToken = () => token;
export function setToken(t) {
  token = t || '';
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    return;
  }
}

async function request(method, url, body, contentType = 'application/json') {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = contentType;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    method,
    headers,
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
    if (res.status === 401 && url.startsWith('/admin/') && !url.startsWith('/admin/auth/login')) {
      window.dispatchEvent(new Event('portal-logged-out'));
    }
    throw err;
  }
  return data;
}

const enc = encodeURIComponent;

export const admin = {
  list: () => request('GET', '/admin/apis'),
  get: (key) => request('GET', `/admin/apis/${enc(key)}`),
  create: (body) => request('POST', '/admin/apis', body),
  update: (key, body) => request('PATCH', `/admin/apis/${enc(key)}`, body),
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

export const auth = {
  login: (email, password) => request('POST', '/admin/auth/login', { email, password }),
  me: () => request('GET', '/admin/auth/me'),
  logout: () => request('POST', '/admin/auth/logout'),
  options: () => request('GET', '/admin/auth/options'),
};

export const accounts = {
  userOptions: () => request('GET', '/admin/users/options'),
  users: () => request('GET', '/admin/users'),
  newPassword: () => request('GET', '/admin/users/password'),
  password: (id) => request('GET', `/admin/users/${enc(id)}/password`),
  createUser: (user) => request('POST', '/admin/users', user),
  updateUser: (id, user) => request('PATCH', `/admin/users/${enc(id)}`, user),
  removeUser: (id) => request('DELETE', `/admin/users/${enc(id)}`),
  configurations: () => request('GET', '/admin/configurations'),
  addConfiguration: (type, value) => request('POST', '/admin/configurations', { type, value }),
  removeConfiguration: (id) => request('DELETE', `/admin/configurations/${enc(id)}`),
  analytics: () => request('GET', '/admin/analytics'),
  resetAnalytics: () => request('DELETE', '/admin/analytics'),
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
