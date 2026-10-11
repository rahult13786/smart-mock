import { useEffect, useState } from 'react';
import { humanize } from '../util/value.js';
import JsonTree from './JsonTree.jsx';

const kindOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const label = (path) => path.map((p) => (typeof p === 'number' ? `[${p}]` : humanize(p))).join(' › ');
const pretty = (v) => JSON.stringify(v, null, 2);

export function RawJsonEditor({ value, onSave, rows = 18 }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const size = pretty(value).length;
  const dirty = editing && text !== pretty(value);

  function startEdit() {
    setText(pretty(value));
    setError('');
    setSaved(false);
    setEditing(true);
  }

  async function save() {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return setError(`Invalid JSON: ${e.message}`);
    }
    if (kindOf(parsed) !== kindOf(value)) {
      return setError(`This node is ${kindOf(value) === 'array' ? 'a list' : `an ${kindOf(value)}`} – the JSON must stay ${kindOf(value) === 'array' ? 'an array [ … ]' : `an ${kindOf(value)}`}`);
    }
    setSaving(true);
    setError('');
    try {
      await onSave(parsed);
      setEditing(false);
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="raw-editor">
      {editing ? (
        <textarea
          className="code"
          rows={rows}
          spellCheck={false}
          autoFocus
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError('');
          }}
        />
      ) : (
        <div className="tree-box" style={{ maxHeight: `${rows * 1.5}em` }}>
          <JsonTree value={value} />
        </div>
      )}
      {error && <div className="alert error">{error}</div>}
      <div className="row gap">
        {editing ? (
          <>
            <button className="btn primary" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save JSON'}</button>
            <button className="btn ghost" disabled={!dirty || saving} onClick={() => { setText(pretty(value)); setError(''); }}>Reset</button>
            <button className="btn ghost" disabled={saving} onClick={() => { setEditing(false); setError(''); }}>Cancel</button>
          </>
        ) : (
          onSave && <button className="btn" onClick={startEdit}>Edit JSON</button>
        )}
        <button className="btn ghost" onClick={() => navigator.clipboard?.writeText(editing ? text : pretty(value))}>Copy to clipboard</button>
        <span className="spacer" />
        {saved && !editing && <span className="ok-text small">Saved</span>}
        <span className="muted small">{(size / 1024).toFixed(1)} KB</span>
      </div>
    </div>
  );
}

export function RawJsonModal({ path, value, onSave, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <div className="modal-head">
          <h3>Raw JSON – {label(path)}</h3>
          <button className="btn ghost" onClick={onClose} title="Close">×</button>
        </div>
        <div className="modal-body">
          <RawJsonEditor value={value} onSave={onSave} rows={24} />
        </div>
      </div>
    </div>
  );
}
