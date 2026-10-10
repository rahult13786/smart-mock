import { useEffect, useState } from 'react';

/** Small confirmation dialog for destructive actions. `onConfirm` may be async; errors are shown. */
export default function ConfirmModal({ title, message, confirmLabel = 'Delete', onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  async function go() {
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop top confirm" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal small">
        <div className="modal-head">
          <h3>{title}</h3>
        </div>
        <div className="modal-body">
          <div className="confirm-msg">{message}</div>
          {error && <div className="alert error">{error}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="btn danger-solid" autoFocus disabled={busy} onClick={go}>{busy ? 'Deleting…' : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
