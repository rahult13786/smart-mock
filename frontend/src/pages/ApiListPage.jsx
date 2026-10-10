import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { data } from '../api.js';
import { useApis } from '../App.jsx';
import { humanize } from '../util/value.js';
import Pager from '../components/Pager.jsx';
import { CopyRecordModal } from '../components/CopyModals.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';

const PAGE = 25;
const MAX_COLS = 8;

export default function ApiListPage() {
  const { key } = useParams();
  const { apis, refresh } = useApis();
  const api = apis.find((a) => a._id === key);
  const navigate = useNavigate();

  const [filters, setFilters] = useState({});
  const [applied, setApplied] = useState({});
  const [page, setPage] = useState(0);
  const [result, setResult] = useState({ total: 0, items: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [copyFrom, setCopyFrom] = useState(null); // id of the record being copied
  const [copied, setCopied] = useState(null); // {from, id} – last copy, highlighted
  const [reload, setReload] = useState(0);
  const [deleting, setDeleting] = useState(null); // id of the record to delete
  const location = useLocation();
  const [deleted, setDeleted] = useState(location.state?.deleted ?? null); // last deleted id (also from the details page)

  const searchable = useMemo(() => (api?.tags || []).filter((t) => t.searchable), [api]);
  const basePath = api?.basePath;
  const client = useMemo(() => (basePath ? data(basePath) : null), [basePath]); // stable across config refreshes

  useEffect(() => {
    setFilters({});
    setApplied({});
    setPage(0);
    refresh(); // pick up configuration changes made through the API (e.g. new searchable fields)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    setLoading(true);
    client
      // field boxes search "contains" (name.like=…); q searches all searchable fields
      .summary({
        ...Object.fromEntries(Object.entries(applied).map(([k, v]) => [k === 'q' ? 'q' : `${k}.like`, v])),
        limit: PAGE,
        offset: page * PAGE,
      })
      .then((r) => {
        if (cancelled) return;
        setResult(r);
        setError('');
        if (r.searchConfigUpdated) refresh(); // the server switched new fields to searchable
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [client, applied, page, reload]);

  // Columns: id first, then name, then other root scalars (limited)
  const columns = useMemo(() => {
    const seen = new Set();
    for (const it of result.items) Object.keys(it).forEach((k) => k !== '_updatedAt' && seen.add(k));
    const rest = [...seen].filter((k) => k !== 'id' && k !== 'name');
    return ['id', ...(seen.has('name') ? ['name'] : []), ...rest].slice(0, MAX_COLS);
  }, [result.items]);

  if (!api) {
    return <div className="page"><p className="muted">{apis.length ? 'API not found.' : 'Loading…'}</p></div>;
  }

  const pages = Math.max(1, Math.ceil(result.total / PAGE));
  const search = (e) => {
    e.preventDefault();
    setPage(0);
    setApplied({ ...filters });
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            {humanize(api.name)} <span className="badge">{api.version}</span>
          </h1>
          <p className="muted"><code>{api.basePath}</code> · {result.total} record{result.total === 1 ? '' : 's'}</p>
        </div>
        <div className="row gap">
          <Link className="btn" to={`/register?api=${api._id}`}>Settings</Link>
          <button className="btn primary" onClick={() => setCreating(true)}>+ New record</button>
        </div>
      </div>

      {!api.hasSample && (
        <div className="alert warn">
          No sample yet – <Link to={`/register?api=${api._id}`}>add a sample JSON</Link> to generate tags and seed data.
        </div>
      )}

      <form className="card search" onSubmit={search}>
        <label className="grow">
          Search all
          <input value={filters.q || ''} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="Any searchable field…" />
        </label>
        {searchable.map((t) => (
          <label key={t.path}>
            {t.path}
            <input
              placeholder="a,b = any of"
              list={t.enum?.length ? `enum-${t.path}` : undefined}
              value={filters[t.path] || ''}
              onChange={(e) => setFilters({ ...filters, [t.path]: e.target.value })}
            />
            {t.enum?.length > 0 && (
              <datalist id={`enum-${t.path}`}>
                {t.enum.map((v) => <option key={String(v)} value={String(v)} />)}
              </datalist>
            )}
          </label>
        ))}
        <div className="row gap">
          <button className="btn primary">Search</button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setFilters({});
              setApplied({});
              setPage(0);
            }}
          >
            Clear
          </button>
        </div>
      </form>

      {error && <div className="alert error">{error}</div>}
      {deleted != null && (
        <div className="alert ok">Record <b>{String(deleted)}</b> was deleted.</div>
      )}
      {copied && (
        <div className="alert ok">
          Copied <b>{String(copied.from)}</b> and saved it as{' '}
          <Link to={`/browse/${api._id}/records/${encodeURIComponent(copied.id)}`}><b>{String(copied.id)}</b></Link>.
        </div>
      )}

      <div className="card table-wrap">
        <table className="grid">
          <thead>
            <tr>
              {columns.map((c) => <th key={c}>{humanize(c)}</th>)}
              <th className="actions" />
            </tr>
          </thead>
          <tbody>
            {result.items.map((it) => (
              <tr key={it.id} className={copied && String(copied.id) === String(it.id) ? 'added' : undefined}>
                {columns.map((c) => (
                  <td key={c}>
                    {c === 'id' ? (
                      <Link className="id-link" to={`/browse/${api._id}/records/${encodeURIComponent(it.id)}`}>{it.id}</Link>
                    ) : (
                      <span className="cell">{it[c] === undefined || it[c] === null ? '' : String(it[c])}</span>
                    )}
                  </td>
                ))}
                <td className="actions">
                  <button className="btn small ghost copy-btn" title="Copy the whole record as a new record" onClick={() => setCopyFrom(it.id)}>
                    ⧉ Copy
                  </button>
                  <button className="btn small ghost del-btn" title="Delete this record" onClick={() => setDeleting(it.id)}>
                    🗑
                  </button>
                </td>
              </tr>
            ))}
            {!loading && result.items.length === 0 && (
              <tr><td colSpan={columns.length + 1} className="muted center">No records</td></tr>
            )}
          </tbody>
        </table>
        <Pager page={page} pages={pages} onPage={setPage} />
      </div>

      {deleting != null && (
        <ConfirmModal
          title="Delete record"
          message={<>Delete record <b>{String(deleting)}</b> from <code>{api.basePath}</code>? This cannot be undone.</>}
          confirmLabel="Delete record"
          onConfirm={async () => {
            await client.remove(deleting);
            setDeleted(deleting);
            setCopied(null);
            setReload((n) => n + 1);
            refresh();
          }}
          onClose={() => setDeleting(null)}
        />
      )}

      {copyFrom != null && (
        <CopyRecordModal
          client={client}
          sourceId={copyFrom}
          onClose={() => setCopyFrom(null)}
          onCopied={async (rec) => {
            setCopied({ from: copyFrom, id: rec.id });
            setDeleted(null);
            setCopyFrom(null);
            setReload((n) => n + 1);
            refresh();
          }}
        />
      )}

      {creating && (
        <NewRecordModal
          client={client}
          onClose={() => setCreating(false)}
          onCreated={async (rec) => {
            setCreating(false);
            await refresh();
            navigate(`/browse/${api._id}/records/${encodeURIComponent(rec.id)}`);
          }}
        />
      )}
    </div>
  );
}

function NewRecordModal({ client, onClose, onCreated }) {
  const [text, setText] = useState('{\n  "id": "",\n  "name": ""\n}');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    let body;
    try {
      body = JSON.parse(text);
    } catch (e) {
      setError(`Invalid JSON: ${e.message}`);
      return;
    }
    if (body && body.id === '') delete body.id; // let the server generate one
    setBusy(true);
    try {
      const rec = await client.create(body);
      onCreated(Array.isArray(rec) ? rec[0] : rec);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h3>New record</h3>
          <button className="btn ghost" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p className="muted small">POST a JSON object (or array of objects). Leave id empty to generate one.</p>
          <textarea className="code" rows={16} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
          {error && <div className="alert error">{error}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Create'}</button>
        </div>
      </div>
    </div>
  );
}
