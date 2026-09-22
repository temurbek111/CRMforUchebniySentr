import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { Icon } from './Icon';
import { Pagination } from './Pagination';

export type SortDirection = 'asc' | 'desc';

export interface TableColumn<T> {
  /** Unique column id (used as the React key and the sort state key). */
  key: string;
  header: ReactNode;
  /** Cell renderer - must come from real row data. */
  render: (row: T) => ReactNode;
  /**
   * Optional accessor enabling client-side sorting for this column.
   * Return a string or number; null/undefined values sort last.
   */
  sortValue?: (row: T) => string | number | null | undefined;
  align?: 'left' | 'right' | 'center';
  width?: string;
  className?: string;
  headerTitle?: string;
}

export interface TableProps<T> {
  columns: ReadonlyArray<TableColumn<T>>;
  rows: ReadonlyArray<T>;
  /** Stable identity for a row (id from the API). */
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  /** Extra trailing column with row actions. */
  actions?: (row: T) => ReactNode;
  actionsHeader?: ReactNode;
  loading?: boolean;
  /** Anything thrown while fetching rows. */
  error?: unknown;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyMessage?: ReactNode;
  emptyAction?: ReactNode;
  emptyIcon?: string;
  /** Client-side pagination over the supplied array (default on). */
  paginated?: boolean;
  initialPageSize?: number;
  pageSizeOptions?: ReadonlyArray<number>;
  initialSort?: { key: string; direction: SortDirection };
  /** Rendered above the table (filters, search, result counts). */
  toolbar?: ReactNode;
  /** Rendered below the table in place of the pagination bar. */
  footer?: ReactNode;
  caption?: ReactNode;
  className?: string;
  /** Keeps the header row visible while the table scrolls. */
  stickyHeader?: boolean;
  dense?: boolean;
}

function compareValues(
  left: string | number | null | undefined,
  right: string | number | null | undefined,
): number {
  const leftEmpty = left === null || left === undefined || left === '';
  const rightEmpty = right === null || right === undefined || right === '';
  if (leftEmpty && rightEmpty) return 0;
  if (leftEmpty) return 1; // empty values always last
  if (rightEmpty) return -1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (typeof left === 'number') return left - Number(right);
  if (typeof right === 'number') return Number(left) - right;
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Data table with client-side sorting and pagination over a supplied array.
 *
 * Server-paginated pages should pass a single page of rows with
 * `paginated={false}` and render their own <Pagination> using the envelope
 * (`count`, `total_pages`) returned by the API.
 */
export function Table<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  actions,
  actionsHeader = '',
  loading = false,
  error,
  onRetry,
  emptyTitle = 'Nothing to show',
  emptyMessage,
  emptyAction,
  emptyIcon = 'inbox',
  paginated = true,
  initialPageSize = 25,
  pageSizeOptions = [10, 25, 50, 100],
  initialSort,
  toolbar,
  footer,
  caption,
  className,
  stickyHeader = false,
  dense = false,
}: TableProps<T>) {
  const [sort, setSort] = useState<{ key: string; direction: SortDirection } | null>(
    initialSort ?? null,
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const sortedRows = useMemo(() => {
    if (sort === null) return [...rows];
    const column = columns.find((entry) => entry.key === sort.key);
    if (column?.sortValue === undefined) return [...rows];
    const accessor = column.sortValue;
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => compareValues(accessor(a), accessor(b)) * factor);
  }, [rows, columns, sort]);

  const totalPages = paginated ? Math.max(1, Math.ceil(sortedRows.length / pageSize)) : 1;
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const visibleRows = useMemo(() => {
    if (!paginated) return sortedRows;
    const start = (safePage - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, paginated, safePage, pageSize]);

  // A new filter/sort or page size restarts at page one.
  useEffect(() => {
    setPage(1);
  }, [sort, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const toggleSort = (key: string): void => {
    setSort((current) => {
      if (current === null || current.key !== key) return { key, direction: 'asc' };
      if (current.direction === 'asc') return { key, direction: 'desc' };
      return null;
    });
  };

  const columnCount = columns.length + (actions !== undefined ? 1 : 0);
  const showEmpty = !loading && sortedRows.length === 0;

  return (
    <div className={['table-panel', className ?? ''].filter(Boolean).join(' ')}>
      {toolbar !== undefined ? <div className="table-toolbar">{toolbar}</div> : null}

      <div className="table-wrap">
        <table className={['table', onRowClick !== undefined ? 'table--clickable' : ''].filter(Boolean).join(' ')}>
          {caption !== undefined ? <caption className="visually-hidden">{caption}</caption> : null}
          <thead className={stickyHeader ? 'is-sticky' : undefined}>
            <tr>
              {columns.map((column) => {
                const isSorted = sort !== null && sort.key === column.key;
                const classes = [
                  column.align === 'right' ? 'is-numeric' : '',
                  column.align === 'center' ? 'u-center' : '',
                  column.className ?? '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={classes}
                    style={column.width !== undefined ? { width: column.width } : undefined}
                    title={column.headerTitle}
                  >
                    {column.sortValue !== undefined ? (
                      <button
                        type="button"
                        className={['table__sort', isSorted ? 'is-active' : ''].filter(Boolean).join(' ')}
                        onClick={() => toggleSort(column.key)}
                        aria-label={
                          typeof column.header === 'string'
                            ? `Sort by ${column.header}`
                            : 'Sort column'
                        }
                      >
                        <span>{column.header}</span>
                        <span className="table__sort-icon" aria-hidden="true">
                          <Icon
                            name={
                              sort === null
                                ? 'arrowUpDown'
                                : sort.direction === 'asc'
                                  ? 'arrowUp'
                                  : 'arrowDown'
                            }
                            size={12}
                          />
                        </span>
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
              {actions !== undefined ? (
                <th scope="col" className="is-actions">
                  {actionsHeader}
                </th>
              ) : null}
            </tr>
          </thead>

          <tbody>
            {loading && visibleRows.length === 0
              ? Array.from({ length: 5 }, (_, index) => (
                  <tr key={`skeleton-${index}`}>
                    <td colSpan={columnCount} style={{ height: dense ? 32 : 38 }}>
                      <span className="skeleton skeleton--text" />
                    </td>
                  </tr>
                ))
              : null}

            {!loading && error !== undefined && error !== null
              ? (
                  <tr>
                    <td colSpan={columnCount}>
                      <ErrorState error={error} onRetry={onRetry} />
                    </td>
                  </tr>
                )
              : null}

            {showEmpty && (error === undefined || error === null) ? (
              <tr>
                <td colSpan={columnCount} className="table__empty">
                  <EmptyState
                    title={emptyTitle}
                    message={emptyMessage}
                    icon={emptyIcon}
                    action={emptyAction}
                  />
                </td>
              </tr>
            ) : null}

            {visibleRows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick === undefined ? undefined : () => onRowClick(row)}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={[
                      column.align === 'right' ? 'is-numeric' : '',
                      column.className ?? '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {column.render(row)}
                  </td>
                ))}
                {actions !== undefined ? (
                  <td className="is-actions">
                    <span className="table__actions-cell">{actions(row)}</span>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {footer !== undefined ? (
        <div className="table-footer">{footer}</div>
      ) : paginated && sortedRows.length > 0 ? (
        <div className="table-footer">
          <Pagination
            page={safePage}
            totalPages={totalPages}
            totalItems={sortedRows.length}
            pageSize={pageSize}
            pageSizeOptions={pageSizeOptions}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </div>
      ) : null}
    </div>
  );
}

export default Table;
