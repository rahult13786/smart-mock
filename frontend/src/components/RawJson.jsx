import { useEffect, useRef, useState } from 'react';
import { humanize } from '../util/value.js';

const kindOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const label = (path) => path.map((p) => (typeof p === 'number' ? `[${p}]` : humanize(p))).join(' › ');

/**
 * Raw JSON of one node (a list, or one item). Editable; Save writes it back to the stored record.
 * The node must keep its kind (a list stays a list, an object stays an object).
 */
export function RawJsonEditor({ value, onSave, rows = 18 }) {
  const pretty = (v) => JSON.stringify(v, null, 2);
  const [text, setText] = useState(() => pretty(value));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirtyRef = useRef(false);

  // follow outside changes (e.g. after a save) while the user has not typed anything
  useEffect(() => {
    if (!dirtyRef.current) setText(pretty(value));
  }, [value]);

  const dirty = text !== pretty(value);
  dirtyRef.current = dirty;

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
      dirtyRef.current = false;
      setText(pretty(parsed));
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="raw-editor">
      <textarea
        className="code"
        rows={rows}
        spellCheck={false}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError('');
          setSaved(false);
        }}
      />
      {error && <div className="alert error">{error}</div>}
      <div className="row gap">
        <button className="btn primary" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save JSON'}</button>
        <button className="btn ghost" disabled={!dirty || saving} onClick={() => { setText(pretty(value)); setError(''); }}>Reset</button>
        <button className="btn ghost" onClick={() => navigator.clipboard?.writeText(text)}>Copy to clipboard</button>
        <span className="spacer" />
        {saved && !dirty && <span className="ok-text small">Saved</span>}
        <span className="muted small">{(text.length / 1024).toFixed(1)} KB</span>
      </div>
    </div>
  );
}

/** "Raw JSON" button on a list heading opens this. */
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
