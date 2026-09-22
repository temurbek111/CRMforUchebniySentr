import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Badge, StatusBadge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DateField } from '../../components/DateField';
import { Modal } from '../../components/Modal';
import { Pagination } from '../../components/Pagination';
import { SearchInput } from '../../components/SearchInput';
import { Select } from '../../components/Select';
import { Table, type TableColumn } from '../../components/Table';
import { TextField } from '../../components/TextField';
import { useSettings } from '../../settings/SettingsContext';
import { PERMISSIONS, type QueryParams } from '../../types';
import { toIsoDate } from '../../utils/format';
import { teacherApi, type TeacherRow, type TeacherWritePayload } from './api';
import {
  EMPLOYMENT_TYPES,
  TEACHER_STATUSES,
  fieldErrorsOf,
  labelFor,
  messageLines,
  useMutation,
  useQueryData,
  type Option,
} from '../finance/shared';

const PAGE_SIZE = 25;

const ACCOUNT_FILTERS: ReadonlyArray<Option> = [
  { value: 'yes', label: 'Has login account' },
  { value: 'no', label: 'No login account' },
];

type Dialog =
  | { kind: 'none' }
  | { kind: 'form'; teacher: TeacherRow | null }
  | { kind: 'archive'; teacher: TeacherRow };

/**
 * Teacher directory: staff records plus the optional link to a login account
 * (username + password are validated by the API, whose messages are shown
 * inline next to the field).
 */
export function TeachersListPage() {
  const { hasPerm } = useAuth();
  const { date } = useSettings();
  const canManage = hasPerm(PERMISSIONS.TEACHERS_MANAGE);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [employmentType, setEmploymentType] = useState('');
  const [hasAccount, setHasAccount] = useState('');
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' });

  const params = useMemo<QueryParams>(
    () => ({
      page,
      page_size: PAGE_SIZE,
      ordering: 'first_name',
      search: search.trim() === '' ? undefined : search.trim(),
      status: status === '' ? undefined : status,
      employment_type: employmentType === '' ? undefined : employmentType,
      has_account: hasAccount === '' ? undefined : hasAccount === 'yes',
    }),
    [page, search, status, employmentType, hasAccount],
  );

  const teachers = useQueryData(
    (signal) => teacherApi.teachers.list(params, signal),
    [page, search, status, employmentType, hasAccount, refreshKey],
  );

  const rows = teachers.data?.results ?? [];

  const columns: ReadonlyArray<TableColumn<TeacherRow>> = [
    {
      key: 'name',
      header: 'Teacher',
      render: (row) => (
        <div className="u-stack" style={{ gap: 0 }}>
          <Link to={`/teachers/${row.id}`}>{row.full_name}</Link>
          <span className="u-subtle">{row.email || '—'}</span>
        </div>
      ),
    },
    {
      key: 'specialization',
      header: 'Specialization',
      render: (row) => row.specialization || <span className="u-subtle">—</span>,
    },
    {
      key: 'employment_type',
      header: 'Employment',
      render: (row) => labelFor(EMPLOYMENT_TYPES, row.employment_type),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'groups_count',
      header: 'Groups',
      align: 'right',
      render: (row) => String(row.groups_count),
    },
    {
      key: 'account',
      header: 'Login',
      render: (row) =>
        row.has_account ? (
          <Badge tone="success" dot>
            Linked
          </Badge>
        ) : (
          <Badge tone="neutral">None</Badge>
        ),
    },
    {
      key: 'phone',
      header: 'Phone',
      render: (row) => row.phone || <span className="u-subtle">—</span>,
    },
    {
      key: 'start_date',
      header: 'Started',
      render: (row) => date(row.start_date),
    },
  ];

  return (
    <div className="u-stack" style={{ gap: 'var(--space-5)' }}>
      <header className="page-header">
        <div className="page-header__heading">
          <h1 className="page-header__title">Teachers</h1>
          <p className="page-header__subtitle">
            Teaching staff, their groups and their optional login account.
          </p>
        </div>
        <div className="page-header__actions">
          {canManage ? (
            <Button
              variant="primary"
              icon="plus"
              onClick={() => setDialog({ kind: 'form', teacher: null })}
            >
              Add teacher
            </Button>
          ) : null}
        </div>
      </header>

      <Card flush>
        <div className="filter-bar">
          <div className="filter-bar__field u-grow">
            <SearchInput
              small
              value={search}
              onChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
              placeholder="Name, phone, email or specialization"
              label="Search teachers"
            />
          </div>
          <div className="filter-bar__field">
            <Select
              small
              label="Status"
              placeholder="All statuses"
              options={TEACHER_STATUSES}
              value={status}
              onChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
            />
          </div>
          <div className="filter-bar__field">
            <Select
              small
              label="Employment"
              placeholder="All types"
              options={EMPLOYMENT_TYPES}
              value={employmentType}
              onChange={(value) => {
                setEmploymentType(value);
                setPage(1);
              }}
            />
          </div>
          <div className="filter-bar__field">
            <Select
              small
              label="Account"
              placeholder="Any"
              options={ACCOUNT_FILTERS}
              value={hasAccount}
              onChange={(value) => {
                setHasAccount(value);
                setPage(1);
              }}
            />
          </div>
        </div>

        <Table<TeacherRow>
          paginated={false}
          stickyHeader
          rows={rows}
          rowKey={(row) => row.id}
          columns={columns}
          loading={teachers.loading && teachers.data === null}
          error={teachers.error}
          onRetry={teachers.reload}
          emptyIcon="teachers"
          emptyTitle="No teachers match these filters"
          emptyMessage="Adjust the search or filters, or add a teacher."
          caption="Teachers"
          actions={
            canManage
              ? (row) => (
                  <div className="u-row" style={{ justifyContent: 'flex-end' }}>
                    <Button
                      size="sm"
                      icon="edit"
                      onClick={() => setDialog({ kind: 'form', teacher: row })}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={row.status === 'archived'}
                      onClick={() => setDialog({ kind: 'archive', teacher: row })}
                    >
                      Archive
                    </Button>
                  </div>
                )
              : undefined
          }
          footer={
            teachers.data !== null && teachers.data.count > 0 ? (
              <Pagination
                page={teachers.data.page}
                totalPages={teachers.data.total_pages}
                totalItems={teachers.data.count}
                pageSize={teachers.data.page_size}
                itemLabel="teachers"
                onPageChange={setPage}
              />
            ) : undefined
          }
        />
      </Card>

      {dialog.kind === 'form' ? (
        <TeacherFormDialog
          teacher={dialog.teacher}
          onClose={() => setDialog({ kind: 'none' })}
          onSaved={() => {
            setRefreshKey((value) => value + 1);
            setDialog({ kind: 'none' });
          }}
        />
      ) : null}

      {dialog.kind === 'archive' ? (
        <ConfirmDialog
          open
          title={`Archive ${dialog.teacher.full_name}`}
          confirmLabel="Archive teacher"
          message={
            <div className="u-stack">
              <p>
                Archiving keeps every payroll item, group and salary policy that points at this
                teacher — the record is never deleted. It only takes them out of the active list.
              </p>
              {dialog.teacher.groups_count > 0 ? (
                <div className="alert alert--warning" role="status">
                  <div className="alert__content">
                    This teacher still has {dialog.teacher.groups_count}{' '}
                    {dialog.teacher.groups_count === 1 ? 'group' : 'groups'}. The server refuses the
                    archive until they are reassigned.
                  </div>
                </div>
              ) : null}
            </div>
          }
          onCancel={() => setDialog({ kind: 'none' })}
          onConfirm={async () => {
            await teacherApi.teachers.archive(dialog.teacher.id);
            setRefreshKey((value) => value + 1);
            setDialog({ kind: 'none' });
          }}
        />
      ) : null}
    </div>
  );
}

interface TeacherFormDialogProps {
  teacher: TeacherRow | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Create or edit a teacher, optionally creating their login account. */
function TeacherFormDialog({ teacher, onClose, onSaved }: TeacherFormDialogProps) {
  const isEdit = teacher !== null;
  const accountExists = teacher?.has_account === true;

  const [firstName, setFirstName] = useState(teacher?.first_name ?? '');
  const [lastName, setLastName] = useState(teacher?.last_name ?? '');
  const [phone, setPhone] = useState(teacher?.phone ?? '');
  const [email, setEmail] = useState(teacher?.email ?? '');
  const [specialization, setSpecialization] = useState(teacher?.specialization ?? '');
  const [employmentType, setEmploymentType] = useState(teacher?.employment_type ?? 'full_time');
  const [startDate, setStartDate] = useState(teacher?.start_date ?? toIsoDate());
  const [endDate, setEndDate] = useState(teacher?.end_date ?? '');
  const [status, setStatus] = useState(teacher?.status ?? 'active');
  const [notes, setNotes] = useState(teacher?.notes ?? '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);
  const { busy, error, run } = useMutation();

  const errors = fieldErrorsOf(error);
  const general = messageLines(error);
  const showAccountFields = !accountExists;

  const nameError =
    touched && firstName.trim() === '' ? 'A first name is required.' : undefined;
  const surnameError = touched && lastName.trim() === '' ? 'A last name is required.' : undefined;
  const passwordError =
    touched && username.trim() !== '' && password.trim() === ''
      ? 'A password is required when creating a login account.'
      : undefined;

  const submit = async (): Promise<void> => {
    setTouched(true);
    if (firstName.trim() === '' || lastName.trim() === '') return;
    if (passwordError !== undefined) return;

    const payload: TeacherWritePayload = {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      phone: phone.trim(),
      email: email.trim(),
      specialization: specialization.trim(),
      employment_type: employmentType,
      start_date: startDate === '' ? undefined : startDate,
      end_date: endDate === '' ? null : endDate,
      status,
      notes: notes.trim(),
    };
    if (showAccountFields && (username.trim() !== '' || password.trim() !== '')) {
      payload.username = username.trim();
      payload.password = password;
    }

    await run(async () => {
      if (teacher === null) {
        await teacherApi.teachers.create(payload);
      } else {
        await teacherApi.teachers.update(teacher.id, payload);
      }
      onSaved();
    });
  };

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      size="lg"
      title={isEdit ? `Edit ${teacher?.full_name ?? 'teacher'}` : 'Add teacher'}
      subtitle={
        isEdit
          ? 'Changes are written to the audit log.'
          : 'Optionally create the teacher’s login account at the same time.'
      }
      closeOnBackdrop={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={() => {
              void submit();
            }}
          >
            {isEdit ? 'Save changes' : 'Add teacher'}
          </Button>
        </>
      }
    >
      <div className="u-stack" style={{ gap: 'var(--space-4)' }}>
        {general.length > 0 ? (
          <div className="alert alert--error" role="alert">
            <div className="alert__content">
              <ul className="alert__list">
                {general.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        <div className="form-grid">
          <TextField
            label="First name"
            value={firstName}
            onChange={setFirstName}
            required
            error={nameError ?? errors.first_name}
          />
          <TextField
            label="Last name"
            value={lastName}
            onChange={setLastName}
            required
            error={surnameError ?? errors.last_name}
          />
          <TextField label="Phone" value={phone} onChange={setPhone} error={errors.phone} />
          <TextField
            label="Email"
            value={email}
            onChange={setEmail}
            type="email"
            error={errors.email}
          />
          <TextField
            label="Specialization"
            value={specialization}
            onChange={setSpecialization}
            error={errors.specialization}
          />
          <Select
            label="Employment type"
            options={EMPLOYMENT_TYPES}
            value={employmentType}
            onChange={(value) => setEmploymentType(value === '' ? 'full_time' : value)}
            error={errors.employment_type}
          />
          <DateField
            label="Start date"
            value={startDate}
            onChange={setStartDate}
            error={errors.start_date}
          />
          <DateField
            label="End date"
            value={endDate}
            onChange={setEndDate}
            error={errors.end_date}
          />
          <Select
            label="Status"
            options={TEACHER_STATUSES}
            value={status}
            onChange={(value) => setStatus(value === '' ? 'active' : value)}
            error={errors.status}
          />
        </div>

        <TextField label="Notes" value={notes} onChange={setNotes} error={errors.notes} />

        <div>
          <h3 className="card__title">Login account</h3>
          {accountExists ? (
            <p className="card__subtitle">
              This teacher already has a login account ({teacher?.user === null ? 'linked' : `user #${teacher?.user}`}).
              Accounts are managed under Settings → Users.
            </p>
          ) : (
            <>
              <p className="card__subtitle">
                Fill both fields to create a login account for this teacher (role: teacher). Leave
                them empty to keep the record without login.
              </p>
              <div className="form-grid">
                <TextField
                  label="Username"
                  value={username}
                  onChange={setUsername}
                  autoComplete="off"
                  error={errors.username}
                />
                <TextField
                  label="Password"
                  value={password}
                  onChange={setPassword}
                  type="password"
                  autoComplete="new-password"
                  error={passwordError ?? errors.password}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default TeachersListPage;
