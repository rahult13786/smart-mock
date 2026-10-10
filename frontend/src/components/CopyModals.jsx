import { useEffect, useMemo, useState } from 'react';
import { humanize, isObj } from '../util/value.js';

const ID_KEY = /^id$/i; // "id", "Id", "ID"
const label = (path) => path.map((p) => (typeof p === 'number' ? `[${p}]` : humanize(p))).join(' › ');

/** Replace `from` with `to` in every string value (keys untouched). Returns {value, count}. */
export function replaceInValues(node, from, to) {
  let count = 0;
  const walk = (v) => {
    if (typeof v === 'string') {
      if (!v.includes(from)) return v;
      count += v.split(from).length - 1;
      return v.split(from).join(to);
    }
    if (Array.isArray(v)) return v.map(walk);
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const value = walk(node);
  return { value, count };
}

function Modal({ title, children, footer, onClose, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn ghost" onClick={onClose} title="Close">×</button>
        </div>
        <div className="modal-body add-item">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Copy a whole record (list page / details page) and save it as a new record.
 * The user must give a new id; optionally the old id is replaced everywhere it appears in values.
 */
export function CopyRecordModal({ client, sourceId, onClose, onCopied }) {
  const [source, setSource] = useState(null);
  const [newId, setNewId] = useState(`${sourceId}-copy`);
  const [replaceAll, setReplaceAll] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    client.get(sourceId).then(setSource).catch((e) => setError(e.message));
  }, [client, sourceId]);

  // occurrences of the old id inside the record, other than the root "id" itself
  const occurrences = useMemo(() => {
    if (!source) return 0;
    const { id: _ignored, ...rest } = source;
    return replaceInValues(rest, String(sourceId), '\u0000').count;
  }, [source, sourceId]);

  async function save() {
    const id = newId.trim();
    if (!id) return setError('Enter the new id');
    if (id === String(sourceId)) return setError('The new id must be different from the original');
    setSaving(true);
    setError('');
    try {
      let copy = replaceAll ? replaceInValues(source, String(sourceId), id).value : structuredClone(source);
      copy = { ...copy, id: typeof source.id === 'number' && !Number.isNaN(Number(id)) ? Number(id) : id };
      const rec = await client.create(copy);
      onCopied(rec);
    } catch (e) {
      setError(e.status === 409 ? `A record with id "${id}" already exists – choose another id` : e.message);
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Copy record ${sourceId}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!source || saving} onClick={save}>{saving ? 'Saving…' : 'Save copy'}</button>
        </>
      }
    >
      {!source && !error && <p className="muted">Loading record…</p>}
      {source && (
        <>
          <p className="muted small">
            The whole structure is copied and saved as a new record. Update the id before saving.
          </p>
          <label>
            New id *
            <input autoFocus value={newId} onChange={(e) => { setNewId(e.target.value); setError(''); }} onKeyDown={(e) => e.key === 'Enter' && save()} />
          </label>
          {occurrences > 0 && (
            <label className="check">
              <input type="checkbox" checked={replaceAll} onChange={(e) => setReplaceAll(e.target.checked)} />
              Also replace "{sourceId}" in the {occurrences} other place{occurrences === 1 ? '' : 's'} it appears inside the record
              (e.g. stcAgreementBusinessId, item ids)
            </label>
          )}
        </>
      )}
      {error && <div className="alert error">{error}</div>}
    </Modal>
  );
}

/**
 * Copy one item of a list. If the item has an "id"/"Id" key at its own root level, the user must
 * give a new value for it (unique among its siblings). The copy is inserted right after the original.
 */
export function CopyItemModal({ path, item, siblings, onClose, onSave }) {
  const idKeys = isObj(item) ? Object.keys(item).filter((k) => ID_KEY.test(k)) : [];
  const [values, setValues] = useState(() =>
    Object.fromEntries(idKeys.map((k) => [k, item[k] == null ? '' : `${item[k]}-copy`]))
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    const copy = structuredClone(item);
    for (const k of idKeys) {
      const v = String(values[k] ?? '').trim();
      if (!v) return setError(`Enter a new value for "${k}"`);
      if (siblings.some((s) => isObj(s) && String(s[k]) === v)) {
        return setError(`"${k}" = "${v}" is already used in this list – choose another value`);
      }
      copy[k] = typeof item[k] === 'number' && !Number.isNaN(Number(v)) ? Number(v) : v;
    }
    setSaving(true);
    try {
      await onSave(copy);
      onClose();
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Copy ${label(path)}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save copy'}</button>
        </>
      }
    >
      {idKeys.length > 0 ? (
        <>
          <p className="muted small">
            The item is copied with everything inside it. Update its id (only the root level of this item is changed);
            the copy is added right after the original.
          </p>
          {idKeys.map((k, i) => (
            <label key={k}>
              New {k} * <span className="muted">was "{String(item[k])}"</span>
              <input
                autoFocus={i === 0}
                value={values[k]}
                onChange={(e) => { setValues({ ...values, [k]: e.target.value }); setError(''); }}
                onKeyDown={(e) => e.key === 'Enter' && save()}
              />
            </label>
          ))}
        </>
      ) : (
        <p className="muted">This item has no id field. An exact copy will be added right after the original.</p>
      )}
      <details>
        <summary className="muted small">Item being copied</summary>
        <pre className="raw small-pre">{JSON.stringify(item, null, 2)}</pre>
      </details>
      {error && <div className="alert error">{error}</div>}
    </Modal>
  );
}
