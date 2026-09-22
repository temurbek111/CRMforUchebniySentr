/**
 * Rooms - the physical teaching spaces behind the timetable.
 *
 * A full CRUD screen over the existing data layer in ./api.ts (which reuses the
 * schedule module's read layer rather than rebuilding it):
 *
 *   GET    /api/rooms/          rooms.view    paginated; ?search, ?status
 *   POST   /api/rooms/          rooms.manage
 *   PATCH  /api/rooms/{id}/     rooms.manage
 *
 * Rooms are ARCHIVED, never deleted: schedule slots and groups point at a room,
 * so the row has to survive. The write that takes a room out of circulation is
 * `status = "archived"` - hence "Archive" (behind a confirmation), never a
 * "Delete" that would orphan the timetable.
 */

import { useMemo, useState, type FormEvent } from 'react';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Modal,
  SearchInput,
  Select,
  StatCard,
  StatusBadge,
  Table,
  TextField,
  type TableColumn,
} from '../../components';
import { useAuth } from '../../auth/AuthContext';
import { useSettings } from '../../settings/SettingsContext';
import { PERMISSIONS } from '../../types';
import type { Paginated } from '../../types';
import {
  RECORD_STATUS_OPTIONS,
  roomsCrudApi,
  type RecordStatus,
  type Room,
  type RoomWriteBody,
} from './api';
import {
  apiErrorMessages,
  fieldErrors,
  generalErrorMessages,
  useAsyncResource,
} from '../students/hooks';
import { FilterChips, InlineNote, RefreshButton, ServerPagination } from '../students/ui';

const DEFAULT_PAGE_SIZE = 25;

/** Sentinel for a caller without rooms.view, so no request is wasted. */
function emptyPage(pageSize: number): Paginated<Room> {
  return {
    count: 0,
    page: 1,
    page_size: pageSize,
    total_pages: 0,
    next: null,
    previous: null,
    results: [],
  };
}

interface RoomFormValues {
  name: string;
  /** Seats; kept as a string because the input is a text box. */
  capacity: string;
  location: string;
  equipment: string;
  status: RecordStatus;
}

const EMPTY_FORM: RoomFormValues = {
  name: '',
  capacity: '',
  location: '',
  equipment: '',
  status: 'active',
};

function formValuesFrom(room: Room): RoomFormValues {
  return {
    name: room.name,
    capacity: room.capacity > 0 ? String(room.capacity) : '',
    location: room.location,
    equipment: room.equipment,
    status:
      RECORD_STATUS_OPTIONS.find((option) => option.value === room.status)?.value ?? 'active',
  };
}

function buildPayload(values: RoomFormValues): RoomWriteBody {
  const capacity = values.capacity.trim();
  return {
    name: values.name.trim(),
    capacity: capacity === '' ? 0 : Number(capacity),
    location: values.location.trim(),
    equipment: values.equipment.trim(),
    status: values.status,
  };
}

interface RoomFormProps {
  formId: string;
  /** null = create. */
  room: Room | null;
  onSaved: (room: Room) => void;
}

/** The form body; the modal owns the header and the submit button. */
function RoomForm({ formId, room, onSaved }: RoomFormProps) {
  const [values, setValues] = useState<RoomFormValues>(() =>
    room === null ? EMPTY_FORM : formValuesFrom(room),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [localErrors, setLocalErrors] = useState<Record<string, string[]>>({});

  const set = <K extends keyof RoomFormValues>(key: K, value: RoomFormValues[K]): void => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const apiErrors = fieldErrors(error);
  const messagesFor = (field: string): string[] | undefined => {
    const remote = apiErrors[field];
    if (remote !== undefined && remote.length > 0) return remote;
    const local = localErrors[field];
    if (local !== undefined && local.length > 0) return local;
    return undefined;
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    const problems: Record<string, string[]> = {};
    if (values.name.trim() === '') problems.name = ['A room name is required.'];

    const capacity = values.capacity.trim();
    if (capacity !== '' && (!Number.isFinite(Number(capacity)) || Number(capacity) < 0)) {
      problems.capacity = ['Enter a whole number of seats, or leave it blank.'];
    }
    if (Object.keys(problems).length > 0) {
      setLocalErrors(problems);
      return;
    }

    setLocalErrors({});
    setSaving(true);
    setError(null);
    try {
      const payload = buildPayload(values);
      const saved =
        room === null
          ? await roomsCrudApi.create(payload)
          : await roomsCrudApi.update(room.id, payload);
      onSaved(saved);
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  };

  const generalMessages = generalErrorMessages(error);

  return (
    <form id={formId} className="u-stack" onSubmit={(event) => void submit(event)} noValidate>
      {generalMessages.length > 0 ? (
        <div className="alert alert--error" role="alert">
          <div className="alert__content">
            {generalMessages.length === 1 ? (
              <span>{generalMessages[0]}</span>
            ) : (
              <ul className="alert__list">
                {generalMessages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      <div className="form-grid">
        <TextField
          label="Name"
          value={values.name}
          onChange={(value) => set('name', value)}
          error={messagesFor('name')}
          hint="e.g. Room 101, Lab A."
          required
          autoFocus
        />
        <TextField
          label="Capacity (seats)"
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          value={values.capacity}
          onChange={(value) => set('capacity', value)}
          error={messagesFor('capacity')}
          hint="Used by the schedule to warn about over-capacity groups."
        />
        <TextField
          label="Location"
          value={values.location}
          onChange={(value) => set('location', value)}
          error={messagesFor('location')}
          hint="Floor, building or wing."
        />
        <Select<RecordStatus>
          label="Status"
          options={RECORD_STATUS_OPTIONS}
          value={values.status}
          onChange={(value) => {
            if (value !== '') set('status', value);
          }}
          error={messagesFor('status')}
        />
        <TextField
          label="Equipment"
          value={values.equipment}
          onChange={(value) => set('equipment', value)}
          error={messagesFor('equipment')}
          hint="Projector, whiteboard, computers…"
        />
      </div>

      {/* Keeps Enter-to-submit working while the real button lives in the footer. */}
      <button type="submit" className="visually-hidden" disabled={saving} tabIndex={-1}>
        Save
      </button>
    </form>
  );
}

interface RoomFormModalProps {
  open: boolean;
  room: Room | null;
  onClose: () => void;
  onSaved: (room: Room) => void;
}

function RoomFormModal({ open, room, onClose, onSaved }: RoomFormModalProps) {
  const formId = `room-form-${room?.id ?? 'new'}`;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={room === null ? 'New room' : `Edit ${room.name}`}
      subtitle={room === null ? 'Rooms can be archived later, never deleted.' : room.location || undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary">
            {room === null ? 'Create room' : 'Save changes'}
          </Button>
        </>
      }
    >
      {/* Remounting per record resets the form when a different row is edited. */}
      <RoomForm key={formId} formId={formId} room={room} onSaved={onSaved} />
    </Modal>
  );
}

export function RoomsPage() {
  const { hasPerm } = useAuth();
  const settings = useSettings();
  const canView = hasPerm(PERMISSIONS.ROOMS_VIEW);
  const canManage = hasPerm(PERMISSIONS.ROOMS_MANAGE);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Room | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Room | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const queryKey = [canView, search, status, page, pageSize].join('|');

  const resource = useAsyncResource(
    () =>
      canView
        ? roomsCrudApi.list({
            search: search.trim() === '' ? undefined : search.trim(),
            status: status === '' ? undefined : status,
            page,
            page_size: pageSize,
          })
        : Promise.resolve(emptyPage(pageSize)),
    queryKey,
  );

  // The whole room list feeds the KPI tiles; every count comes from the API.
  const catalog = useAsyncResource(
    () => (canView ? roomsCrudApi.all() : Promise.resolve([] as Room[])),
    `rooms-catalog|${canView}`,
  );
  const catalogRows = catalog.data ?? [];

  const counts = useMemo(() => {
    const totals: Record<RecordStatus, number> = { active: 0, inactive: 0, archived: 0 };
    for (const row of catalogRows) {
      if (row.status === 'active' || row.status === 'inactive' || row.status === 'archived') {
        totals[row.status] += 1;
      }
    }
    return totals;
  }, [catalogRows]);

  const rows = resource.data?.results ?? [];
  const count = resource.data?.count ?? 0;
  const totalPages = resource.data?.total_pages ?? 0;
  const hasFilters = search.trim() !== '' || status !== '';

  const reloadList = resource.reload;
  const reloadCatalog = catalog.reload;

  const resetToFirstPage = (): void => setPage(1);

  const openCreate = (): void => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (room: Room): void => {
    setEditing(room);
    setFormOpen(true);
  };

  const restore = async (room: Room): Promise<void> => {
    setBusyId(room.id);
    setActionError(null);
    try {
      await roomsCrudApi.setStatus(room.id, 'active');
      reloadList();
      reloadCatalog();
    } catch (cause) {
      setActionError(cause);
    } finally {
      setBusyId(null);
    }
  };

  const columns = useMemo<ReadonlyArray<TableColumn<Room>>>(
    () => [
      {
        key: 'name',
        header: 'Room',
        render: (row) => (
          <span className="cell-stack">
            <span className="cell-stack__primary">{row.name}</span>
            {row.location ? <span className="cell-stack__secondary">{row.location}</span> : null}
          </span>
        ),
        sortValue: (row) => row.name,
      },
      {
        key: 'capacity',
        header: 'Capacity',
        width: '120px',
        align: 'right',
        render: (row) =>
          row.capacity > 0 ? (
            <span className="u-nowrap">{settings.number(row.capacity)}</span>
          ) : (
            <span className="u-subtle">—</span>
          ),
        sortValue: (row) => row.capacity,
      },
      {
        key: 'equipment',
        header: 'Equipment',
        render: (row) => row.equipment || <span className="u-subtle">—</span>,
        sortValue: (row) => row.equipment,
      },
      {
        key: 'groups_count',
        header: 'Groups',
        width: '100px',
        align: 'right',
        render: (row) => settings.number(row.groups_count),
        sortValue: (row) => row.groups_count,
      },
      {
        key: 'status',
        header: 'Status',
        width: '120px',
        render: (row) => <StatusBadge status={row.status} />,
        sortValue: (row) => row.status,
      },
    ],
    [settings],
  );

  const header = (
    <header className="page-header">
      <div className="page-header__heading">
        <h1 className="page-header__title">Rooms</h1>
        <p className="page-header__subtitle">
          {resource.loading
            ? 'Loading rooms…'
            : `${settings.number(count)} ${count === 1 ? 'room' : 'rooms'} match the current filters.`}
        </p>
      </div>
      <div className="page-header__actions">
        <RefreshButton
          onClick={() => {
            reloadList();
            reloadCatalog();
          }}
          label="Reload"
        />
        {canManage ? (
          <Button variant="primary" icon="plus" onClick={openCreate}>
            New room
          </Button>
        ) : null}
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
            title="Rooms need rooms.view"
            message="Your role can use the rest of the application, but reading the room list requires the rooms.view permission. Ask an administrator if you need it."
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
          placeholder="Name, location or equipment"
          debounceMs={350}
        />
      </div>

      <span className="toolbar-split__spacer" />

      <FilterChips
        options={RECORD_STATUS_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
        }))}
        value={status}
        onChange={(value) => {
          setStatus(value);
          resetToFirstPage();
        }}
        allLabel="Any status"
        label="Filter rooms by status"
      />
    </div>
  );

  const actionMessages = apiErrorMessages(actionError);

  return (
    <div className="module-page">
      {header}

      <div className="kpi-grid">
        <StatCard
          label="Total rooms"
          value={settings.number(catalogRows.length)}
          icon="schedule"
          loading={catalog.loading}
        />
        <StatCard
          label="Active"
          value={settings.number(counts.active)}
          icon="checkCircle"
          loading={catalog.loading}
        />
        <StatCard
          label="Inactive"
          value={settings.number(counts.inactive)}
          icon="alertCircle"
          loading={catalog.loading}
        />
        <StatCard
          label="Archived"
          value={settings.number(counts.archived)}
          icon="inbox"
          loading={catalog.loading}
        />
      </div>

      {!canManage ? (
        <InlineNote tone="info">
          Your role can read the room list but not change it. Creating, editing and archiving rooms
          requires <strong>rooms.manage</strong>.
        </InlineNote>
      ) : null}

      {actionMessages.length > 0 ? (
        <InlineNote tone="error">
          {actionMessages.length === 1 ? (
            actionMessages[0]
          ) : (
            <ul className="u-stack">
              {actionMessages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
        </InlineNote>
      ) : null}

      <Card flush>
        <Table<Room>
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={resource.loading}
          error={resource.error}
          onRetry={reloadList}
          paginated={false}
          dense
          stickyHeader
          toolbar={toolbar}
          emptyIcon="schedule"
          emptyTitle="No rooms found"
          emptyMessage={
            hasFilters
              ? 'Try clearing the search box or the status chips.'
              : 'Rooms you add will appear here.'
          }
          emptyAction={
            canManage && !hasFilters ? (
              <Button variant="primary" icon="plus" onClick={openCreate}>
                New room
              </Button>
            ) : undefined
          }
          actions={
            canManage
              ? (row) => (
                  <div className="u-row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                    <Button
                      size="sm"
                      icon="edit"
                      onClick={(event) => {
                        event.stopPropagation();
                        openEdit(row);
                      }}
                    >
                      Edit
                    </Button>
                    {row.status === 'archived' ? (
                      <Button
                        size="sm"
                        icon="refresh"
                        loading={busyId === row.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          void restore(row);
                        }}
                      >
                        Restore
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          setArchiveTarget(row);
                        }}
                      >
                        Archive
                      </Button>
                    )}
                  </div>
                )
              : undefined
          }
          actionsHeader={canManage ? 'Actions' : ''}
          caption="Rooms"
          footer={
            <ServerPagination
              page={page}
              totalPages={totalPages}
              count={count}
              pageSize={pageSize}
              itemLabel="rooms"
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                resetToFirstPage();
              }}
            />
          }
        />
      </Card>

      <RoomFormModal
        open={formOpen}
        room={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          reloadList();
          reloadCatalog();
        }}
      />

      <ConfirmDialog
        open={archiveTarget !== null}
        title="Archive this room?"
        confirmLabel="Archive room"
        cancelLabel="Keep it active"
        tone="danger"
        message={
          archiveTarget === null ? null : (
            <div className="u-stack">
              <p className="u-muted" style={{ margin: 0 }}>
                <strong>{archiveTarget.name}</strong>
                {archiveTarget.location ? ` (${archiveTarget.location})` : ''} will be marked
                &ldquo;archived&rdquo; and hidden from the default room pickers.
              </p>
              <p className="u-muted" style={{ margin: 0 }}>
                It is not deleted: {settings.number(archiveTarget.groups_count)}{' '}
                {archiveTarget.groups_count === 1 ? 'group' : 'groups'} and the schedule slots that
                use it keep pointing at it. You can restore it at any time.
              </p>
            </div>
          )
        }
        onCancel={() => setArchiveTarget(null)}
        onConfirm={async () => {
          const target = archiveTarget;
          if (target === null) return;
          await roomsCrudApi.setStatus(target.id, 'archived');
          setArchiveTarget(null);
          reloadList();
          reloadCatalog();
        }}
      />
    </div>
  );
}

export default RoomsPage;
