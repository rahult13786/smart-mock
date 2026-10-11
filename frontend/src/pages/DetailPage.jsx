import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { compare } from 'fast-json-patch';
import { data } from '../api.js';
import { useApis } from '../App.jsx';
import { createMergePatch, idFirstEntries, getIn, humanize, isObj, isScalar, removeIn, setIn, summarize, tagPathOf, toPointer } from '../util/value.js';
import ScalarInput from '../components/ScalarInput.jsx';
import ArrayTable from '../components/ArrayTable.jsx';
import ObjectModal from '../components/ObjectModal.jsx';
import { EditorContext } from '../components/editor.js';
import { CopyItemModal, CopyRecordModal } from '../components/CopyModals.jsx';
import { RawJsonModal } from '../components/RawJson.jsx';
import JsonTree from '../components/JsonTree.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';

const pathLabel = (path) => path.map((p) => (typeof p === 'number' ? `[${p}]` : humanize(p))).join(' › ') || 'Record';

export default function DetailPage() {
  const { key, id } = useParams();
  const { apis } = useApis();
  const api = apis.find((a) => a._id === key);
  const basePath = api?.basePath;
  const client = useMemo(() => (basePath ? data(basePath) : null), [basePath]);

  const [original, setOriginal] = useState(null);
  const [draft, setDraft] = useState(null);
  const [edited, setEdited] = useState(() => new Set());
  const [stack, setStack] = useState([]);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('json-patch');
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [raw, setRaw] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [copying, setCopying] = useState(null);
  const [rawPath, setRawPath] = useState(null);
  const [copyRecord, setCopyRecord] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [deletingRecord, setDeletingRecord] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    if (!client) return;
    try {
      const rec = await client.get(id);
      setOriginal(rec);
      setDraft(rec);
      setEdited(new Set());
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [client, id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => setExpanded({}), [id]);

  const setAt = useCallback((path, value) => {
    setDraft((d) => setIn(d, path, value));
    setEdited((s) => new Set(s).add(JSON.stringify(path)));
    setNotice('');
  }, []);

  const open = useCallback((path) => {
    setStack((st) => {
      const top = st[st.length - 1];
      const nested = top && path.length > top.length && top.every((p, i) => p === path[i]);
      return nested ? [...st, path] : [path];
    });
  }, []);

  const commit = useCallback(
    async (ops, applyToDraft, message, opts) => {
      const rec = await client.jsonPatch(id, ops, opts);
      const hadEdits = draft !== original;
      setOriginal(rec);
      setDraft(hadEdits ? (d) => applyToDraft(d) : rec);
      setNotice(message);
      return rec;
    },
    [client, id, draft, original]
  );

  const insertItems = useCallback(
    (path, items, index, verb = 'Added') => {
      const ptr = toPointer(path);
      const ops = items.map((value, k) => ({ op: 'add', path: `${ptr}/${index == null ? '-' : index + k}`, value }));
      return commit(
        ops,
        (d) => {
          const arr = getIn(d, path) || [];
          return setIn(d, path, index == null ? [...arr, ...items] : [...arr.slice(0, index), ...items, ...arr.slice(index)]);
        },
        `${verb} ${items.length} item${items.length === 1 ? '' : 's'} ${index == null ? 'to' : 'in'} ${pathLabel(path)} and saved.`,
        { copy: verb === 'Copied' }
      );
    },
    [commit]
  );

  const addItems = useCallback((path, items) => insertItems(path, items), [insertItems]);

  const saveAt = useCallback(
    (path, value) =>
      commit([{ op: 'replace', path: toPointer(path), value }], (d) => setIn(d, path, value), `Saved raw JSON of ${pathLabel(path)}.`),
    [commit]
  );

  const removeAt = useCallback(
    async (path) => {
      await commit([{ op: 'remove', path: toPointer(path) }], (d) => removeIn(d, path), `Deleted ${pathLabel(path)} from the record.`);
      setStack((st) => st.filter((p) => p.length < path.length));
    },
    [commit]
  );
  const confirmRemove = useCallback((path, onDone) => setRemoving({ path, onDone }), []);

  const enumMap = useMemo(() => new Map((api?.tags || []).filter((t) => t.enum?.length).map((t) => [t.path, t.enum])), [api]);
  const enumFor = useCallback((path) => enumMap.get(tagPathOf(path)), [enumMap]);

  const copyItem = useCallback((path, onDone) => setCopying({ path, onDone }), []);
  const showRaw = useCallback((path) => setRawPath(path), []);

  const editor = useMemo(
    () => ({ draft, setAt, open, addItems, saveAt, copyItem, showRaw, confirmRemove, enumFor }),
    [draft, setAt, open, addItems, saveAt, copyItem, showRaw, confirmRemove, enumFor]
  );

  if (!api) return <div className="page"><p className="muted">Loading…</p></div>;
  if (error) {
    return (
      <div className="page">
        <Link to={`/browse/${key}`} className="back">← Back to list</Link>
        <div className="alert error">{error}</div>
      </div>
    );
  }
  if (!draft) return <div className="page"><p className="muted">Loading record…</p></div>;

  const entries = idFirstEntries(draft);
  const headerFields = entries.filter(([, v]) => isScalar(v) || isObj(v));
  const sections = entries.filter(([, v]) => Array.isArray(v) || isObj(v));
  const dirty = draft !== original;

  function buildPayload() {
    return mode === 'json-patch' ? compare(original, draft) : createMergePatch(original, draft);
  }

  async function save() {
    const payload = buildPayload();
    if ((Array.isArray(payload) && !payload.length) || (isObj(payload) && !Object.keys(payload).length)) {
      setEdited(new Set());
      setDraft(original);
      setNotice('Nothing changed.');
      return;
    }
    setSaving(true);
    try {
      const rec = mode === 'json-patch' ? await client.jsonPatch(id, payload) : await client.mergePatch(id, payload);
      setOriginal(rec);
      setDraft(rec);
      setEdited(new Set());
      setPreview(null);
      setNotice(`Saved with ${mode === 'json-patch' ? 'JSON Patch' : 'JSON Merge Patch'}.`);
    } catch (e) {
      setNotice(`Save failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setDraft(original);
    setEdited(new Set());
    setPreview(null);
    setNotice('');
  }

  return (
    <EditorContext.Provider value={editor}>
      <div className={`page ${dirty ? 'has-savebar' : ''}`}>
        <Link to={`/browse/${key}`} className="back">← {humanize(api.name)} list</Link>

        <div className="page-head">
          <div>
            <h1>{draft.name ? String(draft.name) : String(draft.id)}</h1>
            <p className="muted">
              <code>{api.basePath}/{String(draft.id)}</code>
              {draft.status != null && <span className="pill">{String(draft.status)}</span>}
            </p>
          </div>
          <div className="row gap">
            <button className="btn" onClick={() => setCopyRecord(true)}>Copy record</button>
            <button className="btn danger" onClick={() => setDeletingRecord(true)}>Delete record</button>
            <button className="btn" onClick={() => setRaw((r) => !r)}>{raw ? 'Form view' : 'Raw JSON'}</button>
          </div>
        </div>

        {notice && <div className={`alert ${notice.startsWith('Save failed') ? 'error' : 'ok'}`}>{notice}</div>}

        {raw ? (
          <div className="card raw tree-box">
            <JsonTree value={draft} />
          </div>
        ) : (
          <>
            <div className="card fields">
              {headerFields.map(([k, v]) => (
                <div key={k} className={`field ${typeof v === 'string' && v.length > 60 ? 'span2' : ''}`}>
                  <label title={k}>{humanize(k)}</label>
                  {isObj(v) ? (
                    <button className="link field-link" onClick={() => open([k])}>
                      {summarize(v)} ›
                    </button>
                  ) : (
                    <ScalarInput value={v} readOnly={k === 'id'} multiline options={enumFor([k])} onChange={(nv) => setAt([k], nv)} />
                  )}
                </div>
              ))}
            </div>

            {sections.length > 0 && (
              <div className="sections-bar">
                <span className="muted small">{sections.length} section{sections.length === 1 ? '' : 's'}</span>
                <span className="spacer" />
                <button className="btn small ghost" onClick={() => setExpanded(Object.fromEntries(sections.map(([k]) => [k, true])))}>Expand all</button>
                <button className="btn small ghost" onClick={() => setExpanded({})}>Collapse all</button>
              </div>
            )}
            {sections.map(([k, v]) => {
              const isArr = Array.isArray(v);
              const closed = !expanded[k];
              return (
                <section key={k} className="card list-section">
                  <div className="section-bar">
                    <button className="section-toggle" onClick={() => setExpanded({ ...expanded, [k]: closed })}>
                      <span className="caret">{closed ? '▸' : '▾'}</span>
                      <h2>{humanize(k)}</h2>
                      <span className="count">{isArr ? v.length : 'object'}</span>
                    </button>
                    <button className="btn small raw-btn" title={`Raw JSON of ${k}`} onClick={() => showRaw([k])}>
                      {'{ }'} Raw JSON
                    </button>
                    <button className="btn small ghost danger" title={`Delete ${k} from the record`} onClick={() => confirmRemove([k])}>
                      🗑
                    </button>
                  </div>
                  {!closed && (
                    <ArrayTable
                      key={k}
                      path={[k]}
                      rows={isArr ? v : [v]}
                      rowPath={isArr ? undefined : () => [k]}
                    />
                  )}
                </section>
              );
            })}
          </>
        )}

        {dirty && (
          <div className="savebar">
            <span>{edited.size} field{edited.size === 1 ? '' : 's'} edited</span>
            <span className="spacer" />
            <label className="row gap small">
              PATCH as
              <select value={mode} onChange={(e) => { setMode(e.target.value); setPreview(null); }}>
                <option value="json-patch">JSON Patch (RFC 6902)</option>
                <option value="merge">JSON Merge Patch (RFC 7396)</option>
              </select>
            </label>
            <button className="btn" onClick={() => setPreview(preview ? null : buildPayload())}>
              {preview ? 'Hide payload' : 'Preview payload'}
            </button>
            <button className="btn ghost" onClick={discard}>Discard</button>
            <button className="btn primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
            {preview && <pre className="payload">{JSON.stringify(preview, null, 2)}</pre>}
          </div>
        )}

        {stack.length > 0 && (
          <ObjectModal stack={stack} onNavigate={setStack} onClose={() => setStack([])} />
        )}

        {rawPath && getIn(draft, rawPath) !== undefined && (
          <RawJsonModal path={rawPath} value={getIn(draft, rawPath)} onSave={(v) => saveAt(rawPath, v)} onClose={() => setRawPath(null)} />
        )}

        {copying && (
          <CopyItemModal
            path={copying.path}
            item={getIn(draft, copying.path)}
            siblings={getIn(draft, copying.path.slice(0, -1)) || []}
            onClose={() => setCopying(null)}
            onSave={async (copy) => {
              const listPath = copying.path.slice(0, -1);
              const index = copying.path[copying.path.length - 1] + 1;
              await insertItems(listPath, [copy], index, 'Copied');
              copying.onDone?.(index);
            }}
          />
        )}

        {removing && (
          <ConfirmModal
            title="Delete from record"
            message={(() => {
              const v = getIn(draft, removing.path);
              const what = Array.isArray(v) ? `the list ${pathLabel(removing.path)} (${v.length} item${v.length === 1 ? '' : 's'})` : pathLabel(removing.path);
              return <>Remove <b>{what}</b> from the stored record? This is saved immediately.</>;
            })()}
            onConfirm={async () => {
              await removeAt(removing.path);
              removing.onDone?.();
            }}
            onClose={() => setRemoving(null)}
          />
        )}

        {deletingRecord && (
          <ConfirmModal
            title="Delete record"
            message={<>Delete record <b>{String(original.id)}</b> from <code>{api.basePath}</code>? This cannot be undone.</>}
            confirmLabel="Delete record"
            onConfirm={async () => {
              await client.remove(original.id);
              navigate(`/browse/${key}`, { state: { deleted: original.id } });
            }}
            onClose={() => setDeletingRecord(false)}
          />
        )}

        {copyRecord && (
          <CopyRecordModal
            client={client}
            sourceId={original.id}
            onClose={() => setCopyRecord(false)}
            onCopied={(rec) => {
              setCopyRecord(false);
              setNotice(`Record copied from ${original.id} and saved as ${rec.id}.`);
              navigate(`/browse/${key}/records/${encodeURIComponent(rec.id)}`);
            }}
          />
        )}
      </div>
    </EditorContext.Provider>
  );
}
