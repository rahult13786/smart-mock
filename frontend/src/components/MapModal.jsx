import { useEffect, useMemo, useState } from 'react';
import { admin } from '../api.js';

export function MapIcon({ tag, onOpen }) {
  const on = !!tag.map?.enabled;
  return (
    <button
      type="button"
      className={`regex-icon ${on ? 'on' : ''}`}
      title={on ? `Mapped from ${tag.map.source}` : 'No map – click to configure'}
      onClick={onOpen}
    >
      {on ? '[✓]' : '[x]'}
    </button>
  );
}

export default function MapModal({ apiKey, tag, onSave, onClose }) {
  const saved = tag.map || {};
  const [candidates, setCandidates] = useState(null);
  const [source, setSource] = useState(saved.source || '');
  const [enabled, setEnabled] = useState(!!saved.enabled);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    admin
      .mapCandidates(apiKey, tag.path)
      .then((r) => setCandidates(r.candidates))
      .catch((e) => setError(e.message));
  }, [apiKey, tag.path]);

  const shown = useMemo(
    () => (candidates || []).filter((c) => !filter || c.path.toLowerCase().includes(filter.toLowerCase())),
    [candidates, filter]
  );

  async function save() {
    if (enabled && !source) return setError('Choose the field to map from');
    setBusy(true);
    try {
      await onSave({ enabled, source });
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <div className="modal-head">
          <h3>Map – <code>{tag.path}</code></h3>
          <button className="btn ghost" onClick={onClose} title="Close">×</button>
        </div>
        <div className="modal-body add-item map-modal">
          <p className="muted small">
            When enabled, POST and PATCH <code>op: add</code> of a new resource or list item set this field to the value
            of the chosen field, after ids, regex and enum values are filled. Only sibling fields and fields of parent
            nodes can be chosen.
          </p>
          <input placeholder="Filter paths…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="map-list">
            {!candidates && !error && <p className="muted">Reading the sample…</p>}
            {candidates && shown.length === 0 && <p className="muted">No matching paths.</p>}
            {shown.map((c) => (
              <label key={c.path} className={`map-option ${source === c.path ? 'on' : ''}`}>
                <input type="radio" name="map-source" checked={source === c.path} onChange={() => { setSource(c.path); setError(''); }} />
                <code>{c.path}</code>
                <span className={`pill ${c.relation === 'sibling' ? 'on' : ''}`}>{c.relation}</span>
                <span className="muted small map-sample">{c.sample === undefined ? '' : String(c.sample)}</span>
              </label>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> enable
          </label>
          {error && <div className="alert error">{error}</div>}
        </div>
        <div className="modal-foot">
          {source && <span className="muted small">{tag.path} ← {source}</span>}
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !candidates} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
