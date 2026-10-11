import { useEffect, useState } from 'react';
import { admin } from '../api.js';

export function RegexIcon({ tag, onOpen }) {
  const on = !!tag.regex?.enabled;
  return (
    <button
      type="button"
      className={`regex-icon ${on ? 'on' : ''}`}
      title={on ? `Regex enabled: ${tag.regex.override ? tag.regex.pattern : tag.regex.built}` : 'Regex not enabled – click to configure'}
      onClick={onOpen}
    >
      {on ? '[✓]' : '[x]'}
    </button>
  );
}

export default function RegexModal({ apiKey, tag, onSave, onClose }) {
  const saved = tag.regex || {};
  const [built, setBuilt] = useState('');
  const [info, setInfo] = useState(null);
  const [enabled, setEnabled] = useState(!!saved.enabled);
  const [override, setOverride] = useState(!!saved.override);
  const [pattern, setPattern] = useState(saved.pattern || '');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    admin
      .regex(apiKey, tag.path)
      .then((r) => {
        setBuilt(r.built);
        setInfo(r);
      })
      .catch((e) => setError(e.message));
  }, [apiKey, tag.path]);

  const active = override ? pattern : built;

  useEffect(() => {
    if (!active) return setPreview(null);
    const t = setTimeout(() => {
      admin
        .regex(apiKey, tag.path, active)
        .then((r) => {
          setPreview(r.examples);
          setError('');
        })
        .catch((e) => {
          setPreview(null);
          setError(e.message);
        });
    }, 300);
    return () => clearTimeout(t);
  }, [apiKey, tag.path, active]);

  async function apply() {
    if (enabled && !active.trim()) return setError(override ? 'Enter the regex to override with' : 'No regex could be built from the sample – use override');
    setBusy(true);
    try {
      await onSave({ enabled, override, built, pattern: override ? pattern : saved.pattern || '' });
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h3>Regex – <code>{tag.path}</code></h3>
          <button className="btn ghost" onClick={onClose} title="Close">×</button>
        </div>
        <div className="modal-body add-item regex-modal">
          <p className="muted small">
            When enabled, new values of this id are generated from the regex on POST and on PATCH <code>op: add</code> of a
            new resource or list item. Copies made in the portal keep their values.
          </p>
          <label>
            Build regex
            <input className="code readonly" readOnly value={info ? built || '(no values in the sample)' : 'Reading the sample…'} />
            {info && <span className="muted small">Built from {info.values} value{info.values === 1 ? '' : 's'} of the sample</span>}
          </label>
          <label className="check">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> enable
          </label>
          <label className="check">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> override
          </label>
          {override && (
            <label>
              Regex
              <input className="code" autoFocus placeholder="e.g. ORD-[0-9]{6}" value={pattern} onChange={(e) => setPattern(e.target.value)} />
            </label>
          )}
          {preview && preview.length > 0 && (
            <div className="muted small">
              Examples: {preview.map((v) => <code key={String(v)} className="example">{String(v)}</code>)}
            </div>
          )}
          {error && <div className="alert error">{error}</div>}
        </div>
        <div className="modal-foot">
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !info} onClick={apply}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
