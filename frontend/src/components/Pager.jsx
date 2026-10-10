export default function Pager({ page, pages, onPage }) {
  if (pages <= 1) return null;
  return (
    <div className="pager">
      <button className="btn small" disabled={page === 0} onClick={() => onPage(0)}>«</button>
      <button className="btn small" disabled={page === 0} onClick={() => onPage(page - 1)}>‹</button>
      <span className="muted small">Page {page + 1} of {pages}</span>
      <button className="btn small" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>›</button>
      <button className="btn small" disabled={page >= pages - 1} onClick={() => onPage(pages - 1)}>»</button>
    </div>
  );
}
