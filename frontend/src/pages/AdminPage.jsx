import { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, useParams } from 'react-router-dom';
import { accounts } from '../api.js';
import ConfirmModal from '../components/ConfirmModal.jsx';

const MASK = '******';
const USER_SCOPE = [
  ['domain', 'Domain'],
  ['team', 'Team'],
  ['technology', 'Technology'],
  ['role', 'Role'],
];

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(area);
  if (!ok) throw new Error('Copy is not allowed in this browser');
}

function useEscape(onClose) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

function Modal({ title, onClose, children, footer, size = '' }) {
  useEscape(onClose);
  return (
    <div className="modal-backdrop top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size}`}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn ghost" onClick={onClose} title="Close">×</button>
        </div>
        <div className="modal-body add-item">{children}</div>
        <div className="modal-foot">{footer}</div>
      </div>
    </div>
  );
}

function PasswordCell({ load, bare = false }) {
  const [state, setState] = useState('');
  async function copy() {
    try {
      await copyText(await load());
      setState('Copied');
    } catch (e) {
      setState(e.message);
    }
    setTimeout(() => setState(''), 1800);
  }
  return (
    <span className="password-cell">
      {!bare && <code>{MASK}</code>}
      <button type="button" className="icon-btn" title="Copy password" onClick={copy}>⧉</button>
      {state && <span className={`small ${state === 'Copied' ? 'ok-text' : 'error-text'}`}>{state}</span>}
    </span>
  );
}

function UserModal({ user, prefill, onClose, onSaved }) {
  const editing = !!user;
  const [form, setForm] = useState({
    firstName: user?.firstName || prefill?.firstName || '',
    lastName: user?.lastName || prefill?.lastName || '',
    email: user?.email || prefill?.email || '',
    domain: user?.domain || '',
    team: user?.team || '',
    technology: user?.technology || '',
    role: user?.role || '',
    active: user ? !!user.active : true,
  });
  const [options, setOptions] = useState(null);
  const [password, setPassword] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    accounts.userOptions().then(setOptions).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!editing) accounts.newPassword().then((r) => setPassword(r.password)).catch((e) => setError(e.message));
  }, [editing]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function save(e) {
    e?.preventDefault();
    const missing = [['firstName', 'First name'], ['lastName', 'Last name'], ['email', 'Email'], ...USER_SCOPE].filter(([k]) => !form[k].trim()).map(([, l]) => l);
    if (missing.length) return setError(`${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required`);
    setBusy(true);
    setError('');
    try {
      const saved = editing ? await accounts.updateUser(user._id, form) : await accounts.createUser({ ...form, password });
      onSaved(saved);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={editing ? `Edit user – ${user.email}` : prefill ? `New user – access request from ${prefill.email}` : 'New user'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || (!editing && !password)} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <form className="user-form" onSubmit={save}>
        <label>
          First name
          <input autoFocus value={form.firstName} onChange={set('firstName')} />
        </label>
        <label>
          Last name
          <input value={form.lastName} onChange={set('lastName')} />
        </label>
        <label className="wide">
          Email
          <input type="email" value={form.email} onChange={set('email')} />
        </label>
        {USER_SCOPE.map(([k, label]) => (
          <label key={k}>
            {label} <span className="required">*</span>
            <select value={form[k]} onChange={set(k)}>
              <option value="">Select…</option>
              {(options?.[k] || []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        ))}
        <div className="path-preview wide">
          API base path <code>{USER_SCOPE.map(([k]) => form[k] || '…').join('-')}-{'{env}'}</code>
        </div>
        <label className="wide">
          Password <span className="muted small">generated – cannot be changed</span>
          <div className="row gap">
            <input className="readonly code" readOnly value={editing || password ? MASK : 'Generating…'} />
            {editing ? (
              <PasswordCell bare load={async () => (await accounts.password(user._id)).password} />
            ) : (
              password && <PasswordCell bare load={async () => password} />
            )}
          </div>
        </label>
        {editing && (
          <label className="check wide">
            <input type="checkbox" checked={form.active} onChange={set('active')} /> Active
          </label>
        )}
        <button hidden />
      </form>
      {error && <div className="alert error">{error}</div>}
    </Modal>
  );
}

function UsersTab() {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(() => accounts.users().then(setUsers).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <div className="section-head">
        <h3>Users</h3>
        <span className="count">{users ? users.length : '…'}</span>
        <span className="spacer" />
        <button className="btn primary" onClick={() => setEditing('new')}>+ New user</button>
      </div>
      {notice && <div className="alert ok">{notice}</div>}
      {error && <div className="alert error">{error}</div>}
      <div className="card table-card">
        <table className="grid">
          <thead>
            <tr>
              <th>First name</th>
              <th>Last name</th>
              <th>Email</th>
              <th>Domain</th>
              <th>Team</th>
              <th>Technology</th>
              <th>Role</th>
              <th className="center">Active</th>
              <th>Password</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users?.map((u) => (
              <tr key={u._id}>
                <td>{u.firstName}</td>
                <td>{u.lastName}</td>
                <td>{u.email}</td>
                {USER_SCOPE.map(([k]) => (
                  <td key={k}>{u[k] || <span className="muted">–</span>}</td>
                ))}
                <td className="center">
                  <span className={`pill ${u.active ? 'ok' : 'off'}`}>{u.active ? 'Active' : 'Inactive'}</span>
                </td>
                <td>
                  <PasswordCell load={async () => (await accounts.password(u._id)).password} />
                </td>
                <td className="nowrap right">
                  <button className="btn small" onClick={() => setEditing(u)}>Edit</button>{' '}
                  <button className="btn small ghost danger" onClick={() => setRemoving(u)}>Delete</button>
                </td>
              </tr>
            ))}
            {users && users.length === 0 && (
              <tr><td colSpan={10} className="muted center">No users yet – click + New user.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && (
        <UserModal
          user={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(u) => {
            setNotice(editing === 'new' ? `User ${u.email} created.` : `User ${u.email} updated.`);
            setEditing(null);
            load();
          }}
        />
      )}
      {removing && (
        <ConfirmModal
          title="Delete user"
          message={<>Delete <b>{removing.firstName} {removing.lastName}</b> ({removing.email})? The user is also removed from every folder.</>}
          onConfirm={async () => {
            await accounts.removeUser(removing._id);
            setNotice(`User ${removing.email} deleted.`);
            await load();
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </>
  );
}

const CONFIG_TYPES = [
  ['DOMAIN', 'Domain'],
  ['TEAM', 'Team'],
  ['TECHNOLOGY', 'Technology'],
  ['ROLE', 'Role'],
];

function ConfigurationsTab() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [adding, setAdding] = useState(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const [removing, setRemoving] = useState(null);

  const load = useCallback(() => accounts.configurations().then(setRows).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);

  async function save(e) {
    e?.preventDefault();
    if (!adding.value.trim()) return setError('Enter a value');
    setBusy(true);
    setError('');
    try {
      const c = await accounts.addConfiguration(adding.type, adding.value.trim());
      setNotice(`${c.type} "${c.value}" added – it is now offered under ${CONFIG_TYPES.find(([t]) => t === c.type)[1]} when creating or editing a user.`);
      setAdding({ type: adding.type, value: '' });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const shown = (rows || []).filter((r) => !filter || r.type === filter);

  return (
    <>
      <div className="section-head">
        <h3>Configurations</h3>
        <span className="count">{rows ? rows.length : '…'}</span>
        <select className="type-filter" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by type">
          <option value="">All types</option>
          {CONFIG_TYPES.map(([t]) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="spacer" />
        <button className="btn primary" disabled={!!adding} onClick={() => { setNotice(''); setError(''); setAdding({ type: filter || 'DOMAIN', value: '' }); }}>+ New value</button>
      </div>
      <p className="muted small">
        The values of each TYPE are the choices offered for Domain, Team, Technology and Role when a user is created or
        edited. They become part of API base paths, so use lower-case letters, digits or _ only.
      </p>
      {notice && <div className="alert ok">{notice}</div>}
      {error && <div className="alert error">{error}</div>}
      <div className="card table-card">
        <table className="grid config-table">
          <thead>
            <tr>
              <th>TYPE</th>
              <th>VALUES</th>
              <th className="center">Used by users</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {adding && (
              <tr className="new-tag-row">
                <td>
                  <select value={adding.type} onChange={(e) => setAdding({ ...adding, type: e.target.value })}>
                    {CONFIG_TYPES.map(([t]) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                <td>
                  <input
                    autoFocus
                    placeholder="e.g. wholesale"
                    value={adding.value}
                    onChange={(e) => { setAdding({ ...adding, value: e.target.value }); setError(''); }}
                    onKeyDown={(e) => e.key === 'Enter' && save(e)}
                  />
                </td>
                <td />
                <td className="nowrap right">
                  <button className="btn small primary" disabled={busy || !adding.value.trim()} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>{' '}
                  <button className="btn small ghost" onClick={() => { setAdding(null); setError(''); }}>Cancel</button>
                </td>
              </tr>
            )}
            {shown.map((r) => (
              <tr key={r._id}>
                <td><span className={`pill type-${r.type.toLowerCase()}`}>{r.type}</span></td>
                <td><code>{r.value}</code></td>
                <td className="center">{r.usedBy ? <span className="count">{r.usedBy}</span> : <span className="muted">–</span>}</td>
                <td className="nowrap right">
                  <button
                    className="btn small ghost danger"
                    disabled={r.usedBy > 0}
                    title={r.usedBy ? 'Used by users – change them first' : 'Delete value'}
                    onClick={() => setRemoving(r)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {rows && shown.length === 0 && !adding && (
              <tr><td colSpan={4} className="muted center">No values{filter ? ` for ${filter}` : ''}.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {removing && (
        <ConfirmModal
          title="Delete value"
          message={<>Delete {removing.type} <b>{removing.value}</b>? It will no longer be offered for new or edited users.</>}
          onConfirm={async () => {
            await accounts.removeConfiguration(removing._id);
            setNotice(`${removing.type} "${removing.value}" deleted.`);
            await load();
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </>
  );
}

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString() : '–');
const METHOD_ORDER = ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'];

function AnalyticsTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [resetting, setResetting] = useState(false);
  const [hideUnused, setHideUnused] = useState(false);

  const load = useCallback(() => accounts.analytics().then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const rows = (data?.apis || []).filter((r) => !hideUnused || r.requests > 0);
  const max = Math.max(1, ...rows.map((r) => r.requests));

  return (
    <>
      <div className="section-head">
        <h3>Analytics</h3>
        <span className="muted small">
          Mock API traffic recorded with morgan{data?.since ? ` since ${fmtTime(data.since)}` : ''} · most used first · refreshes every 10 s
        </span>
        <span className="spacer" />
        <label className="check small">
          <input type="checkbox" checked={hideUnused} onChange={(e) => setHideUnused(e.target.checked)} /> Hide APIs without requests
        </label>
        <button className="btn" onClick={load}>Refresh</button>
        <button className="btn ghost danger" onClick={() => setResetting(true)}>Reset</button>
      </div>
      {error && <div className="alert error">{error}</div>}
      {data && (
        <div className="stat-tiles">
          <div className="stat"><span>API requests</span><b>{data.total.requests}</b></div>
          <div className="stat ok"><span>Successful</span><b>{data.total.success}</b></div>
          <div className="stat bad"><span>Failed</span><b>{data.total.failed}</b></div>
          <div className="stat"><span>Success rate</span><b>{data.total.requests ? `${Math.round((data.total.success / data.total.requests) * 1000) / 10}%` : '–'}</b></div>
        </div>
      )}
      <div className="card table-card">
        <table className="grid analytics">
          <thead>
            <tr>
              <th>#</th>
              <th>API</th>
              <th className="num">API requests</th>
              <th className="num">Successful requests</th>
              <th className="num">Failed requests</th>
              <th className="num">Avg ms</th>
              <th>Methods</th>
              <th>Last request</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} className={r.registered ? '' : 'muted-row'}>
                <td className="muted">{i + 1}</td>
                <td>
                  <div className="api-cell">
                    <b>{r.name}</b> {r.version && <span className="badge">{r.env ? `${r.env} · ${r.version}` : r.version}</span>}
                    {!r.registered && r.key !== '__unregistered__' && <span className="pill">deleted</span>}
                  </div>
                  <code className="muted small">{r.basePath}</code>
                  <div className="bar"><span style={{ width: `${(r.requests / max) * 100}%` }} /></div>
                </td>
                <td className="num"><b>{r.requests}</b></td>
                <td className="num ok-text">{r.success}</td>
                <td className={`num ${r.failed ? 'error-text' : 'muted'}`}>{r.failed}</td>
                <td className="num">{r.requests ? r.avgMs : '–'}</td>
                <td className="methods">
                  {METHOD_ORDER.filter((m) => r.methods?.[m]).map((m) => (
                    <span key={m} className="method-pill">{m} {r.methods[m]}</span>
                  ))}
                </td>
                <td className="small muted nowrap">{fmtTime(r.lastAt)}</td>
              </tr>
            ))}
            {data && rows.length === 0 && (
              <tr><td colSpan={8} className="muted center">No API requests yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {resetting && (
        <ConfirmModal
          title="Reset analytics"
          message="Set all request counters back to zero?"
          confirmLabel="Reset"
          onConfirm={async () => {
            await accounts.resetAnalytics();
            await load();
          }}
          onClose={() => setResetting(false)}
        />
      )}
    </>
  );
}

const STATUS_LABEL = { new: 'New', done: 'Done', rejected: 'Rejected' };

function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
}

function AccessRequestsTab({ onChanged }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(
    () =>
      accounts
        .accessRequests()
        .then((r) => {
          setRows(r);
          onChanged?.(r.filter((x) => x.status === 'new').length);
        })
        .catch((e) => setError(e.message)),
    [onChanged]
  );
  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(r, status, message) {
    setBusy(r._id);
    setError('');
    try {
      await accounts.updateAccessRequest(r._id, { status });
      setNotice(message);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  const shown = (rows || []).filter((r) => !filter || r.status === filter);

  return (
    <>
      <div className="section-head">
        <h3>Access requests</h3>
        <span className="count">{rows ? rows.length : '…'}</span>
        <select className="type-filter" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <span className="spacer" />
        <button className="btn" onClick={load}>Refresh</button>
      </div>
      <p className="muted small">
        Requests sent with <b>Sign up</b> on the home page. Create user opens the new-user form with the name and email
        filled in and marks the request as done once the user is saved.
      </p>
      {notice && <div className="alert ok">{notice}</div>}
      {error && <div className="alert error">{error}</div>}
      <div className="card table-card">
        <table className="grid requests-table">
          <thead>
            <tr>
              <th>Received</th>
              <th>Name</th>
              <th>Email</th>
              <th>Remark</th>
              <th className="center">Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r._id} className={r.status === 'new' ? '' : 'muted-row'}>
                <td className="small nowrap">{fmtTime(r.createdAt)}</td>
                <td>{r.name}</td>
                <td><a href={`mailto:${r.email}`}>{r.email}</a></td>
                <td className="remark-cell">{r.remark || <span className="muted">–</span>}</td>
                <td className="center"><span className={`pill req-${r.status}`}>{STATUS_LABEL[r.status] || r.status}</span></td>
                <td className="nowrap right">
                  {r.status === 'new' ? (
                    <>
                      <button className="btn small primary" disabled={!!busy} onClick={() => { setNotice(''); setCreating(r); }}>Create user</button>{' '}
                      <button className="btn small" disabled={!!busy} onClick={() => setStatus(r, 'done', `Request from ${r.email} marked as done.`)}>Mark done</button>{' '}
                      <button className="btn small ghost danger" disabled={!!busy} onClick={() => setStatus(r, 'rejected', `Request from ${r.email} rejected.`)}>Reject</button>
                    </>
                  ) : (
                    <button className="btn small" disabled={!!busy} onClick={() => setStatus(r, 'new', `Request from ${r.email} reopened.`)}>Reopen</button>
                  )}{' '}
                  <button className="btn small ghost danger" disabled={!!busy} onClick={() => setRemoving(r)}>Delete</button>
                </td>
              </tr>
            ))}
            {rows && shown.length === 0 && (
              <tr><td colSpan={6} className="muted center">{filter ? `No ${STATUS_LABEL[filter].toLowerCase()} requests.` : 'No access requests yet. They appear here when someone uses Sign up on the home page.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {creating && (
        <UserModal
          prefill={{ ...splitName(creating.name), email: creating.email }}
          onClose={() => setCreating(null)}
          onSaved={async (u) => {
            const r = creating;
            setCreating(null);
            try {
              await accounts.updateAccessRequest(r._id, { status: 'done', userId: u._id });
              setNotice(`User ${u.email} created and the request marked as done. Share the password from the Users tab.`);
            } catch (e) {
              setError(e.message);
            }
            await load();
          }}
        />
      )}
      {removing && (
        <ConfirmModal
          title="Delete access request"
          message={<>Delete the request from <b>{removing.name}</b> ({removing.email})?</>}
          onConfirm={async () => {
            await accounts.removeAccessRequest(removing._id);
            setNotice(`Request from ${removing.email} deleted.`);
            await load();
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </>
  );
}

const TABS = ['users', 'configurations', 'analytics', 'access-requests'];

export default function AdminPage() {
  const { tab } = useParams();
  const [pending, setPending] = useState(0);
  useEffect(() => {
    accounts.accessRequests().then((r) => setPending(r.filter((x) => x.status === 'new').length)).catch(() => setPending(0));
  }, []);
  if (!TABS.includes(tab)) return <Navigate to="/admin-view/users" replace />;
  return (
    <div className="page admin-page">
      <div className="page-head">
        <div>
          <h1>Admin view</h1>
          <p className="muted">Users, the values offered for their Domain / Team / Technology / Role, API usage and access requests – stored in the portal's NeDB data.</p>
        </div>
      </div>
      <div className="admin-tabs" role="tablist">
        <NavLink to="/admin-view/users" role="tab">Users</NavLink>
        <NavLink to="/admin-view/configurations" role="tab">Configurations</NavLink>
        <NavLink to="/admin-view/analytics" role="tab">Analytics</NavLink>
        <NavLink to="/admin-view/access-requests" role="tab">
          Access requests{pending > 0 && <span className="tab-count" title={`${pending} new`}>{pending}</span>}
        </NavLink>
      </div>
      {tab === 'users' && <UsersTab />}
      {tab === 'configurations' && <ConfigurationsTab />}
      {tab === 'analytics' && <AnalyticsTab />}
      {tab === 'access-requests' && <AccessRequestsTab onChanged={setPending} />}
    </div>
  );
}
