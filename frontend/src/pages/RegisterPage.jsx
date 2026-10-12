import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { admin, auth } from '../api.js';
import { useApis } from '../App.jsx';
import { nextVersion } from '../util/value.js';
import EnumModal from '../components/EnumModal.jsx';
import MockModal from '../components/MockModal.jsx';
import RegexModal, { RegexIcon } from '../components/RegexModal.jsx';
import MapModal, { MapIcon } from '../components/MapModal.jsx';

const isIdPath = (p) => /^id$/i.test(String(p).split('.').pop());
const createOf = (t) => (t.create === undefined ? t.path === 'id' : !!t.create);

function EnumCell({ tag, onEdit }) {
  const vals = tag.enum || [];
  return (
    <button
      className={`btn small enum-btn ${vals.length ? 'set' : ''}`}
      title={vals.length ? vals.map(String).join(', ') : 'Define allowed values'}
      onClick={onEdit}
    >
      {vals.length ? `${vals.length} value${vals.length === 1 ? '' : 's'}` : '+ Enum'}
    </button>
  );
}

const TAG_TYPES = ['string', 'number', 'boolean'];

const ENV_TABS = [
  ['dev', 'Dev'],
  ['st', 'ST'],
  ['sit', 'SIT'],
];
const SCOPE_FIELDS = [
  ['domain', 'Domain'],
  ['team', 'Team'],
  ['technology', 'Technology'],
  ['role', 'Role'],
];
const envOf = (a) => a.env || (a.group ? a.group.split('-').pop() : 'other');
const emptyScope = { domain: '', team: '', technology: '', role: '' };

export default function RegisterPage() {
  const { apis, refresh, user } = useApis();
  const [params, setParams] = useSearchParams();
  const selected = params.get('api');
  const tab = params.get('env') || 'dev';
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [version, setVersion] = useState('v1');
  const [env, setEnv] = useState(tab);
  const [scope, setScope] = useState(emptyScope);
  const [options, setOptions] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [versionOf, setVersionOf] = useState(null);
  const [prefill, setPrefill] = useState(null);

  const go = (nextEnv, key) => setParams({ env: nextEnv, ...(key ? { api: key } : {}) });
  const select = (key) => go(tab, key);

  useEffect(() => {
    refresh();
    const onFocus = () => document.visibilityState === 'visible' && refresh();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refresh]);

  useEffect(() => {
    if (user?.isAdmin && adding && !options) auth.options().then(setOptions).catch((e) => setError(e.message));
  }, [user, adding, options]);

  useEffect(() => {
    const a = selected && apis.find((x) => x._id === selected);
    if (a && envOf(a) !== tab) go(envOf(a), a._id);
  }, [selected, apis]);

  const tabs = useMemo(() => {
    const list = ENV_TABS.map(([k, label]) => ({ key: k, label, count: apis.filter((a) => envOf(a) === k).length }));
    const other = apis.filter((a) => envOf(a) === 'other').length;
    return other ? [...list, { key: 'other', label: 'Other', count: other }] : list;
  }, [apis]);
  const shown = apis.filter((a) => envOf(a) === tab);

  function openForm() {
    setEnv(ENV_TABS.some(([k]) => k === tab) ? tab : 'dev');
    setAdding(true);
  }

  function startNewVersion(api, note) {
    setVersionOf(api);
    setName(api.name);
    setVersion(nextVersion(api.version, apis.filter((a) => a.name === api.name && (a.group || '') === (api.group || '')).map((a) => a.version)));
    if (api.env) setEnv(api.env);
    if (user?.isAdmin && api.group) setScope({ domain: api.domain, team: api.team, technology: api.technology, role: api.role });
    setError('');
    setAdding(true);
    setPrefill({ from: api._id, note });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function closeForm() {
    setAdding(false);
    setVersionOf(null);
    setName('');
    setVersion('v1');
    setScope(emptyScope);
    setError('');
  }

  const prefix = user?.isAdmin ? SCOPE_FIELDS.map(([k]) => scope[k] || '…').join('-') : user?.scope || '';
  const group = `${prefix}-${env}`;

  async function create(e) {
    e.preventDefault();
    if (user?.isAdmin) {
      const missing = SCOPE_FIELDS.filter(([k]) => !scope[k]).map(([, l]) => l);
      if (missing.length) return setError(`Choose ${missing.join(', ')}`);
    }
    setBusy(true);
    setError('');
    try {
      const api = await admin.create({ name, version, env, ...(user?.isAdmin ? scope : {}) });
      await refresh();
      if (versionOf && prefill) setPrefill({ ...prefill, key: api._id });
      else setPrefill(null);
      closeForm();
      go(api.env || env, api._id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Register API</h1>
          <p className="muted">
            Each API gets its own path <code>/api/{'{domain}-{team}-{technology}-{role}-{env}'}/{'{name}'}/{'{version}'}</code> and
            its own NeDB data file.
          </p>
        </div>
        <button className="btn primary round" title="Add API" onClick={() => (adding ? closeForm() : openForm())}>
          {adding ? '×' : '+'}
        </button>
      </div>

      {adding && (
        <form className="card create-form" onSubmit={create}>
          {versionOf && (
            <div className="alert warn wide">
              New version of <b>{versionOf.name}</b> ({versionOf.version}). Its sample will be copied into the new
              version so you can extend it.
            </div>
          )}
          <label className="wide">
            Base path
            {user?.isAdmin ? (
              <div className="scope-selects">
                {SCOPE_FIELDS.map(([k, label]) => (
                  <select key={k} value={scope[k]} disabled={!!versionOf} onChange={(e) => setScope({ ...scope, [k]: e.target.value })}>
                    <option value="">{label}…</option>
                    {(options?.[k] || []).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ))}
                <select value={env} disabled={!!versionOf} onChange={(e) => setEnv(e.target.value)}>
                  {ENV_TABS.map(([k]) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
            ) : (
              <div className="base-path">
                <span className="prefix" title="From your user – read only">{prefix}-</span>
                <select value={env} disabled={!!versionOf} onChange={(e) => setEnv(e.target.value)} aria-label="Env">
                  {ENV_TABS.map(([k]) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
            )}
          </label>
          <label>
            Name
            <input
              autoFocus={!versionOf}
              required
              value={name}
              readOnly={!!versionOf}
              className={versionOf ? 'readonly' : ''}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. sampleapi"
            />
          </label>
          <label>
            Version
            <input required autoFocus={!!versionOf} value={version} onChange={(e) => setVersion(e.target.value)} placeholder="v1" />
          </label>
          <button className="btn primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create'}
          </button>
          <div className="path-preview wide">
            API path <code>/api/{group}/{name.trim().toLowerCase() || '{name}'}/{version.trim() || '{version}'}</code>
          </div>
          {error && <div className="alert error wide">{error}</div>}
        </form>
      )}

      <div className="env-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} role="tab" className={tab === t.key ? 'on' : ''} onClick={() => go(t.key)}>
            {t.label} <span className="count">{t.count}</span>
          </button>
        ))}
      </div>

      <div className="api-list">
        {shown.length === 0 && !adding && (
          <div className="empty card">
            No {tabs.find((t) => t.key === tab)?.label || tab} APIs{user?.isAdmin ? '' : ` for ${user?.scope}`} yet. Click <b>+</b> to register one.
          </div>
        )}
        {shown.map((a) => (
          <ApiPanel
            key={a._id}
            api={a}
            open={selected === a._id}
            onToggle={() => select(selected === a._id ? null : a._id)}
            onChanged={refresh}
            onNewVersion={(note) => startNewVersion(a, note)}
            prefill={prefill && prefill.key === a._id ? prefill : null}
            onPrefillUsed={() => setPrefill(null)}
          />
        ))}
      </div>
    </div>
  );
}

function ApiPanel({ api, open, onToggle, onChanged, onNewVersion, prefill, onPrefillUsed }) {
  const [sampleText, setSampleText] = useState('');
  const [editingSample, setEditingSample] = useState(!api.hasSample);
  const [tags, setTags] = useState(api.tags);
  const [removed, setRemoved] = useState([]);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newTag, setNewTag] = useState(null);
  const [tagError, setTagError] = useState(null);
  const [paths, setPaths] = useState([]);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [mocking, setMocking] = useState(false);
  const [enumEdit, setEnumEdit] = useState(null);
  const [regexEdit, setRegexEdit] = useState(null);
  const [mapEdit, setMapEdit] = useState(null);
  const sampleRef = useRef(null);
  const [maxRecords, setMaxRecords] = useState(api.maxRecords ?? 10);
  useEffect(() => setMaxRecords(api.maxRecords ?? 10), [api.maxRecords]);

  function saveMaxRecords() {
    const n = Number(maxRecords);
    if (!Number.isInteger(n) || n < 1) return setMsg({ type: 'error', text: '# Records must be a whole number of 1 or more' });
    run(async () => {
      await admin.update(api._id, { maxRecords: n });
      return `# Records set to ${n} – POST requests beyond ${n} stored records are rejected.`;
    }, 'Saved');
  }

  const syncedTags = useRef(api.tags);
  const tagsRef = useRef(tags);
  tagsRef.current = tags;
  useEffect(() => {
    const clean = JSON.stringify(tagsRef.current) === JSON.stringify(syncedTags.current);
    syncedTags.current = api.tags;
    if (clean) {
      setTags(api.tags);
      setRemoved([]);
    }
  }, [api.tags]);
  useEffect(() => setEditingSample(!api.hasSample), [api.hasSample]);

  useEffect(() => {
    if (!open || !prefill) return;
    admin
      .sample(prefill.from)
      .then((s) => {
        setEditingSample(true);
        setSampleText(JSON.stringify(s, null, 2));
        setMsg({ type: 'warn', text: `Sample copied from the previous version. ${prefill.note || 'Update it and save.'}` });
      })
      .catch(() => {})
      .finally(onPrefillUsed);
  }, [open, prefill, onPrefillUsed]);

  useEffect(() => {
    if (open && api.hasSample) admin.paths(api._id).then(setPaths).catch(() => setPaths([]));
  }, [open, api._id, api.hasSample, api.updatedAt]);

  const tagsDirty = removed.length > 0 || JSON.stringify(tags) !== JSON.stringify(api.tags);

  function showTagError(err, path) {
    setTagsOpen(true);
    const d = err.data || err;
    const first = (d.invalid || d.results || []).find((r) => !r.ok) || {};
    setTagError({
      path: first.path || path,
      code: first.code || d.code,
      reason: first.reason || d.error || err.message,
      suggestions: first.suggestions || [],
      hint: d.hint,
    });
  }

  async function addTag() {
    const path = newTag.path.trim();
    setTagError(null);
    if (!path) return;
    if (tags.some((t) => t.path === path)) {
      setTagError({ path, reason: `"${path}" is already in the list`, suggestions: [] });
      return;
    }
    try {
      const r = await admin.validateTags(api._id, [{ path, type: newTag.type }]);
      if (!r.valid) return showTagError(r, path);
      const norm = r.results[0].path;
      setTags([...tags, { path: norm, level: norm.split('.').length, type: newTag.type, searchable: newTag.searchable, custom: true, isNew: true, ...(newTag.unique || norm === 'id' ? { unique: true } : {}), ...(newTag.enum?.length ? { enum: newTag.enum } : {}), ...(newTag.must ? { must: true } : {}), create: !!newTag.create }]);
      setRemoved(removed.filter((p) => p !== norm));
      setNewTag(null);
    } catch (e) {
      showTagError(e, path);
    }
  }

  function removeTag(t) {
    setTags(tags.filter((x) => x.path !== t.path));
    if (!t.isNew) setRemoved([...removed, t.path]);
  }

  async function saveTags() {
    setTagError(null);
    const payload = [
      ...tags.map(({ path, type, searchable, unique, custom, enum: values, must, create, regex, map }) => ({
        path,
        type,
        searchable,
        unique: !!unique,
        custom,
        enum: values || [],
        must: !!must,
        create: create === undefined ? path === 'id' : !!create,
        ...(isIdPath(path) ? { regex: regex || null } : { map: map || null }),
      })),
      ...removed.map((path) => ({ path, remove: true })),
    ];
    setBusy(true);
    setMsg(null);
    try {
      const r = await admin.saveTags(api._id, payload);
      syncedTags.current = tags;
      const warn = [
        ...(r.enumWarnings || []).map(
          (w) => `${w.count} stored value${w.count === 1 ? '' : 's'} of "${w.path}" ${w.count === 1 ? 'is' : 'are'} not in its allowed values (e.g. ${w.values.join(', ')})`
        ),
        ...(r.uniqueWarnings || []).map(
          (w) => `"${w.path}" is unique but the data has duplicates (${w.duplicates.join(', ')}) – addressing those items by key returns an "ambiguous" error`
        ),
      ].join('; ');
      setMsg(
        warn
          ? { type: 'warn', text: `Saved. Note: ${warn}.` }
          : { type: 'ok', text: 'Tag configuration validated against the sample, saved, and records re-indexed.' }
      );
      await onChanged();
    } catch (e) {
      if (e.status === 422) showTagError(e);
      else setMsg({ type: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function saveConfig(index, key, value) {
    const t = tags[index];
    const apply = (list) => list.map((x) => (x.path === t.path ? { ...x, [key]: value } : x));
    if (!t.isNew) {
      await admin.saveTags(api._id, [{ path: t.path, [key]: value }]);
      syncedTags.current = apply(syncedTags.current);
    }
    setTags(apply(tags));
    const label = key === 'regex' ? 'Regex' : 'Map';
    const detail = key === 'map' && value.enabled ? ` (from ${value.source})` : '';
    setMsg({ type: 'ok', text: `${label} of "${t.path}" ${value.enabled ? 'enabled' : 'disabled'}${detail}${t.isNew ? ' – save the tags to keep it' : ' and saved'}.` });
    if (!t.isNew) await onChanged();
  }

  function openSampleEditor() {
    setEditingSample(true);
    loadCurrentSample();
    setTimeout(() => sampleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }

  async function run(fn, ok) {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fn();
      setMsg({ type: 'ok', text: typeof text === 'string' ? text : ok });
      await onChanged();
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  function saveSample() {
    let parsed;
    try {
      parsed = JSON.parse(sampleText);
    } catch (e) {
      setMsg({ type: 'error', text: `Invalid JSON: ${e.message}` });
      return;
    }
    run(async () => {
      const r = await admin.saveSample(api._id, parsed);
      setEditingSample(false);
      setSampleText('');
      setTagsOpen(true);
      const ids = r.tags.filter((t) => isIdPath(t.path)).length;
      return `Sample saved – ${r.seeded} record(s) seeded, ${ids} id tag${ids === 1 ? '' : 's'} stored. Use + Add tag for any other field you want to configure.`;
    }, 'Sample saved');
  }

  async function loadFile(e) {
    const f = e.target.files?.[0];
    if (f) setSampleText(await f.text());
  }

  async function loadCurrentSample() {
    try {
      const s = await admin.sample(api._id);
      setSampleText(JSON.stringify(s, null, 2));
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    }
  }

  const base = `${window.location.origin}${api.basePath}`;

  return (
    <div className={`card api-panel ${open ? 'open' : ''}`}>
      <button className="api-row" onClick={onToggle}>
        <span className="caret">{open ? '▾' : '▸'}</span>
        <span className="api-name">{api.name}</span>
        <span className="badge">{api.version}</span>
        <code className="muted">{api.basePath}</code>
        <span className="spacer" />
        <span className="muted small">{api.recordCount ?? 0} records</span>
        {!api.hasSample && <span className="pill warn">needs sample</span>}
      </button>

      {open && (
        <div className="api-body">
          <div className="grid3">
            <label>
              Name
              <input value={api.name} readOnly className="readonly" />
            </label>
            <label>
              Version
              <input value={api.version} readOnly className="readonly" />
            </label>
            <label>
              # Records <span className="muted small">{api.recordCount ?? 0} stored</span>
              <div className="records-limit">
                <input
                  type="number"
                  min="1"
                  value={maxRecords}
                  onChange={(e) => setMaxRecords(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveMaxRecords()}
                />
                <button className="btn small" disabled={busy || String(maxRecords) === String(api.maxRecords)} onClick={saveMaxRecords}>Save</button>
              </div>
            </label>
          </div>

          <details className="endpoints">
            <summary>Endpoints</summary>
            <table className="kv">
              <tbody>
                <tr><td>GET</td><td><code>{base}</code> <span className="muted">?view=summary&amp;limit=&amp;skip=&amp;q=</span></td></tr>
                <tr><td>GET</td><td><code>{base}/:id</code></td></tr>
                <tr><td>GET</td><td><code>{base}?id=a,b,c</code> <span className="muted">records with those ids, as an array</span></td></tr>
                <tr><td>GET</td><td><code>{base}?status=x,y&amp;agreementType=z</code> <span className="muted">any field of the sample; not-yet-searchable fields are enabled automatically</span></td></tr>
                <tr><td>POST</td><td><code>{base}</code> <span className="muted">object or array of objects</span></td></tr>
                <tr><td>PATCH</td><td><code>{base}/:id</code> <span className="muted">Content-Type application/json-patch+json (RFC 6902) or application/merge-patch+json (RFC 7396)</span></td></tr>
              </tbody>
            </table>
          </details>

          <section>
            <div className="section-head">
              <h3>Sample JSON</h3>
              {api.hasSample && (
                <button className="btn primary mock-btn" title="Generate up to 10 mock records from a template" onClick={() => setMocking(true)}>
                  ✦ Create mocks
                </button>
              )}
              {api.hasSample && !editingSample && (
                <button className="btn" onClick={openSampleEditor}>
                  Replace sample
                </button>
              )}
            </div>
            {editingSample ? (
              <>
                <textarea
                  ref={sampleRef}
                  className="code"
                  rows={14}
                  placeholder='Paste a sample record (object) or an array of records, e.g. [{"id":"1","name":"First"}]'
                  value={sampleText}
                  onChange={(e) => setSampleText(e.target.value)}
                  spellCheck={false}
                />
                <div className="row gap">
                  <button className="btn primary" disabled={busy || !sampleText.trim()} onClick={saveSample}>
                    {busy ? 'Saving…' : 'Save sample'}
                  </button>
                  <label className="btn file">
                    Load .json file
                    <input type="file" accept=".json,application/json,.txt" onChange={loadFile} hidden />
                  </label>
                  {api.hasSample && (
                    <button className="btn ghost" onClick={() => setEditingSample(false)}>Cancel</button>
                  )}
                  <span className="muted small">Records in the sample are stored as data (upserted by id).</span>
                </div>
              </>
            ) : (
              <p className="muted">
                Sample saved. <Link to={`/browse/${api._id}`}>Open records →</Link>
              </p>
            )}
          </section>

          {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}

          {api.hasSample && (
            <section>
              <div className="section-head">
                <button className="tags-toggle" onClick={() => setTagsOpen((o) => !o)} aria-expanded={tagsOpen}>
                  <span className="caret">{tagsOpen ? '▾' : '▸'}</span>
                  <h3>Tags</h3>
                  <span className="count">{tags.length}</span>
                  {tags.some((t) => t.unique) && <span className="count on">{tags.filter((t) => t.unique).length} unique</span>}
                  {tags.some((t) => t.enum?.length) && <span className="count on">{tags.filter((t) => t.enum?.length).length} enum</span>}
                  {tags.some((t) => t.must) && <span className="count on">{tags.filter((t) => t.must).length} must</span>}
                  {tags.some((t) => t.regex?.enabled) && <span className="count on">{tags.filter((t) => t.regex?.enabled).length} regex</span>}
                  {tags.some((t) => t.map?.enabled) && <span className="count on">{tags.filter((t) => t.map?.enabled).length} map</span>}
                </button>
                {tagsOpen && <span className="muted small">id paths of the sample + the paths you add</span>}
                <span className="spacer" />
                <button
                  className="btn"
                  title="Add a tag"
                  disabled={!!newTag}
                  onClick={() => {
                    setTagError(null);
                    setTagsOpen(true);
                    setNewTag({ path: '', type: 'string', searchable: true, unique: false, must: false, create: false });
                  }}
                >
                  + Add tag
                </button>
                <button className="btn primary" disabled={!tagsDirty || busy} onClick={saveTags}>
                  {busy ? 'Saving…' : 'Save tags'}
                </button>
              </div>

              {tagsOpen && (
                <>
              {tagError && (
                <div className="alert error tag-error">
                  <div><b>{tagError.reason}</b></div>
                  {tagError.code !== 'TYPE_MISMATCH' && tagError.suggestions?.length > 0 && (
                    <div className="suggest">
                      Did you mean:{' '}
                      {tagError.suggestions.map((p) => (
                        <button
                          key={p}
                          className="chip"
                          onClick={() => {
                            const found = paths.find((x) => x.path === p);
                            setNewTag({ ...(newTag || { searchable: true }), path: p, type: found?.type || newTag?.type || 'string' });
                            setTagError(null);
                          }}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  )}
                  {(tagError.code === 'PATH_NOT_IN_SAMPLE' || tagError.code === 'NOT_A_VALUE') && (
                    <>
                      <div className="muted small">
                        The path must exist in the sample. Update the sample to include it, or create a new version of
                        this API with an updated sample.
                      </div>
                      <div className="row gap">
                        <button className="btn" onClick={openSampleEditor}>Update sample</button>
                        <button
                          className="btn"
                          onClick={() => onNewVersion(`Add "${tagError.path}" to it, save, then add the tag.`)}
                        >
                          Create new version
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              <table className="grid">
                <thead>
                  <tr>
                    <th>Path</th>
                    <th>Level</th>
                    <th>Type</th>
                    <th className="center" title="Key of list items: lets PATCH paths address an item by this value">Unique</th>
                    <th className="center">Searchable</th>
                    <th className="center" title="POST / PATCH op add: id fields get a new value; other fields get a value when it is missing (enum: one of the allowed values)">Create (post)</th>
                    <th className="center" title="Required on POST / PATCH op add">Must</th>
                    <th className="center" title="Allowed values">Enum</th>
                    <th className="center" title="Id fields: generate values from a regex · other fields (without enum): copy the value of a parent or sibling field">Regex / Map</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {newTag && (
                    <tr className="new-tag-row">
                      <td>
                        <input
                          autoFocus
                          list={`paths-${api._id}`}
                          placeholder="e.g. characteristic.name or agreementItem.productOfferingPrice.priceType"
                          value={newTag.path}
                          onChange={(e) => {
                            const found = paths.find((x) => x.path === e.target.value);
                            setNewTag({ ...newTag, path: e.target.value, type: found ? found.type : newTag.type });
                          }}
                          onKeyDown={(e) => e.key === 'Enter' && addTag()}
                        />
                        <datalist id={`paths-${api._id}`}>
                          {paths.filter((p) => !tags.some((t) => t.path === p.path)).map((p) => (
                            <option key={p.path} value={p.path}>{p.type}</option>
                          ))}
                        </datalist>
                      </td>
                      <td className="muted">{newTag.path.trim() ? newTag.path.trim().split('.').length : ''}</td>
                      <td>
                        <select value={newTag.type} onChange={(e) => setNewTag({ ...newTag, type: e.target.value })}>
                          {TAG_TYPES.map((t) => <option key={t}>{t}</option>)}
                        </select>
                      </td>
                      <td className="center">
                        <input
                          type="checkbox"
                          title={newTag.path.trim() === 'id' ? 'The record id is always unique' : 'Unique key of the list items'}
                          checked={!!newTag.unique || newTag.path.trim() === 'id'}
                          disabled={newTag.path.trim() === 'id'}
                          onChange={(e) => setNewTag({ ...newTag, unique: e.target.checked })}
                        />
                      </td>
                      <td className="center">
                        <input
                          type="checkbox"
                          checked={newTag.searchable}
                          onChange={(e) => setNewTag({ ...newTag, searchable: e.target.checked })}
                        />
                      </td>
                      <td className="center">
                        <input type="checkbox" checked={!!newTag.create} onChange={(e) => setNewTag({ ...newTag, create: e.target.checked })} />
                      </td>
                      <td className="center">
                        <input type="checkbox" checked={!!newTag.must} onChange={(e) => setNewTag({ ...newTag, must: e.target.checked })} />
                      </td>
                      <td className="center">
                        <EnumCell tag={newTag} onEdit={() => newTag.path.trim() && setEnumEdit('new')} />
                      </td>
                      <td className="center muted">–</td>
                      <td className="nowrap">
                        <button className="btn small primary" onClick={addTag} disabled={!newTag.path.trim()}>Add</button>{' '}
                        <button className="btn small ghost" onClick={() => { setNewTag(null); setTagError(null); }}>Cancel</button>
                      </td>
                    </tr>
                  )}
                  {tags.map((t, i) => (
                    <tr key={t.path}>
                      <td>
                        <code>{t.path}</code>{' '}
                        {t.isNew ? <span className="pill">new</span> : t.autoAdded ? <span className="pill" title="Added automatically by a GET filter">from query</span> : t.custom && <span className="pill">custom</span>}
                      </td>
                      <td>{t.level}</td>
                      <td className="muted">{t.type}</td>
                      <td className="center">
                        <input
                          type="checkbox"
                          title={t.path === 'id' ? 'The record id is always unique' : 'Unique key of the list items'}
                          checked={!!t.unique || t.path === 'id'}
                          disabled={t.path === 'id'}
                          onChange={(e) => setTags(tags.map((x, j) => (j === i ? { ...x, unique: e.target.checked } : x)))}
                        />
                      </td>
                      <td className="center">
                        <input
                          type="checkbox"
                          checked={!!t.searchable}
                          onChange={(e) =>
                            setTags(tags.map((x, j) => (j === i ? { ...x, searchable: e.target.checked } : x)))
                          }
                        />
                      </td>
                      <td className="center">
                        <input
                          type="checkbox"
                          title={isIdPath(t.path) ? 'Generate a new id on POST / PATCH op add' : 'Fill this field when it is missing on POST / PATCH op add'}
                          checked={createOf(t)}
                          onChange={(e) => setTags(tags.map((x, j) => (j === i ? { ...x, create: e.target.checked } : x)))}
                        />
                      </td>
                      <td className="center">
                        <input
                          type="checkbox"
                          title="Required on POST / PATCH op add"
                          checked={!!t.must}
                          onChange={(e) => setTags(tags.map((x, j) => (j === i ? { ...x, must: e.target.checked } : x)))}
                        />
                      </td>
                      <td className="center">
                        <EnumCell tag={t} onEdit={() => setEnumEdit(i)} />
                      </td>
                      <td className="center">
                        {isIdPath(t.path) ? (
                          <RegexIcon tag={t} onOpen={() => setRegexEdit(i)} />
                        ) : t.enum?.length ? (
                          <span className="muted" title="Fields with allowed values (enum) cannot be mapped">–</span>
                        ) : (
                          <MapIcon tag={t} onOpen={() => setMapEdit(i)} />
                        )}
                      </td>
                      <td className="center">
                        {t.custom && (
                          <button className="btn small ghost danger" title="Remove tag" onClick={() => removeTag(t)}>✕</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {tagsDirty && <p className="muted small">Unsaved changes – Save tags validates them against the sample.</p>}
              {enumEdit !== null && (
                <EnumModal
                  apiKey={api._id}
                  tag={enumEdit === 'new' ? { ...newTag, path: newTag.path.trim() } : tags[enumEdit]}
                  onClose={() => setEnumEdit(null)}
                  onSave={(values) => {
                    if (enumEdit === 'new') setNewTag({ ...newTag, enum: values });
                    else setTags(tags.map((x, j) => (j === enumEdit ? { ...x, enum: values.length ? values : undefined, ...(values.length ? { map: undefined } : {}) } : x)));
                  }}
                />
              )}
              {regexEdit !== null && tags[regexEdit] && (
                <RegexModal
                  apiKey={api._id}
                  tag={tags[regexEdit]}
                  onClose={() => setRegexEdit(null)}
                  onSave={(regex) => saveConfig(regexEdit, 'regex', regex)}
                />
              )}
              {mapEdit !== null && tags[mapEdit] && (
                <MapModal
                  apiKey={api._id}
                  tag={tags[mapEdit]}
                  onClose={() => setMapEdit(null)}
                  onSave={(map) => saveConfig(mapEdit, 'map', map)}
                />
              )}
                </>
              )}
            </section>
          )}

          {mocking && (
            <MockModal
              api={api}
              onClose={() => setMocking(false)}
              onCreated={() => onChanged()}
            />
          )}

          <div className="row end">
            <button
              className="btn danger ghost"
              onClick={() => {
                if (window.confirm(`Delete ${api.basePath} and all its records?`)) run(() => admin.remove(api._id), 'Deleted');
              }}
            >
              Delete API
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
