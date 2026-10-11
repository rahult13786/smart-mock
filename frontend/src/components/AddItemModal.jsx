import { useMemo, useState } from 'react';
import { humanize, listShape, validateNewItems } from '../util/value.js';
import { useEditor } from './editor.js';

const label = (path) => path.map((p) => (typeof p === 'number' ? `[${p}]` : humanize(p))).join(' › ');

function parseField(text, field) {
  const t = text.trim();
  if (t === '') return undefined;
  if (field.kind !== 'scalar') return JSON.parse(t);
  if (field.types.length === 1 && field.types[0] === 'number') {
    const n = Number(t);
    if (Number.isNaN(n)) throw new Error(`"${field.key}" must be a number`);
    return n;
  }
  if (field.types.length === 1 && field.types[0] === 'boolean') return t === 'true';
  return text;
}

export default function AddItemModal({ path, rows, onClose, onSave }) {
  const shape = useMemo(() => listShape(rows), [rows]);
  const { enumFor } = useEditor();
  const enumOf = (key) => enumFor?.([...path, 0, key]);
  const [mode, setMode] = useState(shape.kind === 'empty' ? 'json' : 'form');
  const [values, setValues] = useState(() =>
    Object.fromEntries(shape.fields.map((f) => [f.key, f.constant !== undefined ? String(f.constant) : '']))
  );
  const [extra, setExtra] = useState([]);
  const [scalar, setScalar] = useState('');
  const [json, setJson] = useState(() => {
    if (shape.kind === 'scalar') return '""';
    if (shape.kind === 'empty') return '{\n  \n}';
    const tpl = Object.fromEntries(shape.fields.map((f) => [f.key, f.constant ?? (f.kind === 'array' ? [] : f.kind === 'object' ? {} : '')]));
    return JSON.stringify(tpl, null, 2);
  });
  const [problems, setProblems] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmWarnings, setConfirmWarnings] = useState(false);

  function buildItems() {
    if (mode === 'json') {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) && shape.kind !== 'scalar' ? parsed : [parsed];
    }
    if (shape.kind === 'scalar') {
      const t = shape.types.length === 1 ? shape.types[0] : 'string';
      if (t === 'number') {
        const n = Number(scalar);
        if (scalar.trim() === '' || Number.isNaN(n)) throw new Error('Enter a number');
        return [n];
      }
      if (t === 'boolean') return [scalar === 'true'];
      return [scalar];
    }
    const item = {};
    for (const f of shape.fields) {
      const v = parseField(values[f.key] ?? '', f);
      if (v !== undefined) item[f.key] = v;
    }
    for (const { key, value } of extra) {
      const k = key.trim();
      if (!k) continue;
      if (k in item) throw new Error(`"${k}" is already a field`);
      if (value.trim() === '') continue;
      try {
        item[k] = /^[[{]/.test(value.trim()) ? JSON.parse(value) : value;
      } catch {
        item[k] = value;
      }
    }
    return [item];
  }

  async function save() {
    let items;
    try {
      items = buildItems();
    } catch (e) {
      setProblems({ errors: [e.message.startsWith('Unexpected') || e.name === 'SyntaxError' ? `Invalid JSON: ${e.message}` : e.message], warnings: [], newKeys: [] });
      return;
    }
    if (!items.length) {
      setProblems({ errors: ['Nothing to add'], warnings: [], newKeys: [] });
      return;
    }
    const result = validateNewItems(items, rows);
    setProblems(result);
    if (result.errors.length) return;
    if ((result.warnings.length || result.newKeys.length) && !confirmWarnings) {
      setConfirmWarnings(true);
      return;
    }
    setSaving(true);
    try {
      await onSave(items);
      onClose();
    } catch (e) {
      setProblems({ errors: [e.message], warnings: [], newKeys: [] });
      setSaving(false);
    }
  }

  const touch = () => {
    setProblems(null);
    setConfirmWarnings(false);
  };

  return (
    <div className="modal-backdrop top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h3>Add to {label(path)}</h3>
          <button className="btn ghost" onClick={onClose} title="Close">×</button>
        </div>
        <div className="modal-body add-item">
          <div className="seg">
            <button className={mode === 'form' ? 'on' : ''} disabled={shape.kind === 'empty'} onClick={() => { setMode('form'); touch(); }}>
              Form
            </button>
            <button className={mode === 'json' ? 'on' : ''} onClick={() => { setMode('json'); touch(); }}>
              Paste JSON
            </button>
          </div>

          {shape.kind === 'object' && (
            <p className="muted small">
              {shape.common.length ? (
                <>Required: at least one of {shape.common.map((k) => <code key={k}>{k}</code>).reduce((a, b) => [a, ' or ', b])}.</>
              ) : (
                <>Required: at least one field the list already uses.</>
              )}{' '}
              New fields are allowed and become new columns.
            </p>
          )}
          {shape.kind === 'empty' && <p className="muted small">The list is empty – paste the first item as JSON.</p>}

          {mode === 'form' && shape.kind === 'scalar' && (
            <label>
              Value ({shape.types.join(' / ')})
              <input autoFocus value={scalar} onChange={(e) => { setScalar(e.target.value); touch(); }} />
            </label>
          )}

          {mode === 'form' && shape.kind === 'object' && (
            <div className="form-fields">
              {shape.fields.map((f, i) => (
                <label key={f.key}>
                  <span>
                    {f.key} {f.common && <span className="req" title="Common field">*</span>}{' '}
                    <span className="muted">{f.kind === 'scalar' ? f.types.join(' / ') || 'value' : `${f.kind} – JSON`}</span>
                  </span>
                  {f.kind === 'scalar' && enumOf(f.key)?.length ? (
                    <select value={values[f.key]} onChange={(e) => { setValues({ ...values, [f.key]: e.target.value }); touch(); }}>
                      <option value="">(not set)</option>
                      {enumOf(f.key).map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
                    </select>
                  ) : f.kind === 'scalar' && f.types.length === 1 && f.types[0] === 'boolean' ? (
                    <select value={values[f.key]} onChange={(e) => { setValues({ ...values, [f.key]: e.target.value }); touch(); }}>
                      <option value="">(not set)</option>
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : f.kind === 'scalar' ? (
                    <input
                      autoFocus={i === 0}
                      inputMode={f.types[0] === 'number' ? 'decimal' : undefined}
                      value={values[f.key]}
                      onChange={(e) => { setValues({ ...values, [f.key]: e.target.value }); touch(); }}
                    />
                  ) : (
                    <textarea
                      className="code"
                      rows={3}
                      placeholder={f.kind === 'array' ? '[ ]  (optional)' : '{ }  (optional)'}
                      value={values[f.key]}
                      onChange={(e) => { setValues({ ...values, [f.key]: e.target.value }); touch(); }}
                    />
                  )}
                </label>
              ))}
              {extra.map((x, i) => (
                <div key={i} className="extra-field">
                  <input placeholder="new field name" value={x.key} onChange={(e) => { setExtra(extra.map((y, j) => (j === i ? { ...y, key: e.target.value } : y))); touch(); }} />
                  <input placeholder="value" value={x.value} onChange={(e) => { setExtra(extra.map((y, j) => (j === i ? { ...y, value: e.target.value } : y))); touch(); }} />
                  <button className="btn small ghost danger" onClick={() => setExtra(extra.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
              <button className="btn small" onClick={() => setExtra([...extra, { key: '', value: '' }])}>+ Add field</button>
            </div>
          )}

          {mode === 'json' && (
            <>
              <textarea className="code" rows={12} value={json} spellCheck={false} onChange={(e) => { setJson(e.target.value); touch(); }} />
              {shape.kind !== 'scalar' && <p className="muted small">Paste one object, or an array of objects to add several.</p>}
            </>
          )}

          {problems?.errors.length > 0 && (
            <div className="alert error">{problems.errors.map((e) => <div key={e}>{e}</div>)}</div>
          )}
          {problems && !problems.errors.length && (problems.warnings.length > 0 || problems.newKeys.length > 0) && (
            <div className="alert warn">
              {problems.newKeys.length > 0 && (
                <div>New field{problems.newKeys.length > 1 ? 's' : ''} {problems.newKeys.map((k) => `"${k}"`).join(', ')} will be added to the structure.</div>
              )}
              {problems.warnings.map((w) => <div key={w}>{w}</div>)}
              <div><b>Click Save again to confirm.</b></div>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : confirmWarnings ? 'Confirm & save' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
