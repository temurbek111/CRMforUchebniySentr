/**
 * Presentational primitives shared by the Students and Groups pages.
 *
 * These are deliberately thin: they compose the existing component library
 * (Badge, EmptyState, ErrorState, LoadingState, Pagination, Button) with the
 * module classes in ./ui.css. No business data lives here.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, EmptyState, ErrorState, Icon, LoadingState, Pagination } from '../../components';
import { initials } from '../../utils/format';

import './ui.css';

// --------------------------------------------------------------------------- //
// Async surfaces
// --------------------------------------------------------------------------- //

export interface AsyncSectionProps {
  loading: boolean;
  error: unknown;
  onRetry?: () => void;
  /** True when the request succeeded but the endpoint returned no rows. */
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyMessage?: ReactNode;
  emptyAction?: ReactNode;
  emptyIcon?: string;
  loadingRows?: number;
  /** Use the inline spinner instead of the skeleton table. */
  inline?: boolean;
  loadingLabel?: string;
  children: ReactNode;
}

/**
 * The one place the three required states are rendered, so every tab and panel
 * behaves identically: skeleton while loading, ErrorState with a retry on
 * failure, EmptyState with a call to action when there is simply nothing.
 */
export function AsyncSection({
  loading,
  error,
  onRetry,
  isEmpty = false,
  emptyTitle = 'Nothing to show',
  emptyMessage,
  emptyAction,
  emptyIcon = 'inbox',
  loadingRows = 6,
  inline = false,
  loadingLabel,
  children,
}: AsyncSectionProps) {
  if (loading) {
    return inline ? (
      <LoadingState label={loadingLabel} inline />
    ) : (
      <LoadingState variant="skeleton" rows={loadingRows} label={loadingLabel} />
    );
  }

  if (error !== null && error !== undefined) {
    return <ErrorState error={error} onRetry={onRetry} />;
  }

  if (isEmpty) {
    return <EmptyState title={emptyTitle} message={emptyMessage} icon={emptyIcon} action={emptyAction} />;
  }

  return <>{children}</>;
}

// --------------------------------------------------------------------------- //
// Tabs
// --------------------------------------------------------------------------- //

export interface TabDefinition<T extends string> {
  key: T;
  label: string;
  /** Optional counter rendered next to the label. */
  count?: number;
}

export interface TabNavProps<T extends string> {
  tabs: ReadonlyArray<TabDefinition<T>>;
  active: T;
  onChange: (key: T) => void;
  label?: string;
  idPrefix: string;
}

/** Accessible tab strip; the panels themselves live in the calling page. */
export function TabNav<T extends string>({
  tabs,
  active,
  onChange,
  label = 'Sections',
  idPrefix,
}: TabNavProps<T>) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => {
        const selected = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${tab.key}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${tab.key}`}
            className={['tabs__item', selected ? 'is-active' : ''].filter(Boolean).join(' ')}
            onClick={() => onChange(tab.key)}
          >
            {tab.label}
            {tab.count !== undefined ? <span className="tabs__count">{tab.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps {
  id: string;
  labelId: string;
  children: ReactNode;
}

/** Wrapper that ties a panel to its tab button for screen readers. */
export function TabPanel({ id, labelId, children }: TabPanelProps) {
  return (
    <div className="tab-panel" role="tabpanel" id={id} aria-labelledby={labelId} tabIndex={-1}>
      {children}
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Small display pieces
// --------------------------------------------------------------------------- //

export interface AvatarProps {
  name: string;
  photo?: string | null;
  size?: 'sm' | 'md' | 'lg';
}

/** Photo when the API has one, otherwise the person's initials. */
export function Avatar({ name, photo, size = 'md' }: AvatarProps) {
  const classes = ['avatar', size === 'sm' ? 'avatar--sm' : '', size === 'lg' ? 'avatar--lg' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <span className={classes} aria-hidden={photo ? undefined : true}>
      {photo ? <img className="avatar__image" src={photo} alt={name} /> : initials(name)}
    </span>
  );
}

/** Label + value pair used across every detail panel. */
export function DataField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="data-field">
      <span className="data-field__label">{label}</span>
      <span className="data-field__value">{children}</span>
    </div>
  );
}

export interface RecordHeaderProps {
  avatar?: ReactNode;
  title: ReactNode;
  code?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}

/** The identity block at the top of a student or group detail page. */
export function RecordHeader({ avatar, title, code, badges, actions, children }: RecordHeaderProps) {
  return (
    <div className="record-header">
      <div className="record-header__identity">
        {avatar}
        <div className="record-header__titles">
          <span className="record-header__name">{title}</span>
          {code !== undefined ? <span className="record-header__code">{code}</span> : null}
          {badges !== undefined ? <span className="record-header__badges">{badges}</span> : null}
        </div>
      </div>
      {actions !== undefined ? <div className="record-header__actions">{actions}</div> : null}
      {children !== undefined ? <div className="u-grow">{children}</div> : null}
    </div>
  );
}

export interface UtilisationBarProps {
  enrolled: number;
  capacity: number;
}

/** Students / capacity with a colour-coded fill (never a decorative gradient). */
export function UtilisationBar({ enrolled, capacity }: UtilisationBarProps) {
  const safeCapacity = capacity > 0 ? capacity : 0;
  const ratio = safeCapacity === 0 ? 0 : enrolled / safeCapacity;
  const width = Math.min(Math.max(ratio, 0), 1) * 100;
  const tone = enrolled > safeCapacity ? 'danger' : ratio >= 0.9 ? 'warning' : '';

  return (
    <div className="util">
      <span className="util__bar" role="presentation">
        <span
          className={['util__fill', tone ? `util__fill--${tone}` : ''].filter(Boolean).join(' ')}
          style={{ width: `${width}%` }}
        />
      </span>
      <span className="util__label">
        {enrolled} / {capacity === 0 ? '—' : capacity}
        {enrolled > safeCapacity && safeCapacity > 0 ? ' · over capacity' : ''}
      </span>
    </div>
  );
}

const TREND_TONES: Record<string, 'success' | 'danger' | 'neutral' | 'info'> = {
  improving: 'success',
  declining: 'danger',
  stable: 'info',
  insufficient_data: 'neutral',
};

/** Exam/attendance momentum as a labelled badge. */
export function TrendBadge({ trend }: { trend: string | null | undefined }) {
  const key = (trend ?? '').trim().toLowerCase();
  if (key === '') return <span className="u-subtle">—</span>;
  const tone = TREND_TONES[key] ?? 'neutral';
  return <Badge tone={tone}>{key.replace(/_/g, ' ')}</Badge>;
}

export interface FilterChipOption {
  value: string;
  label: string;
}

export interface FilterChipsProps {
  options: ReadonlyArray<FilterChipOption>;
  value: string;
  onChange: (value: string) => void;
  /** Label of the "everything" chip; defaults to "All". */
  allLabel?: string;
  label?: string;
}

/** Status filter chips; 'all' clears the filter. */
export function FilterChips({
  options,
  value,
  onChange,
  allLabel = 'All',
  label = 'Filter by status',
}: FilterChipsProps) {
  return (
    <div className="chip-row" role="group" aria-label={label}>
      <button
        type="button"
        className={['chip', value === '' ? 'is-active' : ''].filter(Boolean).join(' ')}
        aria-pressed={value === ''}
        onClick={() => onChange('')}
      >
        {allLabel}
      </button>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={['chip', value === option.value ? 'is-active' : ''].filter(Boolean).join(' ')}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Server-side pagination
// --------------------------------------------------------------------------- //

export interface ServerPaginationProps {
  page: number;
  totalPages: number;
  count: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  itemLabel: string;
}

/** Thin wrapper so list pages do not repeat the envelope plumbing. */
export function ServerPagination({
  page,
  totalPages,
  count,
  pageSize,
  onPageChange,
  onPageSizeChange,
  itemLabel,
}: ServerPaginationProps) {
  if (count === 0) return null;
  return (
    <Pagination
      page={page}
      totalPages={Math.max(totalPages, 1)}
      totalItems={count}
      pageSize={pageSize}
      pageSizeOptions={[10, 25, 50, 100]}
      itemLabel={itemLabel}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
    />
  );
}

// --------------------------------------------------------------------------- //
// Attendance month grid
// --------------------------------------------------------------------------- //

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const CALENDAR_LEGEND: ReadonlyArray<{ status: string; label: string }> = [
  { status: 'present', label: 'Present' },
  { status: 'late', label: 'Late' },
  { status: 'absent', label: 'Absent' },
  { status: 'excused', label: 'Excused' },
];

interface MonthParts {
  year: number;
  monthIndex: number;
}

/** Parse `YYYY-MM` without timezone drift. */
export function parseMonthKey(month: string): MonthParts {
  const [rawYear, rawMonth] = month.split('-');
  const year = Number(rawYear);
  const monthNumber = Number(rawMonth);
  return {
    year: Number.isFinite(year) ? year : 1970,
    monthIndex: Number.isFinite(monthNumber) ? monthNumber - 1 : 0,
  };
}

/** `YYYY-MM` for the month `offset` steps away from `month`. */
export function shiftMonth(month: string, offset: number): string {
  const { year, monthIndex } = parseMonthKey(month);
  const shifted = new Date(year, monthIndex + offset, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}`;
}

/** Human month label, e.g. "March 2026". */
export function monthLabel(month: string): string {
  const { year, monthIndex } = parseMonthKey(month);
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(
    new Date(year, monthIndex, 1),
  );
}

function statusClass(status: string | undefined): string {
  switch (status) {
    case 'present':
      return 'calendar__cell--present';
    case 'late':
      return 'calendar__cell--late';
    case 'absent':
      return 'calendar__cell--absent';
    case 'excused':
      return 'calendar__cell--excused';
    default:
      return '';
  }
}

export interface MonthGridProps {
  /** `YYYY-MM-DD` -> attendance status, exactly as the API returns it. */
  calendar: Record<string, string>;
  /** Month to draw as `YYYY-MM`. */
  month: string;
}

/**
 * One-month view of the API's `calendar` map. Days with no record stay blank -
 * the grid never invents a status.
 */
export function MonthGrid({ calendar, month }: MonthGridProps) {
  const { year, monthIndex } = parseMonthKey(month);
  const firstOfMonth = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  // Monday-first index of the 1st.
  const leadingBlanks = (firstOfMonth.getDay() + 6) % 7;

  const cells: ReactNode[] = [];
  for (let index = 0; index < leadingBlanks; index += 1) {
    cells.push(<span className="calendar__cell calendar__cell--blank" key={`blank-${index}`} />);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const status = calendar[key];
    cells.push(
      <span
        className={['calendar__cell', statusClass(status)].filter(Boolean).join(' ')}
        key={key}
        title={status ? `${key}: ${status}` : key}
      >
        <span className="calendar__day">{day}</span>
      </span>,
    );
  }

  return (
    <div className="calendar">
      <div className="calendar__head" aria-hidden="true">
        {WEEKDAY_LABELS.map((label) => (
          <span className="calendar__weekday" key={label}>
            {label}
          </span>
        ))}
      </div>
      <div className="calendar__grid">{cells}</div>
      <div className="calendar__legend">
        {CALENDAR_LEGEND.map((entry) => (
          <span className="calendar__legend-item" key={entry.status}>
            <span className={`calendar__swatch calendar__swatch--${entry.status}`} aria-hidden="true" />
            {entry.label}
          </span>
        ))}
        <span className="calendar__legend-item">
          <span className="calendar__swatch" aria-hidden="true" />
          Not recorded
        </span>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Misc
// --------------------------------------------------------------------------- //

/** Internal navigation rendered as a real link so it can be opened in a tab. */
export function RecordLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link className="row-link" to={to}>
      {children}
    </Link>
  );
}

/** "Try again" affordance used above tables that already render their own rows. */
export function RefreshButton({ onClick, label = 'Refresh' }: { onClick: () => void; label?: string }) {
  return (
    <Button size="sm" icon="refresh" onClick={onClick}>
      {label}
    </Button>
  );
}

/** Small inline banner for a permission note or a soft warning. */
export function InlineNote({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warning' | 'error';
  children: ReactNode;
}) {
  return (
    <div className={`alert alert--${tone} inline-alert`} role="note">
      <span className="alert__icon" aria-hidden="true">
        <Icon name={tone === 'info' ? 'info' : 'alertCircle'} size={16} />
      </span>
      <div className="alert__content">{children}</div>
    </div>
  );
}
