import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { accounts } from '../api.js';
import ConfirmModal from '../components/ConfirmModal.jsx';

const MASK = '******';
const FOLDER_FIELDS = [
  ['domain', 'Domain'],
  ['env', 'Env'],
  ['team', 'Team'],
  ['role', 'Role'],
  ['technology', 'Technology'],
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

function UserModal({ user, onClose, onSaved }) {
  const editing = !!user;
  const [form, setForm] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    email: user?.email || '',
    active: user ? !!user.active : true,
  });
  const [password, setPassword] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) accounts.newPassword().then((r) => setPassword(r.password)).catch((e) => setError(e.message));
  }, [editing]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function save(e) {
    e?.preventDefault();
    const missing = [['firstName', 'First name'], ['lastName', 'Last name'], ['email', 'Email']].filter(([k]) => !form[k].trim()).map(([, l]) => l);
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
      title={editing ? `Edit user – ${user.email}` : 'New user'}
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
              <tr><td colSpan={6} className="muted center">No users yet – click + New user.</td></tr>
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

function FolderModal({ onClose, onSaved }) {
  const [options, setOptions] = useState(null);
  const [form, setForm] = useState(Object.fromEntries(FOLDER_FIELDS.map(([k]) => [k, ''])));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    accounts.folderOptions().then(setOptions).catch((e) => setError(e.message));
  }, []);

  const complete = FOLDER_FIELDS.every(([k]) => form[k]);
  const name = FOLDER_FIELDS.map(([k]) => form[k] || '…').join('-');

  async function save() {
    if (!complete) return setError(`${FOLDER_FIELDS.filter(([k]) => !form[k]).map(([, l]) => l).join(', ')} required`);
    setBusy(true);
    setError('');
    try {
      onSaved(await accounts.createFolder(form));
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="New folder"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !options} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <div className="user-form">
        {FOLDER_FIELDS.map(([k, label]) => (
          <label key={k}>
            {label} <span className="required">*</span>
            <select value={form[k]} onChange={(e) => { setForm({ ...form, [k]: e.target.value }); setError(''); }}>
              <option value="">Select…</option>
              {(options?.[k] || []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        ))}
      </div>
      <div className="folder-preview">
        Folder name <code>{name}</code>
      </div>
      {error && <div className="alert error">{error}</div>}
    </Modal>
  );
}

function AddUsersModal({ folder, onClose, onSaved }) {
  const [users, setUsers] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    accounts.users().then(setUsers).catch((e) => setError(e.message));
  }, []);

  const available = useMemo(() => (users || []).filter((u) => !folder.userIds.includes(u._id)), [users, folder.userIds]);
  const toggle = (id) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  async function save() {
    setBusy(true);
    setError('');
    try {
      onSaved(await accounts.setFolderUsers(folder._id, [...folder.userIds, ...picked]));
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Add users – ${folder.name}`}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <span className="muted small">{picked.size} selected</span>
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !picked.size} onClick={save}>{busy ? 'Saving…' : 'Add user'}</button>
        </>
      }
    >
      {!users && !error && <p className="muted">Loading users…</p>}
      {users && available.length === 0 && <p className="muted">Every user is already in this folder{users.length ? '' : ' (no users yet – create them in the Users tab)'}.</p>}
      {available.length > 0 && (
        <table className="grid">
          <thead>
            <tr>
              <th className="center">
                <input
                  type="checkbox"
                  title="Select all"
                  checked={picked.size === available.length}
                  onChange={(e) => setPicked(new Set(e.target.checked ? available.map((u) => u._id) : []))}
                />
              </th>
              <th>First name</th>
              <th>Last name</th>
              <th>Email</th>
              <th className="center">Active</th>
            </tr>
          </thead>
          <tbody>
            {available.map((u) => (
              <tr key={u._id} className={picked.has(u._id) ? 'picked' : ''} onClick={() => toggle(u._id)}>
                <td className="center"><input type="checkbox" checked={picked.has(u._id)} onChange={() => toggle(u._id)} onClick={(e) => e.stopPropagation()} /></td>
                <td>{u.firstName}</td>
                <td>{u.lastName}</td>
                <td>{u.email}</td>
                <td className="center"><span className={`pill ${u.active ? 'ok' : 'off'}`}>{u.active ? 'Active' : 'Inactive'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {error && <div className="alert error">{error}</div>}
    </Modal>
  );
}

function FolderUsers({ folderId, onChanged, onDeleted }) {
  const [folder, setFolder] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [checked, setChecked] = useState(() => new Set());
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const show = useCallback((f) => {
    setFolder(f);
    setChecked(new Set(f.userIds));
    setEditing(false);
  }, []);

  useEffect(() => {
    setFolder(null);
    setNotice('');
    setError('');
    accounts.folder(folderId).then(show).catch((e) => setError(e.message));
  }, [folderId, show]);

  async function saveEdit() {
    setBusy(true);
    setError('');
    try {
      const f = await accounts.setFolderUsers(folder._id, folder.userIds.filter((id) => checked.has(id)));
      const removed = folder.userIds.length - f.userIds.length;
      show(f);
      setNotice(removed ? `${removed} user${removed === 1 ? '' : 's'} removed from the folder.` : 'No change.');
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !folder) return <div className="alert error">{error}</div>;
  if (!folder) return <p className="muted">Loading folder…</p>;

  return (
    <div className="card folder-users">
      <div className="section-head">
        <h3><code>{folder.name}</code></h3>
        <span className="count">{folder.users.length} user{folder.users.length === 1 ? '' : 's'}</span>
        <span className="spacer" />
        {editing ? (
          <>
            <button className="btn ghost" disabled={busy} onClick={() => { setChecked(new Set(folder.userIds)); setEditing(false); }}>Cancel</button>
            <button className="btn primary" disabled={busy} onClick={saveEdit}>{busy ? 'Saving…' : 'Save'}</button>
          </>
        ) : (
          <>
            <button className="btn primary" onClick={() => setAdding(true)}>+ Add user</button>
            <button className="btn" disabled={!folder.users.length} onClick={() => { setNotice(''); setEditing(true); }}>Edit</button>
            <button className="btn ghost danger" title="Delete folder" onClick={() => setRemoving(true)}>🗑</button>
          </>
        )}
      </div>
      <div className="folder-tags">
        {FOLDER_FIELDS.map(([k, label]) => (
          <span key={k} className="pill">{label}: {folder[k]}</span>
        ))}
      </div>
      {editing && <p className="muted small">Untick users to remove them from this folder, then Save.</p>}
      {notice && <div className="alert ok">{notice}</div>}
      {error && <div className="alert error">{error}</div>}
      <table className="grid">
        <thead>
          <tr>
            <th className="center">Edit</th>
            <th>First name</th>
            <th>Last name</th>
            <th>Email</th>
            <th className="center">Active</th>
          </tr>
        </thead>
        <tbody>
          {folder.users.map((u) => (
            <tr key={u._id} className={editing && !checked.has(u._id) ? 'unpicked' : ''}>
              <td className="center">
                <input
                  type="checkbox"
                  disabled={!editing}
                  checked={checked.has(u._id)}
                  onChange={() => {
                    const next = new Set(checked);
                    if (next.has(u._id)) next.delete(u._id);
                    else next.add(u._id);
                    setChecked(next);
                  }}
                />
              </td>
              <td>{u.firstName}</td>
              <td>{u.lastName}</td>
              <td>{u.email}</td>
              <td className="center"><span className={`pill ${u.active ? 'ok' : 'off'}`}>{u.active ? 'Active' : 'Inactive'}</span></td>
            </tr>
          ))}
          {folder.users.length === 0 && (
            <tr><td colSpan={5} className="muted center">No users in this folder – click + Add user.</td></tr>
          )}
        </tbody>
      </table>
      {adding && (
        <AddUsersModal
          folder={folder}
          onClose={() => setAdding(false)}
          onSaved={(f) => {
            const added = f.userIds.length - folder.userIds.length;
            setAdding(false);
            show(f);
            setNotice(`${added} user${added === 1 ? '' : 's'} added to the folder.`);
            onChanged();
          }}
        />
      )}
      {removing && (
        <ConfirmModal
          title="Delete folder"
          message={<>Delete folder <b>{folder.name}</b> and its user associations? The users themselves are kept.</>}
          onConfirm={async () => {
            await accounts.removeFolder(folder._id);
            onDeleted(folder);
          }}
          onClose={() => setRemoving(false)}
        />
      )}
    </div>
  );
}

function FoldersTab() {
  const [folders, setFolders] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');
  const [params, setParams] = useSearchParams();
  const selected = params.get('folder');
  const select = (id) => setParams(id ? { folder: id } : {});

  const load = useCallback(() => accounts.folders().then(setFolders).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <div className="section-head">
        <h3>Folders</h3>
        <span className="count">{folders ? folders.length : '…'}</span>
        <span className="spacer" />
        <button className="btn primary" onClick={() => setCreating(true)}>+ New folder</button>
      </div>
      {notice && <div className="alert ok">{notice}</div>}
      {error && <div className="alert error">{error}</div>}
      <div className="card table-card">
        <table className="grid folders">
          <thead>
            <tr>
              <th>Folder name</th>
              {FOLDER_FIELDS.map(([k, label]) => <th key={k}>{label}</th>)}
              <th className="center">Users</th>
            </tr>
          </thead>
          <tbody>
            {folders?.map((f) => (
              <tr key={f._id} className={`clickable ${selected === f._id ? 'selected' : ''}`} onClick={() => select(selected === f._id ? null : f._id)}>
                <td><code>{f.name}</code></td>
                {FOLDER_FIELDS.map(([k]) => <td key={k}>{f[k]}</td>)}
                <td className="center"><span className="count">{f.userCount}</span></td>
              </tr>
            ))}
            {folders && folders.length === 0 && (
              <tr><td colSpan={FOLDER_FIELDS.length + 2} className="muted center">No folders yet – click + New folder.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {folders && folders.length > 0 && !selected && <p className="muted small">Select a folder to see and manage its users.</p>}
      {selected && (
        <FolderUsers
          folderId={selected}
          onChanged={load}
          onDeleted={(f) => {
            select(null);
            setNotice(`Folder ${f.name} deleted.`);
            load();
          }}
        />
      )}
      {creating && (
        <FolderModal
          onClose={() => setCreating(false)}
          onSaved={(f) => {
            setCreating(false);
            setNotice(`Folder ${f.name} created.`);
            load();
            select(f._id);
          }}
        />
      )}
    </>
  );
}

export default function AdminPage() {
  const { tab } = useParams();
  if (tab !== 'users' && tab !== 'folders') return <Navigate to="/admin-view/users" replace />;
  return (
    <div className="page admin-page">
      <div className="page-head">
        <div>
          <h1>Admin view</h1>
          <p className="muted">Users and folders, stored in the portal's NeDB data.</p>
        </div>
      </div>
      <div className="admin-tabs" role="tablist">
        <NavLink to="/admin-view/users" role="tab">Users</NavLink>
        <NavLink to="/admin-view/folders" role="tab">Folders</NavLink>
      </div>
      {tab === 'users' ? <UsersTab /> : <FoldersTab />}
    </div>
  );
}
