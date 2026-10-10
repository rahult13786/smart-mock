import { useEffect, useState } from 'react';
import { RawJsonEditor } from './RawJson.jsx';
import { getIn, humanize, isObj, toPointer } from '../util/value.js';
import ArrayTable, { Cell } from './ArrayTable.jsx';
import { useEditor } from './editor.js';

const labelOf = (seg) => (typeof seg === 'number' ? `[${seg}]` : humanize(seg));

/**
 * Popup that shows the object (or list) at the top of `stack` as a key/value list.
 * Nested objects / lists are links that push another level, with a breadcrumb to go back.
 */
export default function ObjectModal({ stack, onNavigate, onClose }) {
  const { draft, setAt, open, saveAt, copyItem, confirmRemove } = useEditor();
  const path = stack[stack.length - 1];
  const value = getIn(draft, path);
  const isItem = typeof path[path.length - 1] === 'number'; // an item of a list

  useEffect(() => {
    // Escape closes the top-most dialog only (copy / raw JSON / add dialogs sit above this one)
    const onKey = (e) => e.key === 'Escape' && !document.querySelector('.modal-backdrop.top') && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${Array.isArray(value) ? 'wide' : ''}`}>
        <div className="modal-head">
          <nav className="crumbs">
            {stack.map((p, i) => {
              const label = p.slice(i > 0 ? stack[i - 1].length : 0).map(labelOf).join(' › ') || 'Record';
              return (
                <span key={i}>
                  {i > 0 && <span className="sep">›</span>}
                  {i < stack.length - 1 ? (
                    <button className="link" onClick={() => onNavigate(stack.slice(0, i + 1))}>{label}</button>
                  ) : (
                    <b>{label}</b>
                  )}
                </span>
              );
            })}
          </nav>
          <div className="row gap">
            {isItem && isObj(value) && copyItem && (
              <button className="btn small" title="Copy this item" onClick={() => copyItem(path)}>⧉ Copy item</button>
            )}
            {value !== undefined && confirmRemove && (
              <button className="btn small ghost danger" title="Delete this node from the record" onClick={() => confirmRemove(path)}>
                🗑 Delete
              </button>
            )}
            <button className="btn ghost" onClick={onClose} title="Close (Esc)">×</button>
          </div>
        </div>
        <div className="ptr-bar">
          <span className="muted small">JSON Patch path</span>
          <code title="Path of this node, for PATCH requests">{toPointer(path)}</code>
          <button className="btn small ghost" title="Copy path" onClick={() => navigator.clipboard?.writeText(toPointer(path))}>⧉</button>
        </div>
        <ModalBody key={JSON.stringify(path)} path={path} value={value} setAt={setAt} open={open} saveAt={saveAt} />
      </div>
    </div>
  );
}

/** Body with two tabs: the fields (or list) view, and the raw JSON of the selected node. */
function ModalBody({ path, value, setAt, open, saveAt }) {
  const [tab, setTab] = useState('fields');
  if (value === undefined) return <div className="modal-body"><p className="muted">This value no longer exists.</p></div>;
  const isArr = Array.isArray(value);
  return (
    <div className="modal-body">
      <div className="seg tabs">
        <button className={tab === 'fields' ? 'on' : ''} onClick={() => setTab('fields')}>{isArr ? 'List' : 'Fields'}</button>
        <button className={tab === 'raw' ? 'on' : ''} onClick={() => setTab('raw')}>{'{ }'} Raw JSON</button>
      </div>
      {tab === 'raw' ? (
        <RawJsonEditor value={value} onSave={(v) => saveAt(path, v)} />
      ) : isArr ? (
        <ArrayTable path={path} rows={value} pageSize={20} />
      ) : isObj(value) ? (
        <table className="kv editable">
          <tbody>
            {Object.entries(value).map(([k, v]) => (
              <tr key={k}>
                <th title={k}>{k}</th>
                <td>
                  <Cell value={v} path={[...path, k]} setAt={setAt} open={open} />
                </td>
              </tr>
            ))}
            {Object.keys(value).length === 0 && (
              <tr><td className="muted">Empty object</td></tr>
            )}
          </tbody>
        </table>
      ) : (
        <p className="muted">{String(value)}</p>
      )}
    </div>
  );
}
