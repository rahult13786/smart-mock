import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { admin, data } from '../api.js';

const ALL = '*'; // filter choice: all items of the list

const splitValues = (text) =>
  String(text || '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '');

const show = (v) => (v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v));

/**
 * "Create mocks": copy a template record N (≤ 10) times. Ids are replaced (typed values, or generated
 * like the sample, optionally everywhere they appear) and any other field can be set or generated,
 * optionally only in list items matching a filter. Runs completely offline.
 */
export default function MockModal({ api, onClose, onCreated }) {
  const [sources, setSources] = useState([{ value: 'sample:0', label: 'Sample record 0' }]);
  const [source, setSource] = useState('sample:0');
  const [count, setCount] = useState(3);
  const [plan, setPlan] = useState(null);
  const [idRules, setIdRules] = useState([]);
  const [fieldRules, setFieldRules] = useState([]);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null); // warnings shown before saving
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // template choices: the sample records and stored records
  useEffect(() => {
    (async () => {
      const list = [];
      try {
        const s = await admin.sample(api._id);
        (Array.isArray(s) ? s : [s]).forEach((r, i) => list.push({ value: `sample:${i}`, label: `Sample record ${i}${r?.id ? ` – ${r.id}` : ''}` }));
      } catch {
        /* no sample */
      }
      try {
        const r = await data(api.basePath).summary({ limit: 50 });
        r.items.forEach((it) => list.push({ value: `record:${it.id}`, label: `Stored record – ${it.id}` }));
      } catch {
        /* ignore */
      }
      if (list.length) setSources(list);
    })();
  }, [api._id, api.basePath]);

  useEffect(() => {
    setPlan(null);
    setError('');
    admin
      .mockPlan(api._id, source)
      .then((p) => {
        setPlan(p);
        setIdRules(p.idPaths.map((x) => ({ ...x, text: '', auto: true, reuse: false, replaceAll: x.root })));
        setFieldRules([]);
      })
      .catch((e) => setError(e.message));
  }, [api._id, source]);

  const fieldsByPath = useMemo(() => new Map((plan?.fields || []).map((f) => [f.path, f])), [plan]);
  const n = Math.max(1, Math.min(plan?.max || 10, Number(count) || 1));

  const updId = (i, patch) => { setIdRules(idRules.map((r, j) => (j === i ? { ...r, ...patch } : r))); setConfirm(null); };
  const updField = (i, patch) => { setFieldRules(fieldRules.map((r, j) => (j === i ? { ...r, ...patch } : r))); setConfirm(null); };

  function check() {
    const errors = [];
    const warnings = [];
    if (!(Number(count) >= 1 && Number(count) <= (plan?.max || 10))) errors.push(`Number of mocks must be between 1 and ${plan?.max || 10}`);
    for (const r of idRules) {
      if (r.reuse) continue; // value kept as is
      const vals = splitValues(r.text);
      if (r.root && !vals.length && !r.auto) errors.push('The record id must change – enter ids or tick auto-generate');
      if (vals.length && vals.length < n) warnings.push(`${r.path}: ${vals.length} value${vals.length === 1 ? '' : 's'} for ${n} mocks – ${n - vals.length} will be randomly generated`);
      if (vals.length > n) warnings.push(`${r.path}: ${vals.length - n} extra value(s) will be ignored`);
      if (r.root && new Set(vals).size !== vals.length) errors.push('Record ids must be different');
    }
    for (const r of fieldRules) {
      if (!r.path) { errors.push('Choose a field for every added row (or remove it)'); continue; }
      const f = fieldsByPath.get(r.path);
      if (!f) { errors.push(`"${r.path}" is not a field of the template`); continue; }
      if (f.listPath && !r.filterKey) { errors.push(`${r.path}: choose a filter first (or "All items")`); continue; }
      if (r.reuse) continue; // value kept as is
      const vals = splitValues(r.text);
      if (!vals.length && !r.auto) errors.push(`${r.path}: enter values or tick auto-generate`);
      if (f.enum && vals.some((v) => !f.enum.map(String).includes(v))) {
        errors.push(`${r.path}: only allowed values can be used (${f.enum.join(', ')})`);
      }
      if (vals.length && vals.length < n) warnings.push(`${r.path}: ${vals.length} value${vals.length === 1 ? '' : 's'} for ${n} mocks – ${n - vals.length} will be randomly generated`);
      if (vals.length > n) warnings.push(`${r.path}: ${vals.length - n} extra value(s) will be ignored`);
      if (r.filterKey && r.filterKey !== ALL && r.filterValue === '') errors.push(`${r.path}: choose the filter value`);
    }
    return { errors, warnings };
  }

  async function save() {
    const { errors, warnings } = check();
    if (errors.length) return setError(errors.join(' · '));
    setError('');
    if (warnings.length && !confirm) return setConfirm(warnings); // show once, the next click saves
    setSaving(true);
    try {
      const r = await admin.createMocks(api._id, {
        source,
        count: n,
        idRules: idRules.map((x) => ({ path: x.path, values: x.reuse ? [] : splitValues(x.text), auto: !x.reuse && x.auto, reuse: x.reuse, replaceAll: !x.reuse && x.replaceAll })),
        fieldRules: fieldRules.map((x) => ({
          path: x.path,
          values: x.reuse ? [] : splitValues(x.text),
          auto: !x.reuse && x.auto,
          reuse: x.reuse,
          ...(x.filterKey && x.filterKey !== ALL ? { filter: { key: x.filterKey, value: x.filterValue } } : {}),
        })),
      });
      setResult(r);
      onCreated?.(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide mock-modal">
        <div className="modal-head">
          <h3>Create mocks – {api.name} <span className="badge">{api.version}</span></h3>
          <button className="btn ghost" onClick={onClose} title="Close">×</button>
        </div>

        {result ? (
          <>
            <div className="modal-body add-item">
              <div className="alert ok">
                {result.created.length} mock record{result.created.length === 1 ? '' : 's'} saved to <code>{api.basePath}</code>.
              </div>
              {result.warnings?.length > 0 && <div className="alert warn">{result.warnings.join(' · ')}</div>}
              <ul className="created">
                {result.created.map((c) => (
                  <li key={c.id}>
                    <Link to={`/browse/${api._id}/records/${encodeURIComponent(c.id)}`}>{String(c.id)}</Link>
                    {c.name ? <span className="muted"> – {String(c.name)}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
            <div className="modal-foot">
              <Link className="btn" to={`/browse/${api._id}`}>Open record list</Link>
              <button className="btn primary" onClick={onClose}>Close</button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-body add-item">
              <div className="mock-top">
                <label>
                  Template record
                  <select value={source} onChange={(e) => setSource(e.target.value)}>
                    {sources.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </label>
                <label className="num">
                  Number of mocks (max {plan?.max || 10})
                  <input
                    type="number"
                    min={1}
                    max={plan?.max || 10}
                    value={count}
                    onChange={(e) => { setCount(e.target.value); setConfirm(null); }}
                  />
                </label>
              </div>
              <p className="muted small">
                New values: comma-separated, one per mock in order (e.g. <code>A-1, A-2, A-3</code>). Missing values are generated
                like the sample (same shape: digits, dates, words; enum fields pick an allowed value).
              </p>

              {!plan && !error && <p className="muted">Reading the template…</p>}

              {plan && (
                <>
                  <h4>Id fields</h4>
                  <div className="table-wrap">
                    <table className="grid mock-table">
                      <thead>
                        <tr>
                          <th>Tag path</th>
                          <th>Current value</th>
                          <th>New values</th>
                          <th className="center" title="Keep the value of the template as is">Reuse</th>
                          <th className="center">Auto-generate</th>
                          <th className="center" title="Also replace the old value wherever it appears in the payload">Replace all</th>
                        </tr>
                      </thead>
                      <tbody>
                        {idRules.map((r, i) => (
                          <tr key={r.path}>
                            <td><code>{r.path}</code>{r.root && <span className="pill">record id</span>}</td>
                            <td className="cur">
                              <span title={r.sample.map(show).join(', ')}>{show(r.sample[0])}</span>
                              {r.count > 1 && <span className="muted small"> ({r.count} in payload{r.distinct > 1 ? `, ${r.distinct} different` : ''})</span>}
                            </td>
                            <td>
                              <input
                                placeholder={r.reuse ? 'reused from template' : r.root ? `${n} id(s), comma-separated` : 'comma-separated (optional)'}
                                value={r.reuse ? '' : r.text}
                                disabled={r.reuse}
                                onChange={(e) => updId(i, { text: e.target.value })}
                              />
                            </td>
                            <td className="center">
                              <input
                                type="checkbox"
                                title={r.root ? 'Every mock needs its own record id' : 'Keep the template value as is'}
                                checked={r.reuse}
                                disabled={r.root}
                                onChange={(e) => updId(i, e.target.checked ? { reuse: true, auto: false, replaceAll: false } : { reuse: false, auto: true })}
                              />
                            </td>
                            <td className="center">
                              <input type="checkbox" checked={!r.reuse && r.auto} disabled={r.reuse} onChange={(e) => updId(i, { auto: e.target.checked })} />
                            </td>
                            <td className="center">
                              <input type="checkbox" checked={!r.reuse && r.replaceAll} disabled={r.reuse} onChange={(e) => updId(i, { replaceAll: e.target.checked })} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {idRules.some((r) => r.distinct > 1) && (
                    <p className="muted small">
                      Where a path has several different ids, a typed value goes to the first one and the others get the value +
                      "-1", "-2"…; unticked rows without values keep their ids.
                    </p>
                  )}

                  <div className="section-head">
                    <h4>Other fields</h4>
                    <span className="spacer" />
                    <button className="btn small" onClick={() => setFieldRules([...fieldRules, { path: '', text: '', auto: true, reuse: false, filterKey: '', filterValue: '' }])}>
                      + Add field
                    </button>
                  </div>
                  {fieldRules.length === 0 ? (
                    <p className="muted small">Add the fields that should differ between the mocks (e.g. status, name, characteristic.value).</p>
                  ) : (
                    <div className="table-wrap">
                      <table className="grid mock-table">
                        <thead>
                          <tr>
                            <th>Tag path</th>
                            <th title="List fields: choose which list items to change first">Filter (list items)</th>
                            <th>Current value</th>
                            <th>New values</th>
                            <th className="center" title="Keep the value of the template as is">Reuse</th>
                            <th className="center">Auto-generate</th>
                            <th className="center">Replace all</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {fieldRules.map((r, i) => (
                            <FieldRow
                              key={i}
                              rule={r}
                              field={fieldsByPath.get(r.path)}
                              apiKey={api._id}
                              source={source}
                              onChange={(patch) => updField(i, patch)}
                              onRemove={() => setFieldRules(fieldRules.filter((_, j) => j !== i))}
                              index={i}
                            />
                          ))}
                        </tbody>
                      </table>
                      <datalist id="mock-field-paths">
                        {(plan.fields || []).map((f) => <option key={f.path} value={f.path}>{f.type}</option>)}
                      </datalist>
                    </div>
                  )}
                </>
              )}

              {confirm && (
                <div className="alert warn">
                  {confirm.map((w) => <div key={w}>{w}</div>)}
                  <div><b>Click Create again to continue.</b></div>
                </div>
              )}
              {error && <div className="alert error">{error}</div>}
            </div>
            <div className="modal-foot">
              <span className="muted small">Saved to {api.basePath} – visible in the record list.</span>
              <span className="spacer" />
              <button className="btn ghost" onClick={onClose}>Cancel</button>
              <button className="btn primary" disabled={!plan || saving} onClick={save}>
                {saving ? 'Creating…' : `Create ${n} mock${n === 1 ? '' : 's'}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * One "Other fields" row. For a field inside a list the filter comes first: the user picks which
 * list items to change (or "All items"), then the current value of those items is shown.
 */
function FieldRow({ rule: r, field: f, apiKey, source, onChange, onRemove, index }) {
  const [current, setCurrent] = useState(null); // {count, values}
  const needsFilter = !!f?.listPath;
  const filterReady = !needsFilter || r.filterKey === ALL || (r.filterKey && r.filterValue !== '');
  const fk = f?.filterKeys?.find((k) => k.key === r.filterKey);

  useEffect(() => {
    setCurrent(null);
    if (!f || !filterReady) return;
    const qs = new URLSearchParams({ source, path: r.path });
    if (r.filterKey && r.filterKey !== ALL) {
      qs.set('filterKey', r.filterKey);
      qs.set('filterValue', r.filterValue);
    }
    let cancelled = false;
    fetch(`/admin/apis/${encodeURIComponent(apiKey)}/mocks/current?${qs}`)
      .then((res) => res.json())
      .then((c) => !cancelled && setCurrent(c))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [f, filterReady, r.path, r.filterKey, r.filterValue, apiKey, source]);

  const locked = !filterReady; // list field without a filter yet

  return (
    <tr>
      <td>
        <input
          list="mock-field-paths"
          placeholder="field path"
          value={r.path}
          onChange={(e) => onChange({ path: e.target.value, filterKey: '', filterValue: '' })}
        />
        {f?.listPath && <div className="muted small">in list <code>{f.listPath}</code></div>}
      </td>
      <td>
        {!f ? (
          <span className="muted">—</span>
        ) : needsFilter ? (
          <div className="filter-cell">
            <select
              className={!r.filterKey ? 'needs' : ''}
              value={r.filterKey}
              onChange={(e) => onChange({ filterKey: e.target.value, filterValue: '' })}
            >
              <option value="">— choose filter —</option>
              <option value={ALL}>All items</option>
              {(f.filterKeys || []).map((k) => <option key={k.key} value={k.key}>{k.key} =</option>)}
            </select>
            {r.filterKey && r.filterKey !== ALL && (
              <select className={r.filterValue === '' ? 'needs' : ''} value={r.filterValue} onChange={(e) => onChange({ filterValue: e.target.value })}>
                <option value="">choose…</option>
                {(fk?.values || []).map((v) => <option key={String(v)} value={String(v)}>{String(v)}</option>)}
              </select>
            )}
          </div>
        ) : (
          <span className="muted small">not in a list</span>
        )}
      </td>
      <td className="cur">
        {!f ? (
          <span className="muted">—</span>
        ) : locked ? (
          <span className="muted small">choose a filter first</span>
        ) : !current ? (
          <span className="muted small">…</span>
        ) : current.count === 0 ? (
          <span className="muted small">no matching items</span>
        ) : (
          <>
            <span title={current.values.map(show).join(', ')}>{show(current.values[0])}</span>
            {current.count > 1 && <span className="muted small"> ({current.count} items{current.values.length > 1 ? `, ${current.values.length}+ values` : ''})</span>}
            {f.enum && <div className="muted small">enum: {f.enum.join(', ')}</div>}
          </>
        )}
      </td>
      <td>
        <input
          list={f?.enum ? `mock-enum-${index}` : undefined}
          placeholder={r.reuse ? 'reused from template' : f?.enum ? 'allowed values, comma-separated' : 'comma-separated'}
          value={r.reuse ? '' : r.text}
          disabled={locked || r.reuse}
          onChange={(e) => onChange({ text: e.target.value })}
        />
        {f?.enum && (
          <datalist id={`mock-enum-${index}`}>
            {f.enum.map((v) => <option key={String(v)} value={String(v)} />)}
          </datalist>
        )}
      </td>
      <td className="center">
        <input
          type="checkbox"
          title="Keep the template value as is"
          checked={r.reuse}
          disabled={locked}
          onChange={(e) => onChange(e.target.checked ? { reuse: true, auto: false } : { reuse: false, auto: true })}
        />
      </td>
      <td className="center">
        <input type="checkbox" checked={!r.reuse && r.auto} disabled={locked || r.reuse} onChange={(e) => onChange({ auto: e.target.checked })} />
      </td>
      <td className="center muted small">n/a</td>
      <td>
        <button className="btn small ghost danger" title="Remove" onClick={onRemove}>✕</button>
      </td>
    </tr>
  );
}
