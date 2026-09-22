/**
 * Courses - the academic catalogue behind groups, memberships and invoices.
 *
 * A full CRUD screen over the existing data layer in ./api.ts:
 *
 *   GET    /api/courses/          courses.view    paginated; ?search, ?status, ?level
 *   POST   /api/courses/          courses.manage
 *   PATCH  /api/courses/{id}/     courses.manage
 *
 * Courses are ARCHIVED, never deleted: groups, memberships, invoices and the
 * audit trail all reference a course, so the row must survive. The only write
 * that removes a course from circulation is `status = "archived"`, which is why
 * the row action is "Archive" (behind a confirmation) rather than "Delete".
 *
 * Money never leaves as a number: `default_monthly_fee` is sent as the exact
 * string the user typed (the serializer owns the decimal type), and read back
 * through the settings-aware formatter so the currency is never hardcoded here.
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
  coursesApi,
  toNumber,
  type Course,
  type CourseWriteBody,
  type RecordStatus,
} from './api';
import {
  apiErrorMessages,
  fieldErrors,
  generalErrorMessages,
  useAsyncResource,
} from '../students/hooks';
import { FilterChips, InlineNote, RefreshButton, ServerPagination } from '../students/ui';

const DEFAULT_PAGE_SIZE = 25;

/** Sentinel for a caller without courses.view, so no request is wasted. */
function emptyPage(pageSize: number): Paginated<Course> {
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

const EMPTY_FORM: CourseFormValues = {
  code: '',
  name: '',
  description: '',
  level: '',
  default_monthly_fee: '',
  duration_months: '',
  status: 'active',
};

interface CourseFormValues {
  code: string;
  name: string;
  description: string;
  /** Free text: `Course.level` is a plain CharField, not a choice list. */
  level: string;
  /** Kept as the raw string the user typed, exactly as the API expects it. */
  default_monthly_fee: string;
  duration_months: string;
  status: RecordStatus;
}

function formValuesFrom(course: Course): CourseFormValues {
  return {
    code: course.code,
    name: course.name,
    description: course.description,
    level: course.level,
    default_monthly_fee: course.default_monthly_fee ?? '',
    duration_months: course.duration_months > 0 ? String(course.duration_months) : '',
    status:
      RECORD_STATUS_OPTIONS.find((option) => option.value === course.status)?.value ?? 'active',
  };
}

/**
 * Build the PATCH/POST body from the raw form values. The fee is forwarded
 * verbatim (never parsed and re-serialised) so no rounding happens here.
 */
function buildPayload(values: CourseFormValues): CourseWriteBody {
  const fee = values.default_monthly_fee.trim();
  const months = values.duration_months.trim();
  return {
    code: values.code.trim(),
    name: values.name.trim(),
    description: values.description.trim(),
    level: values.level.trim(),
    default_monthly_fee: fee === '' ? null : fee,
    duration_months: months === '' ? undefined : Number(months),
    status: values.status,
  };
}

interface CourseFormProps {
  formId: string;
  /** null = create. */
  course: Course | null;
  onSaved: (course: Course) => void;
}

/** The form body; the modal owns the header and the submit button. */
function CourseForm({ formId, course, onSaved }: CourseFormProps) {
  const [values, setValues] = useState<CourseFormValues>(() =>
    course === null ? EMPTY_FORM : formValuesFrom(course),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [localErrors, setLocalErrors] = useState<Record<string, string[]>>({});

  const set = <K extends keyof CourseFormValues>(key: K, value: CourseFormValues[K]): void => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const apiErrors = fieldErrors(error);
  // The server's verdict wins; the client-side required checks are a fallback.
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
    if (values.code.trim() === '') problems.code = ['A course code is required.'];
    if (values.name.trim() === '') problems.name = ['A course name is required.'];

    const fee = values.default_monthly_fee.trim();
    if (fee !== '' && !Number.isFinite(Number(fee))) {
      problems.default_monthly_fee = ['Enter an amount such as 150000 or 150000.00.'];
    }
    const months = values.duration_months.trim();
    if (months !== '' && (!Number.isFinite(Number(months)) || Number(months) < 0)) {
      problems.duration_months = ['Enter a whole number of months, or leave it blank.'];
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
        course === null
          ? await coursesApi.create(payload)
          : await coursesApi.update(course.id, payload);
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
          label="Code"
          value={values.code}
          onChange={(value) => set('code', value)}
          error={messagesFor('code')}
          hint="A short identifier, e.g. ENG-A1."
          required
          autoFocus
        />
        <TextField
          label="Name"
          value={values.name}
          onChange={(value) => set('name', value)}
          error={messagesFor('name')}
          required
        />
        <TextField
          label="Level"
          value={values.level}
          onChange={(value) => set('level', value)}
          error={messagesFor('level')}
          hint="Free text, e.g. Beginner, A2, Grade 9."
        />
        <TextField
          label="Duration (months)"
          type="number"
          min="0"
          step="1"
          value={values.duration_months}
          onChange={(value) => set('duration_months', value)}
          error={messagesFor('duration_months')}
        />
        <TextField
          label="Default monthly fee"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={values.default_monthly_fee}
          onChange={(value) => set('default_monthly_fee', value)}
          error={messagesFor('default_monthly_fee')}
          hint="Sent to the server exactly as typed. Leave blank for no default."
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
          label="Description"
          value={values.description}
          onChange={(value) => set('description', value)}
          error={messagesFor('description')}
        />
      </div>

      {/* Keeps Enter-to-submit working while the real button lives in the footer. */}
      <button type="submit" className="visually-hidden" disabled={saving} tabIndex={-1}>
        Save
      </button>
    </form>
  );
}

interface CourseFormModalProps {
  open: boolean;
  course: Course | null;
  onClose: () => void;
  onSaved: (course: Course) => void;
}

function CourseFormModal({ open, course, onClose, onSaved }: CourseFormModalProps) {
  const formId = `course-form-${course?.id ?? 'new'}`;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={course === null ? 'New course' : `Edit ${course.name}`}
      subtitle={course === null ? 'Courses can be archived later, never deleted.' : course.code}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary">
            {course === null ? 'Create course' : 'Save changes'}
          </Button>
        </>
      }
    >
      {/* Remounting per record resets the form when a different row is edited. */}
      <CourseForm key={formId} formId={formId} course={course} onSaved={onSaved} />
    </Modal>
  );
}

export function CoursesPage() {
  const { hasPerm } = useAuth();
  const settings = useSettings();
  const canView = hasPerm(PERMISSIONS.COURSES_VIEW);
  const canManage = hasPerm(PERMISSIONS.COURSES_MANAGE);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [level, setLevel] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Course | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Course | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const queryKey = [canView, search, status, level, page, pageSize].join('|');

  const resource = useAsyncResource(
    () =>
      canView
        ? coursesApi.list({
            search: search.trim() === '' ? undefined : search.trim(),
            status: status === '' ? undefined : status,
            level: level === '' ? undefined : level,
            page,
            page_size: pageSize,
          })
        : Promise.resolve(emptyPage(pageSize)),
    queryKey,
  );

  // The whole catalogue feeds the KPI tiles and the (free-text) level filter,
  // so no option the API would reject can be offered.
  const catalog = useAsyncResource(
    () => (canView ? coursesApi.all() : Promise.resolve([] as Course[])),
    `courses-catalog|${canView}`,
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

  const levelOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const row of catalogRows) {
      const value = row.level.trim();
      if (value !== '') unique.add(value);
    }
    return [...unique]
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value }));
  }, [catalogRows]);

  const rows = resource.data?.results ?? [];
  const count = resource.data?.count ?? 0;
  const totalPages = resource.data?.total_pages ?? 0;
  const hasFilters = search.trim() !== '' || status !== '' || level !== '';

  const reloadList = resource.reload;
  const reloadCatalog = catalog.reload;

  const resetToFirstPage = (): void => setPage(1);

  const openCreate = (): void => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (course: Course): void => {
    setEditing(course);
    setFormOpen(true);
  };

  const restore = async (course: Course): Promise<void> => {
    setBusyId(course.id);
    setActionError(null);
    try {
      await coursesApi.setStatus(course.id, 'active');
      reloadList();
      reloadCatalog();
    } catch (cause) {
      setActionError(cause);
    } finally {
      setBusyId(null);
    }
  };

  const columns = useMemo<ReadonlyArray<TableColumn<Course>>>(
    () => [
      {
        key: 'code',
        header: 'Code',
        width: '120px',
        render: (row) => <span className="u-nowrap">{row.code}</span>,
        sortValue: (row) => row.code,
      },
      {
        key: 'name',
        header: 'Course',
        render: (row) => (
          <span className="cell-stack">
            <span className="cell-stack__primary">{row.name}</span>
            {row.description ? (
              <span className="cell-stack__secondary">{row.description}</span>
            ) : null}
          </span>
        ),
        sortValue: (row) => row.name,
      },
      {
        key: 'level',
        header: 'Level',
        width: '140px',
        render: (row) => row.level || <span className="u-subtle">—</span>,
        sortValue: (row) => row.level,
      },
      {
        key: 'duration_months',
        header: 'Duration',
        width: '120px',
        align: 'right',
        render: (row) =>
          row.duration_months > 0 ? (
            <span className="u-nowrap">{`${settings.number(row.duration_months)} mo`}</span>
          ) : (
            <span className="u-subtle">—</span>
          ),
        sortValue: (row) => row.duration_months,
      },
      {
        key: 'default_monthly_fee',
        header: 'Monthly fee',
        width: '150px',
        align: 'right',
        render: (row) =>
          row.default_monthly_fee === null ? (
            <span className="u-subtle">—</span>
          ) : (
            <span className="u-nowrap">{settings.money(toNumber(row.default_monthly_fee))}</span>
          ),
        sortValue: (row) => toNumber(row.default_monthly_fee),
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
        <h1 className="page-header__title">Courses</h1>
        <p className="page-header__subtitle">
          {resource.loading
            ? 'Loading courses…'
            : `${settings.number(count)} ${count === 1 ? 'course' : 'courses'} match the current filters.`}
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
            New course
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
            title="Courses need courses.view"
            message="Your role can use the rest of the application, but reading the course catalogue requires the courses.view permission. Ask an administrator if you need it."
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
          placeholder="Name, code or level"
          debounceMs={350}
        />
      </div>

      <Select<string>
        label="Level"
        labelHidden
        small
        placeholder="All levels"
        options={levelOptions}
        value={level}
        onChange={(value) => {
          setLevel(value);
          resetToFirstPage();
        }}
      />

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
        label="Filter courses by status"
      />
    </div>
  );

  const actionMessages = apiErrorMessages(actionError);

  return (
    <div className="module-page">
      {header}

      <div className="kpi-grid">
        <StatCard
          label="Total courses"
          value={settings.number(catalogRows.length)}
          icon="academic"
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
          Your role can read the catalogue but not change it. Creating, editing and archiving courses
          requires <strong>courses.manage</strong>.
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
        <Table<Course>
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
          emptyIcon="academic"
          emptyTitle="No courses found"
          emptyMessage={
            hasFilters
              ? 'Try clearing the search box, the level filter or the status chips.'
              : 'Courses you add will appear here.'
          }
          emptyAction={
            canManage && !hasFilters ? (
              <Button variant="primary" icon="plus" onClick={openCreate}>
                New course
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
          caption="Courses"
          footer={
            <ServerPagination
              page={page}
              totalPages={totalPages}
              count={count}
              pageSize={pageSize}
              itemLabel="courses"
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                resetToFirstPage();
              }}
            />
          }
        />
      </Card>

      <CourseFormModal
        open={formOpen}
        course={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          reloadList();
          reloadCatalog();
        }}
      />

      <ConfirmDialog
        open={archiveTarget !== null}
        title="Archive this course?"
        confirmLabel="Archive course"
        cancelLabel="Keep it active"
        tone="danger"
        message={
          archiveTarget === null ? null : (
            <div className="u-stack">
              <p className="u-muted" style={{ margin: 0 }}>
                <strong>{archiveTarget.name}</strong> ({archiveTarget.code}) will be marked
                &ldquo;archived&rdquo; and hidden from the default course pickers.
              </p>
              <p className="u-muted" style={{ margin: 0 }}>
                It is not deleted: {settings.number(archiveTarget.groups_count)}{' '}
                {archiveTarget.groups_count === 1 ? 'group' : 'groups'}, the memberships, invoices and
                the audit trail keep pointing at it. You can restore it at any time.
              </p>
            </div>
          )
        }
        onCancel={() => setArchiveTarget(null)}
        onConfirm={async () => {
          const target = archiveTarget;
          if (target === null) return;
          await coursesApi.setStatus(target.id, 'archived');
          setArchiveTarget(null);
          reloadList();
          reloadCatalog();
        }}
      />
    </div>
  );
}

export default CoursesPage;
