/**
 * Students list: search, status chips, course/group/teacher filters and
 * server-side pagination over GET /api/students/.
 *
 * Every row comes from the API; nothing is derived locally except the display
 * formatting (settings-aware money/date formatters).
 */

import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Card,
  Icon,
  SearchInput,
  Select,
  StatusBadge,
  Table,
  type TableColumn,
} from '../../components';
import { useAuth } from '../../auth/AuthContext';
import { useSettings } from '../../settings/SettingsContext';
import {
  groupsApi,
  studentsApi,
  toNumber,
  STUDENT_STATUS_OPTIONS,
  type Group,
  type StudentListItem,
} from './api';
import { useAsyncResource, useReferenceData } from './hooks';
import {
  Avatar,
  FilterChips,
  RefreshButton,
  ServerPagination,
} from './ui';
import { StudentFormModal } from './studentForms';

const DEFAULT_PAGE_SIZE = 25;

export function StudentsListPage() {
  const navigate = useNavigate();
  const { hasPerm } = useAuth();
  const settings = useSettings();
  const canManage = hasPerm('students.manage');

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [course, setCourse] = useState<number | ''>('');
  const [group, setGroup] = useState<number | ''>('');
  const [teacher, setTeacher] = useState<number | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [formOpen, setFormOpen] = useState(false);

  const reference = useReferenceData();
  const courses = reference.data?.courses ?? [];
  const teachers = reference.data?.teachers ?? [];

  // Group filter options. Requires `groups.view`; a student-only role simply
  // gets no group filter instead of a broken page.
  const groupOptionsResource = useAsyncResource<Group[]>(
    async () => {
      try {
        const response = await groupsApi.list({ page_size: 200 });
        return response.results;
      } catch {
        return [];
      }
    },
    'student-group-options',
  );
  const groupOptions = groupOptionsResource.data ?? [];

  const queryKey = [
    search,
    status,
    course,
    group,
    teacher,
    page,
    pageSize,
  ].join('|');

  const resource = useAsyncResource(
    () =>
      studentsApi.list({
        search: search.trim() === '' ? undefined : search.trim(),
        status: status === '' ? undefined : status,
        course: course === '' ? undefined : course,
        group: group === '' ? undefined : group,
        teacher: teacher === '' ? undefined : teacher,
        page,
        page_size: pageSize,
      }),
    queryKey,
  );

  const rows = resource.data?.results ?? [];
  const count = resource.data?.count ?? 0;
  const totalPages = resource.data?.total_pages ?? 0;

  /** Any filter change restarts at page one (otherwise the page can be empty). */
  const resetToFirstPage = useCallback((): void => setPage(1), []);

  const columns = useMemo<ReadonlyArray<TableColumn<StudentListItem>>>(
    () => [
      {
        key: 'code',
        header: 'Code',
        width: '96px',
        render: (row) => <span className="u-mono">{row.code}</span>,
      },
      {
        key: 'name',
        header: 'Student',
        render: (row) => (
          <span className="cell-name">
            <Avatar name={row.full_name} photo={row.photo} size="sm" />
            <button
              type="button"
              className="row-link"
              onClick={(event) => {
                event.stopPropagation();
                navigate(`/students/${row.id}`);
              }}
            >
              {row.full_name}
            </button>
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        width: '110px',
        render: (row) => <StatusBadge status={row.status} />,
      },
      {
        key: 'phone',
        header: 'Phone',
        width: '130px',
        render: (row) => row.phone || <span className="u-subtle">—</span>,
      },
      {
        key: 'guardian',
        header: 'Guardian',
        render: (row) =>
          row.parent_name || row.parent_phone ? (
            <span className="cell-stack">
              <span className="cell-stack__primary">{row.parent_name || '—'}</span>
              {row.parent_phone ? (
                <span className="cell-stack__secondary">{row.parent_phone}</span>
              ) : null}
            </span>
          ) : (
            <span className="u-subtle">—</span>
          ),
      },
      {
        key: 'group',
        header: 'Group',
        render: (row) => row.group_name || <span className="u-subtle">—</span>,
      },
      {
        key: 'course',
        header: 'Course',
        render: (row) => row.course_name || <span className="u-subtle">—</span>,
      },
      {
        key: 'teacher',
        header: 'Teacher',
        render: (row) => row.teacher_name || <span className="u-subtle">—</span>,
      },
      {
        key: 'fee',
        header: 'Monthly fee',
        align: 'right',
        width: '130px',
        render: (row) => (
          <span className="u-nowrap">{settings.money(toNumber(row.monthly_fee))}</span>
        ),
      },
      {
        key: 'registered_at',
        header: 'Registered',
        width: '120px',
        render: (row) => <span className="u-nowrap">{settings.date(row.registered_at)}</span>,
      },
    ],
    [navigate, settings],
  );

  const toolbar = (
    <div className="toolbar-split">
      <div className="filter-bar__field" style={{ minWidth: 240 }}>
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            resetToFirstPage();
          }}
          placeholder="Name, code, phone or email"
          debounceMs={350}
        />
      </div>

      <Select<number>
        label="Course"
        labelHidden
        small
        placeholder="All courses"
        options={courses.map((entry) => ({ value: entry.id, label: entry.name }))}
        value={course}
        onChange={(value) => {
          setCourse(value);
          resetToFirstPage();
        }}
      />

      <Select<number>
        label="Group"
        labelHidden
        small
        placeholder="All groups"
        options={groupOptions.map((entry) => ({ value: entry.id, label: entry.name }))}
        value={group}
        onChange={(value) => {
          setGroup(value);
          resetToFirstPage();
        }}
      />

      <Select<number>
        label="Teacher"
        labelHidden
        small
        placeholder="All teachers"
        options={teachers.map((entry) => ({ value: entry.id, label: entry.full_name }))}
        value={teacher}
        onChange={(value) => {
          setTeacher(value);
          resetToFirstPage();
        }}
      />

      <span className="toolbar-split__spacer" />

      <FilterChips
        options={STUDENT_STATUS_OPTIONS.map((entry) => ({
          value: entry.value,
          label: entry.label,
        }))}
        value={status}
        onChange={(value) => {
          setStatus(value);
          resetToFirstPage();
        }}
        allLabel="Any status"
        label="Filter students by status"
      />

      <RefreshButton onClick={resource.reload} label="Reload" />
    </div>
  );

  return (
    <div className="module-page">
      <header className="page-header">
        <div className="page-header__heading">
          <h1 className="page-header__title">Students</h1>
          <p className="page-header__subtitle">
            {resource.loading
              ? 'Loading students…'
              : `${settings.number(count)} ${count === 1 ? 'student' : 'students'} match the current filters.`}
          </p>
        </div>
        {canManage ? (
          <div className="page-header__actions">
            <Button variant="primary" icon="plus" onClick={() => setFormOpen(true)}>
              New student
            </Button>
          </div>
        ) : null}
      </header>

      <Card flush>
        <Table<StudentListItem>
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          onRowClick={(row) => navigate(`/students/${row.id}`)}
          loading={resource.loading}
          error={resource.error}
          onRetry={resource.reload}
          paginated={false}
          dense
          stickyHeader
          toolbar={toolbar}
          emptyIcon="students"
          emptyTitle="No students found"
          emptyMessage={
            search.trim() !== '' || status !== '' || course !== '' || group !== '' || teacher !== ''
              ? 'Try clearing the search box or one of the filters.'
              : 'Students you add will appear here.'
          }
          emptyAction={
            canManage && search.trim() === '' ? (
              <Button variant="primary" icon="plus" onClick={() => setFormOpen(true)}>
                New student
              </Button>
            ) : undefined
          }
          actions={
            canManage
              ? (row) => (
                  <Button
                    size="sm"
                    icon="edit"
                    onClick={(event) => {
                      event.stopPropagation();
                      navigate(`/students/${row.id}`);
                    }}
                  >
                    Open
                  </Button>
                )
              : undefined
          }
          actionsHeader={canManage ? <Icon name="settings" size={14} /> : ''}
          caption="Students"
          footer={
            <ServerPagination
              page={page}
              totalPages={totalPages}
              count={count}
              pageSize={pageSize}
              itemLabel="students"
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                resetToFirstPage();
              }}
            />
          }
        />
      </Card>

      <StudentFormModal
        open={formOpen}
        mode="create"
        onClose={() => setFormOpen(false)}
        onSaved={(student) => {
          setFormOpen(false);
          navigate(`/students/${student.id}`);
        }}
      />
    </div>
  );
}

export default StudentsListPage;
