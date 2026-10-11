import { useEffect, useState } from 'react';
import { admin } from '../api.js';

function toValue(text, type) {
  const t = text.trim();
  if (!t) throw new Error('Enter a value');
  if (type === 'number') {
    const n = Number(t);
    if (Number.isNaN(n)) throw new Error(`"${t}" is not a number`);
    return n;
  }
  if (type === 'boolean') {
    if (t !== 'true' && t !== 'false') throw new Error('Use true or false');
    return t === 'true';
  }
  return text;
}

export default function EnumModal({ apiKey, tag, onSave, onClose }) {
  const [values, setValues] = useState(tag.enum || []);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [found, setFound] = useState(null);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function add(v) {
    if (values.some((x) => x === v)) return setError(`${JSON.stringify(v)} is already in the list`);
    setValues([...values, v]);
    setError('');
  }

  function addTyped() {
    try {
      const parts = text.includes('\n') ? text.split('\n') : text.split(',');
      const vals = parts.filter((p) => p.trim()).map((p) => toValue(p.trim(), tag.type));
      const next = [...values];
      for (const v of vals) if (!next.includes(v)) next.push(v);
      setValues(next);
      setText('');
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }

  async function loadFound() {
    try {
      setFound(await admin.values(apiKey, tag.path));
    } catch (e) {
      setError(e.message);
    }
  }

  const missing = (found || []).filter((f) => !values.includes(f.value));

  return (
    <div className="modal-backdrop top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h3>Allowed values – <code>{tag.path}</code> <span className="muted small">({tag.type})</span></h3>
          <button className="btn ghost" onClick={onClose} title="Close">×</button>
        </div>
        <div className="modal-body add-item">
          <p className="muted small">
            When values are defined, the editor only offers these values for this field, and POST / PATCH requests
            with any other value are rejected with an error naming the path. Leave the list empty to allow any value.
          </p>

          <div className="enum-chips">
            {values.length === 0 && <span className="muted small">No values – any value is allowed.</span>}
            {values.map((v) => (
              <span key={JSON.stringify(v)} className="enum-chip">
                {String(v)}
                <button title="Remove" onClick={() => setValues(values.filter((x) => x !== v))}>×</button>
              </span>
            ))}
          </div>

          <div className="row gap">
            <input
              autoFocus
              placeholder={tag.type === 'boolean' ? 'true / false' : 'Value (comma-separate to add several)'}
              value={text}
              onChange={(e) => { setText(e.target.value); setError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && addTyped()}
            />
            <button className="btn" onClick={addTyped} disabled={!text.trim()}>Add</button>
          </div>

          <div>
            {found === null ? (
              <button className="btn small" onClick={loadFound}>Load values used in the data</button>
            ) : (
              <div className="found">
                <div className="row gap">
                  <span className="muted small">{found.length} distinct value{found.length === 1 ? '' : 's'} in the sample / records</span>
                  {missing.length > 0 && (
                    <button className="btn small" onClick={() => setValues([...values, ...missing.map((f) => f.value)])}>Add all</button>
                  )}
                </div>
                <div className="enum-chips">
                  {missing.map((f) => (
                    <button key={JSON.stringify(f.value)} className="chip add" title={`${f.count} use(s)`} onClick={() => add(f.value)}>
                      + {String(f.value)} <span className="muted">×{f.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {error && <div className="alert error">{error}</div>}
        </div>
        <div className="modal-foot">
          {values.length > 0 && <button className="btn ghost danger" onClick={() => setValues([])}>Clear all</button>}
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => { onSave(values); onClose(); }}>Apply</button>
        </div>
      </div>
    </div>
  );
}
