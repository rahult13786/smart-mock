import { useState } from 'react';

const STEP = 200;
const isContainer = (v) => v !== null && typeof v === 'object';

function Scalar({ value }) {
  if (value === null) return <span className="jt-null">null</span>;
  if (typeof value === 'string') return <span className="jt-str">{JSON.stringify(value)}</span>;
  if (typeof value === 'number') return <span className="jt-num">{String(value)}</span>;
  return <span className="jt-bool">{String(value)}</span>;
}

function Key({ name }) {
  if (name === undefined) return null;
  return (
    <>
      {typeof name === 'number' ? <span className="jt-index">{name}</span> : <span className="jt-key">{JSON.stringify(name)}</span>}
      <span className="jt-punct">: </span>
    </>
  );
}

function TreeNode({ name, value, depth, last, openDepth }) {
  const [open, setOpen] = useState(depth < openDepth);
  const [shown, setShown] = useState(STEP);
  const comma = last ? '' : ',';
  if (!isContainer(value)) {
    return (
      <div className="jt-row" style={{ paddingLeft: depth * 18 + 30 }}>
        <Key name={name} />
        <Scalar value={value} />
        <span className="jt-punct">{comma}</span>
      </div>
    );
  }
  const arr = Array.isArray(value);
  const entries = arr ? value.map((v, i) => [i, v]) : Object.entries(value);
  const [l, r] = arr ? ['[', ']'] : ['{', '}'];
  const count = `${entries.length} ${arr ? (entries.length === 1 ? 'item' : 'items') : entries.length === 1 ? 'key' : 'keys'}`;
  const toggle = () => entries.length && setOpen((o) => !o);
  return (
    <>
      <div className="jt-row" style={{ paddingLeft: depth * 18 }}>
        <button type="button" className="jt-toggle" onClick={toggle} disabled={!entries.length} aria-expanded={open}>
          {entries.length ? (open ? '[V]' : '[>]') : '   '}
        </button>
        <span className="jt-click" onClick={toggle}>
          <Key name={name} />
          <span className="jt-punct">{l}</span>
          {(!open || !entries.length) && (
            <>
              {entries.length > 0 && <span className="jt-more">…</span>}
              <span className="jt-punct">{r}{comma}</span>
              {entries.length > 0 && <span className="jt-count">{count}</span>}
            </>
          )}
        </span>
      </div>
      {open && entries.length > 0 && (
        <>
          {entries.slice(0, shown).map(([k, v], i) => (
            <TreeNode key={k} name={k} value={v} depth={depth + 1} last={i === entries.length - 1} openDepth={openDepth} />
          ))}
          {entries.length > shown && (
            <div className="jt-row" style={{ paddingLeft: (depth + 1) * 18 + 30 }}>
              <button type="button" className="link small" onClick={() => setShown(shown + STEP)}>
                show {Math.min(STEP, entries.length - shown)} more of {entries.length - shown} remaining
              </button>
            </div>
          )}
          <div className="jt-row" style={{ paddingLeft: depth * 18 + 30 }}>
            <span className="jt-punct">{r}{comma}</span>
          </div>
        </>
      )}
    </>
  );
}

export default function JsonTree({ value, openDepth = 1 }) {
  return (
    <div className="json-tree">
      <TreeNode value={value} depth={0} last openDepth={openDepth} />
    </div>
  );
}
