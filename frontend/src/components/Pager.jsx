import "./Pager.css";

export const PAGE_SIZE = 20;

export function pageCount(total) {
  return Math.max(1, Math.ceil((total || 0) / PAGE_SIZE));
}

// Previous / next under a song list. Hidden when everything fits on one page.
export default function Pager({ page, total, onPage }) {
  const pages = pageCount(total);
  if (total <= PAGE_SIZE) return null;
  return (
    <nav className="pager" aria-label="Pages">
      <button
        type="button"
        className="btn small ghost"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        Previous
      </button>
      <span className="pager-label">
        {page} of {pages}
      </span>
      <button
        type="button"
        className="btn small ghost"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
