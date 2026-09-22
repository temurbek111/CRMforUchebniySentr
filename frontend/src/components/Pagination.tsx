import { Select } from './Select';
import { Icon } from './Icon';

export interface PaginationProps {
  page: number;
  totalPages: number;
  /** Total number of rows across all pages, for the summary line. */
  totalItems?: number;
  pageSize?: number;
  pageSizeOptions?: ReadonlyArray<number>;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  /** Plural noun for the summary, e.g. "students". */
  itemLabel?: string;
  className?: string;
}

/** Windowed page numbers with ellipsis gaps, e.g. 1 … 4 5 6 … 12. */
export function pageWindow(current: number, total: number): Array<number | 'gap'> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set<number>([1, total, current, current - 1, current + 1]);
  const list = [...pages].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);

  const out: Array<number | 'gap'> = [];
  let previous = 0;
  for (const page of list) {
    if (previous !== 0 && page - previous > 1) out.push('gap');
    out.push(page);
    previous = page;
  }
  return out;
}

/** Client- or server-side pagination controls. */
export function Pagination({
  page,
  totalPages,
  totalItems,
  pageSize,
  pageSizeOptions = [10, 25, 50, 100],
  onPageChange,
  onPageSizeChange,
  itemLabel = 'items',
  className,
}: PaginationProps) {
  if (totalPages <= 0) return null;

  const safePage = Math.min(Math.max(page, 1), totalPages);
  const first = pageSize !== undefined && totalItems !== undefined ? (safePage - 1) * pageSize + 1 : null;
  const last =
    pageSize !== undefined && totalItems !== undefined
      ? Math.min(safePage * pageSize, totalItems)
      : null;

  return (
    <nav
      className={['pagination', className ?? ''].filter(Boolean).join(' ')}
      aria-label="Pagination"
    >
      {totalItems !== undefined ? (
        <span className="pagination__info">
          {first !== null && last !== null
            ? `${first}–${last} of ${totalItems} ${itemLabel}`
            : `${totalItems} ${itemLabel}`}
        </span>
      ) : null}

      <button
        type="button"
        className="pagination__page"
        onClick={() => onPageChange(safePage - 1)}
        disabled={safePage <= 1}
        aria-label="Previous page"
      >
        <Icon name="chevronLeft" size={14} />
      </button>

      {pageWindow(safePage, totalPages).map((entry, index) =>
        entry === 'gap' ? (
          <span className="pagination__ellipsis" key={`gap-${index}`}>
            …
          </span>
        ) : (
          <button
            key={entry}
            type="button"
            className={['pagination__page', entry === safePage ? 'is-current' : '']
              .filter(Boolean)
              .join(' ')}
            onClick={() => onPageChange(entry)}
            aria-current={entry === safePage ? 'page' : undefined}
            aria-label={`Page ${entry}`}
          >
            {entry}
          </button>
        ),
      )}

      <button
        type="button"
        className="pagination__page"
        onClick={() => onPageChange(safePage + 1)}
        disabled={safePage >= totalPages}
        aria-label="Next page"
      >
        <Icon name="chevronRight" size={14} />
      </button>

      {onPageSizeChange !== undefined && pageSize !== undefined ? (
        <span className="pagination__size">
          <label className="visually-hidden" htmlFor="pagination-page-size">
            Rows per page
          </label>
          <Select
            id="pagination-page-size"
            small
            labelHidden
            options={pageSizeOptions.map((size) => ({ value: size, label: `${size} / page` }))}
            value={pageSize}
            onChange={(value) => {
              if (value !== '') onPageSizeChange(value);
            }}
          />
        </span>
      ) : null}
    </nav>
  );
}

export default Pagination;
