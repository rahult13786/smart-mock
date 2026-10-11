import { useMemo, useState } from 'react';
import { columnsOf, humanize, isObj, isScalar, summarize } from '../util/value.js';
import ScalarInput from './ScalarInput.jsx';
import { useEditor } from './editor.js';
import Pager from './Pager.jsx';
import AddItemModal from './AddItemModal.jsx';

export default function ArrayTable({ path, rows, rowPath, pageSize = 15 }) {
  const { setAt, open, addItems, copyItem, confirmRemove } = useEditor();
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState('');
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(null);
  const pathOf = rowPath || ((i) => [...path, i]);
  const canAdd = !rowPath && !!addItems;

  const scalarRows = rows.length > 0 && rows.every((r) => !isObj(r));
  const canCopy = canAdd && !!copyItem && !scalarRows;
  const canDelete = canAdd && !!confirmRemove;
  const showActions = canCopy || canDelete;
  const deleteRow = (i) => confirmRemove(pathOf(i), () => setAdded(null));
  const copyRow = (i) =>
    copyItem(pathOf(i), (index) => {
      setFilter('');
      setAdded([index, index + 1]);
      setPage(Math.floor(index / pageSize));
    });
  const columns = useMemo(() => (scalarRows ? ['value'] : columnsOf(rows)), [rows, scalarRows]);

  const indexed = useMemo(() => {
    const all = rows.map((r, i) => [r, i]);
    const f = filter.trim().toLowerCase();
    if (!f) return all;
    return all.filter(([r]) => {
      if (!isObj(r)) return String(r).toLowerCase().includes(f);
      return Object.values(r).some((v) => (isScalar(v) ? String(v ?? '') : summarize(v)).toLowerCase().includes(f));
    });
  }, [rows, filter]);

  const pages = Math.max(1, Math.ceil(indexed.length / pageSize));
  const p = Math.min(page, pages - 1);
  const visible = indexed.slice(p * pageSize, p * pageSize + pageSize);

  const addButton = canAdd && (
    <button className="btn small add-btn" title="Add an item to this list" onClick={() => setAdding(true)}>
      + Add
    </button>
  );
  const addModal = adding && (
    <AddItemModal
      path={path}
      rows={rows}
      onClose={() => setAdding(false)}
      onSave={async (items) => {
        const start = rows.length;
        await addItems(path, items);
        setFilter('');
        setAdded([start, start + items.length]);
        setPage(Number.MAX_SAFE_INTEGER);
      }}
    />
  );

  if (!rows.length || !columns.length) {
    return (
      <div className="table-tools">
        <span className="muted small">
          {!rows.length ? 'Empty list' : `${rows.length} empty object${rows.length === 1 ? '' : 's'} – no fields`}
        </span>
        <span className="spacer" />
        {addButton}
        {addModal}
      </div>
    );
  }

  return (
    <div className="array-table">
      {(rows.length > pageSize || canAdd) && (
        <div className="table-tools">
          {rows.length > pageSize && <input
            className="filter"
            placeholder={`Filter ${rows.length} items…`}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(0);
            }}
          />}
          {filter && <span className="muted small">{indexed.length} match</span>}
          <span className="spacer" />
          {addButton}
        </div>
      )}
      {addModal}
      <div className="table-wrap">
        <table className="grid dense">
          <thead>
            <tr>
              <th className="idx">#</th>
              {columns.map((c) => <th key={c} title={c}>{humanize(c)}</th>)}
              {showActions && <th className="actions" />}
            </tr>
          </thead>
          <tbody>
            {visible.map(([row, i]) => {
              const rp = pathOf(i);
              return (
                <tr key={i} className={added && i >= added[0] && i < added[1] ? 'added' : undefined}>
                  <td className="idx">
                    {isObj(row) ? (
                      <button className="link" title="Open row" onClick={() => open(rp)}>{i}</button>
                    ) : (
                      i
                    )}
                  </td>
                  {columns.map((c) => {
                    const v = scalarRows ? row : row?.[c];
                    const cp = scalarRows ? rp : [...rp, c];
                    return (
                      <td key={c}>
                        <Cell value={v} path={cp} setAt={setAt} open={open} />
                      </td>
                    );
                  })}
                  {showActions && (
                    <td className="actions">
                      {canCopy && isObj(row) && (
                        <button className="btn small ghost copy-btn" title="Copy this item" onClick={() => copyRow(i)}>
                          ⧉ Copy
                        </button>
                      )}
                      {canDelete && (
                        <button className="btn small ghost del-btn" title="Delete this item" onClick={() => deleteRow(i)}>
                          🗑
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager page={p} pages={pages} onPage={setPage} />
    </div>
  );
}

export function Cell({ value, path, setAt, open }) {
  if (value === undefined) return <span className="muted">—</span>;
  if (Array.isArray(value)) {
    return (
      <button className="link" onClick={() => open(path)}>
        [{value.length} item{value.length === 1 ? '' : 's'}]
      </button>
    );
  }
  if (isObj(value)) {
    return (
      <button className="link" onClick={() => open(path)} title="Open object">
        {summarize(value)} ›
      </button>
    );
  }
  return <EnumAwareInput value={value} path={path} setAt={setAt} />;
}

function EnumAwareInput({ value, path, setAt }) {
  const { enumFor } = useEditor();
  return <ScalarInput compact value={value} options={enumFor?.(path)} onChange={(v) => setAt(path, v)} />;
}
