/**
 * Groups: the list of every class the centre runs.
 *
 * Filtering, searching and paging are all server-side (the API is the source of
 * truth for what matches), and the roster size against capacity is rendered from
 * the server's own `student_count` / `capacity`, never recomputed here.
 */

import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  SearchInput,
  Select,
  StatusBadge,
  Table,
  type SelectOption,
  type TableColumn,
} from '../../components';
import { useAuth } from '../../auth/AuthContext';
import { useSettings } from '../../settings/SettingsContext';
import { PERMISSIONS } from '../../types';
import {
  GROUP_STATUS_OPTIONS,
  groupsApi,
  toNumber,
  type Group,
  type GroupListParams,
  type GroupStatus,
} from '../students/api';
import { useAsyncResource, useReferenceData } from '../students/hooks';
import { FilterChips, ServerPagination, UtilisationBar } from '../students/ui';
import { GroupFormModal } from './groupForms';

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

export function GroupsListPage() {
  const navigate = useNavigate();
  const settings = useSettings();
  const { hasPerm } = useAuth();
  const reference = useReferenceData();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [course, setCourse] = useState<number | ''>('');
  const [teacher, setTeacher] = useState<number | ''>('');
  const [room, setRoom] = useState<number | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);
  const [showCreate, setShowCreate] = useState(false);

  const params: GroupListParams = {
    search: search.trim() === '' ? undefined : search.trim(),
    status: status === '' ? undefined : status,
    course: course === '' ? undefined : course,
    teacher: teacher === '' ? undefined : teacher,
    room: room === '' ? undefined : room,
    page,
    page_size: pageSize,
    ordering: 'name',
  };
  // The key carries every filter so a change always refetches.
  const resource = useAsyncResource(
    () => groupsApi.list(params),
    `groups:${JSON.stringify(params)}`,
  );

  const canManage = hasPerm(PERMISSIONS.GROUPS_MANAGE);
  const groups = resource.data?.results ?? [];

  const resetToFirstPage = useCallback(() => setPage(1), []);

  const columns: ReadonlyArray<TableColumn<Group>> = [
    {
      key: 'name',
      header: 'Group',
      render: (row) => (
        <>
          <div className="u-row u-row--between" style={{ gap: 8 }}>
            <Link className="link" to={`/groups/${row.id}`}>
              {row.name}
            </Link>
            <StatusBadge status={row.status} />
          </div>
          {row.level ? (
            <div className="u-muted" style={{ fontSize: '0.875em' }}>
              {row.course_name} · {row.level}
            </div>
          ) : null}
        </>
      ),
    },
    { key: 'course_name', header: 'Course', render: (row) => row.course_name || '—' },
    { key: 'teacher_name', header: 'Teacher', render: (row) => row.teacher_name || '—' },
    { key: 'room_name', header: 'Room', render: (row) => row.room_name || '—' },
    {
      key: 'occupancy',
      header: 'Students',
      render: (row) => <UtilisationBar enrolled={row.student_count} capacity={row.capacity} />,
    },
    {
      key: 'monthly_fee',
      header: 'Fee',
      align: 'right',
      render: (row) =>
        row.monthly_fee === null ? '—' : settings.money(toNumber(row.monthly_fee)),
    },
    {
      key: 'schedule_summary',
      header: 'Schedule',
      render: (row) => row.schedule_summary || '—',
    },
  ];

  return (
    <>
      <header className="page-header">
        <div className="page-header__heading">
          <h1 className="page-header__title">Groups</h1>
          <p className="page-header__subtitle">
            Every class the centre runs — who teaches it, where, when, and how full it is.
          </p>
        </div>
        <div className="page-header__actions">
          {canManage ? (
            <Button variant="primary" icon="plus" onClick={() => setShowCreate(true)}>
              New group
            </Button>
          ) : null}
        </div>
      </header>

      <Card>
        <div className="filter-bar">
          <div className="filter-bar__field">
            <SearchInput
              value={search}
              onChange={(value) => {
                setSearch(value);
                resetToFirstPage();
              }}
              placeholder="Search by group or course…"
              label="Search groups"
            />
          </div>
          <div className="filter-bar__field">
            <Select<number>
              label="Course"
              placeholder="All courses"
              value={course}
              onChange={(value) => {
                setCourse(value);
                resetToFirstPage();
              }}
              options={reference.data?.courses.map(
                (item): SelectOption<number> => ({ value: item.id, label: item.name }),
              ) ?? []}
            />
          </div>
          <div className="filter-bar__field">
            <Select<number>
              label="Teacher"
              placeholder="All teachers"
              value={teacher}
              onChange={(value) => {
                setTeacher(value);
                resetToFirstPage();
              }}
              options={reference.data?.teachers.map(
                (item): SelectOption<number> => ({ value: item.id, label: item.full_name }),
              ) ?? []}
            />
          </div>
          <div className="filter-bar__field">
            <Select<number>
              label="Room"
              placeholder="All rooms"
              value={room}
              onChange={(value) => {
                setRoom(value);
                resetToFirstPage();
              }}
              options={reference.data?.rooms.map(
                (item): SelectOption<number> => ({ value: item.id, label: item.name }),
              ) ?? []}
            />
          </div>
        </div>

        <FilterChips
          options={GROUP_STATUS_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
          value={status}
          onChange={(value) => {
            setStatus(value as GroupStatus | '');
            resetToFirstPage();
          }}
          allLabel="All statuses"
          label="Filter by group status"
        />

        {resource.loading && resource.data === null ? (
          <LoadingState label="Loading groups…" />
        ) : resource.error !== null ? (
          <ErrorState error={resource.error} onRetry={resource.reload} />
        ) : groups.length === 0 ? (
          <EmptyState
            title="No groups match these filters"
            message="Clear the filters, or create the first group for this course."
            icon="groups"
            action={
              canManage ? (
                <Button variant="primary" icon="plus" onClick={() => setShowCreate(true)}>
                  New group
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <Table
              columns={columns}
              rows={groups}
              rowKey={(row) => row.id}
              onRowClick={(row) => navigate(`/groups/${row.id}`)}
            />
            <ServerPagination
              page={resource.data?.page ?? page}
              totalPages={resource.data?.total_pages ?? 1}
              count={resource.data?.count ?? 0}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
              itemLabel="groups"
            />
          </>
        )}
      </Card>

      <GroupFormModal
        open={showCreate}
        mode="create"
        onClose={() => setShowCreate(false)}
        onSaved={() => {
          setShowCreate(false);
          resource.reload();
        }}
      />
    </>
  );
}
