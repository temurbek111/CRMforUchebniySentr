/**
 * Audit log - the append-only trail (apps/core/models.AuditLog).
 *
 * Strictly read-only. Records are never edited or deleted through the
 * application, so this screen deliberately offers no write action of any kind -
 * there is nothing here to create, correct or remove.
 *
 * `audit.view` is required by the server (apps/core/views.AuditLogViewSet). The
 * filter dropdowns are data-driven from /api/audit/filter-options/ rather than
 * hardcoded, so they can never drift from what the table actually contains.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Card,
  DateField,
  EmptyState,
  Button,
  Modal,
  SearchInput,
  Select,
  Table,
  type BadgeTone,
  type TableColumn,
} from '../../components';
import { useAuth } from '../../auth/AuthContext';
import { PERMISSIONS } from '../../types';
import type { AuditEntry, Paginated } from '../../types';
import { humanise } from '../../utils/format';
import { useSettings } from '../../settings/SettingsContext';
import { useAsyncResource } from '../students/hooks';
import { DataField, RefreshButton, ServerPagination } from '../students/ui';
import { auditApi, diffFields, hasDiff, type AuditQuery, type DiffRow } from './api';

const DEFAULT_PAGE_SIZE = 25;

/**
 * Sentinel for a caller without audit.view. The client-side check only decides
 * whether a request is worth making - the server enforces the permission either
 * way (apps/core/views.AuditLogViewSet -> RequirePerms(Perm.AUDIT_VIEW)).
 */
function emptyPage(): Paginated<AuditEntry> {
  return {
    count: 0,
    page: 1,
    page_size: DEFAULT_PAGE_SIZE,
    total_pages: 0,
    next: null,
    previous: null,
    results: [],
  };
}

/** Colour follows the meaning of the action (apps/core/models.AuditLog.Action). */
const ACTION_TONES: Readonly<Record<string, BadgeTone>> = {
  create: 'success',
  update: 'info',
  delete: 'danger',
  login: 'neutral',
  logout: 'neutral',
  permission: 'warning',
  approve: 'success',
  pay: 'success',
  void: 'danger',
};

function actionTone(action: string): BadgeTone {
  return ACTION_TONES[action] ?? 'neutral';
}

export function AuditPage() {
  const { hasPerm } = useAuth();
  const canView = hasPerm(PERMISSIONS.AUDIT_VIEW);
  const { dateTime, date, number } = useSettings();

  const [search, setSearch] = useState('');
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  const resetToFirstPage = useCallback((): void => setPage(1), []);

  const queryKey = [canView, search, entity, action, dateFrom, dateTo, page, pageSize].join('|');

  const resource = useAsyncResource(
    () =>
      canView
        ? auditApi.list({
            search: search.trim() === '' ? undefined : search.trim(),
            entity: entity === '' ? undefined : entity,
            action: action === '' ? undefined : action,
            date_from: dateFrom === '' ? undefined : dateFrom,
            date_to: dateTo === '' ? undefined : dateTo,
            page,
            page_size: pageSize,
          } satisfies AuditQuery)
        : Promise.resolve(emptyPage()),
    queryKey,
  );

  // Distinct entity/action values straight from the database, so the dropdowns
  // cannot offer a value that matches nothing.
  const options = useAsyncResource(
    () => (canView ? auditApi.filterOptions() : Promise.resolve({ entities: [], actions: [] })),
    `audit-filter-options|${canView}`,
  );

  const rows = resource.data?.results ?? [];
  const count = resource.data?.count ?? 0;
  const totalPages = resource.data?.total_pages ?? 0;

  const hasFilters =
    search.trim() !== '' || entity !== '' || action !== '' || dateFrom !== '' || dateTo !== '';

  const clearFilters = useCallback((): void => {
    setSearch('');
    setEntity('');
    setAction('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }, []);

  const columns = useMemo<ReadonlyArray<TableColumn<AuditEntry>>>(
    () => [
      {
        key: 'created_at',
        header: 'When',
        width: '190px',
        render: (row) => <span className="u-nowrap">{dateTime(row.created_at)}</span>,
        sortValue: (row) => row.created_at,
      },
      {
        key: 'actor',
        header: 'Actor',
        width: '170px',
        render: (row) => row.actor_name || <span className="u-subtle">system</span>,
      },
      {
        key: 'action',
        header: 'Action',
        width: '140px',
        render: (row) => (
          <Badge tone={actionTone(row.action)} dot>
            {humanise(row.action)}
          </Badge>
        ),
      },
      {
        key: 'entity',
        header: 'Record',
        width: '190px',
        render: (row) => (
          <span className="cell-stack">
            <span className="cell-stack__primary">{humanise(row.entity)}</span>
            {row.entity_id !== '' ? (
              <span className="cell-stack__secondary">#{row.entity_id}</span>
            ) : null}
          </span>
        ),
        sortValue: (row) => row.entity,
      },
      {
        key: 'summary',
        header: 'What happened',
        render: (row) => row.summary || <span className="u-subtle">—</span>,
      },
    ],
    [dateTime],
  );

  /** Field-by-field comparison of the two JSON blobs, changed fields first. */
  const diffRows = useMemo<DiffRow[]>(
    () => (selected === null ? [] : diffFields(selected.old_value, selected.new_value)),
    [selected],
  );

  const diffColumns = useMemo<ReadonlyArray<TableColumn<DiffRow>>>(
    () => [
      {
        key: 'field',
        header: 'Field',
        render: (row) =>
          row.changed ? <strong>{humanise(row.field)}</strong> : humanise(row.field),
        sortValue: (row) => row.field,
      },
      { key: 'before', header: 'Before', render: (row) => row.before },
      {
        key: 'after',
        header: 'After',
        render: (row) => (row.changed ? <strong>{row.after}</strong> : row.after),
      },
    ],
    [],
  );

  const header = (
    <header className="page-header">
      <div className="page-header__heading">
        <h1 className="page-header__title">Audit log</h1>
        <p className="page-header__subtitle">
          {resource.loading
            ? 'Loading the trail…'
            : `${number(count)} ${count === 1 ? 'entry' : 'entries'} match the current filters.`}
        </p>
      </div>
      <div className="page-header__actions">
        {hasFilters ? <Button onClick={clearFilters}>Clear filters</Button> : null}
        <RefreshButton onClick={resource.reload} label="Reload" />
      </div>
    </header>
  );

  if (!canView) {
    return (
      <div className="module-page">
        {header}
        <Card>
          <EmptyState
            icon="lock"
            title="The audit trail needs audit.view"
            message="Your role can use the rest of the application, but reading the trail requires the audit.view permission. Ask an administrator if you need it."
          />
        </Card>
      </div>
    );
  }

  const toolbar = (
    <div className="toolbar-split">
      <div className="filter-bar__field" style={{ minWidth: 240 }}>
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            resetToFirstPage();
          }}
          placeholder="Summary, actor or record id"
          debounceMs={350}
        />
      </div>

      <Select<string>
        label="Record type"
        labelHidden
        small
        placeholder="All record types"
        options={(options.data?.entities ?? []).map((entry) => ({
          value: entry,
          label: humanise(entry),
        }))}
        value={entity}
        onChange={(value) => {
          setEntity(value);
          resetToFirstPage();
        }}
      />

      <Select<string>
        label="Action"
        labelHidden
        small
        placeholder="All actions"
        options={(options.data?.actions ?? []).map((entry) => ({
          value: entry,
          label: humanise(entry),
        }))}
        value={action}
        onChange={(value) => {
          setAction(value);
          resetToFirstPage();
        }}
      />

      <DateField
        label="From"
        labelHidden
        small
        value={dateFrom}
        max={dateTo === '' ? undefined : dateTo}
        onChange={(value) => {
          setDateFrom(value);
          resetToFirstPage();
        }}
      />

      <DateField
        label="To"
        labelHidden
        small
        value={dateTo}
        min={dateFrom === '' ? undefined : dateFrom}
        onChange={(value) => {
          setDateTo(value);
          resetToFirstPage();
        }}
      />

      <span className="toolbar-split__spacer" />
    </div>
  );

  return (
    <div className="module-page">
      {header}

      <Card flush>
        <Table<AuditEntry>
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          onRowClick={(row) => setSelected(row)}
          loading={resource.loading}
          error={resource.error}
          onRetry={resource.reload}
          paginated={false}
          dense
          stickyHeader
          toolbar={toolbar}
          emptyIcon="audit"
          emptyTitle="No audit entries found"
          emptyMessage={
            hasFilters
              ? 'Try widening the date range or clearing a filter.'
              : 'Actions worth recording will appear here as they happen.'
          }
          actions={(row) => (
            <Button
              size="sm"
              icon="eye"
              onClick={(event) => {
                event.stopPropagation();
                setSelected(row);
              }}
            >
              Details
            </Button>
          )}
          caption="Audit log"
          footer={
            <ServerPagination
              page={page}
              totalPages={totalPages}
              count={count}
              pageSize={pageSize}
              itemLabel="entries"
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                resetToFirstPage();
              }}
            />
          }
        />
      </Card>

      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        size="lg"
        title={selected === null ? '' : `${humanise(selected.action)} · ${humanise(selected.entity)}`}
        subtitle={selected === null ? undefined : dateTime(selected.created_at)}
        footer={<Button onClick={() => setSelected(null)}>Close</Button>}
      >
        {selected === null ? null : (
          <div className="u-stack" style={{ gap: 'var(--space-4)' }}>
            <div className="form-grid">
              <DataField label="Actor">{selected.actor_name || 'system'}</DataField>
              <DataField label="Record type">{humanise(selected.entity)}</DataField>
              <DataField label="Record id">{selected.entity_id || '—'}</DataField>
              <DataField label="When">{dateTime(selected.created_at)}</DataField>
              <DataField label="IP address">{selected.ip_address ?? '—'}</DataField>
              <DataField label="Summary">{selected.summary || '—'}</DataField>
            </div>

            {hasDiff(selected) ? (
              <Table<DiffRow>
                columns={diffColumns}
                rows={diffRows}
                rowKey={(row) => row.field}
                paginated={false}
                dense
                emptyTitle="No field changes recorded"
              />
            ) : (
              <p className="u-muted" style={{ margin: 0 }}>
                This action recorded no field changes — it is a milestone in the record's history
                rather than an edit (a sign-in, an approval, a payment), so there is no before and
                after to compare.
              </p>
            )}

            <p className="u-muted" style={{ margin: 0 }}>
              Entries in this trail are append-only and cannot be edited or deleted, by design.
              The date shown is {date(selected.created_at)}.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default AuditPage;
