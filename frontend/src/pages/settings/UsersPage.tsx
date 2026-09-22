/**
 * Users - staff accounts (apps/accounts/views.UserViewSet).
 *
 * Two facts shape this screen:
 *
 * 1. Accounts are DEACTIVATED, never deleted. DELETE /api/users/{id}/ sets
 *    is_active=False; the row survives because audit entries, payments and
 *    payroll items all point at it. The UI says so rather than implying a
 *    destructive delete.
 *
 * 2. The role picker cannot assume it may read /api/roles/. RoleViewSet requires
 *    `roles.manage`, which a manager does NOT hold even though it holds
 *    `users.view`. So the picker tries the endpoint, and falls back to the roles
 *    actually present on the loaded users rather than failing.
 *
 * The server enforces users.view for reading and users.manage for every write;
 * nothing here relies on the client to be the gate.
 */

import { useCallback, useMemo, useState, type FormEvent } from 'react';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Modal,
  SearchInput,
  Select,
  Table,
  TextField,
  type TableColumn,
} from '../../components';
import { useAuth } from '../../auth/AuthContext';
import { ApiError, PERMISSIONS } from '../../types';
import type { Role, User } from '../../types';
import { useSettings } from '../../settings/SettingsContext';
import { useAsyncResource } from '../students/hooks';
import { InlineNote, RefreshButton, ServerPagination } from '../students/ui';
import {
  ACCOUNT_STATUS_OPTIONS,
  rolesApi,
  usersApi,
  type UserWriteBody,
} from './api';

const DEFAULT_PAGE_SIZE = 25;

interface UserFormValues {
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  role: number | '';
  is_active: boolean;
  password: string;
}

const EMPTY_FORM: UserFormValues = {
  username: '',
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  role: '',
  is_active: true,
  password: '',
};

function toFormValues(user: User): UserFormValues {
  return {
    username: user.username,
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
    phone: user.phone,
    role: user.role ?? '',
    is_active: user.is_active,
    password: '',
  };
}

function fieldErrors(error: unknown, field: string): string[] {
  return error instanceof ApiError ? error.fieldMessages(field) : [];
}

// --------------------------------------------------------------------------- //
// Create / edit
// --------------------------------------------------------------------------- //

interface UserFormModalProps {
  open: boolean;
  /** null = create a new account. */
  user: User | null;
  roleOptions: ReadonlyArray<{ value: number; label: string }>;
  onClose: () => void;
  onSaved: (user: User) => void;
}

function UserFormModal({ open, user, roleOptions, onClose, onSaved }: UserFormModalProps) {
  const editing = user !== null;
  const [values, setValues] = useState<UserFormValues>(EMPTY_FORM);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // Reset the form whenever the dialog is opened for a different record.
  const formKey = editing ? `edit-${user.id}` : 'create';
  const [lastKey, setLastKey] = useState(formKey);
  if (lastKey !== formKey) {
    setLastKey(formKey);
    setValues(editing ? toFormValues(user) : EMPTY_FORM);
    setError(null);
  }

  const set = <K extends keyof UserFormValues>(key: K, value: UserFormValues[K]): void => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload: UserWriteBody = {
        username: values.username.trim(),
        first_name: values.first_name.trim(),
        last_name: values.last_name.trim(),
        email: values.email.trim(),
        phone: values.phone.trim(),
        role: values.role === '' ? null : values.role,
        is_active: values.is_active,
      };
      // The password is only sent when it is actually being set: UserWriteSerializer
      // treats an empty string as "change it to nothing", which is never intended.
      if (values.password !== '') payload.password = values.password;

      const saved = editing
        ? await usersApi.update(user.id, payload)
        : await usersApi.create(payload);
      onSaved(saved);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };

  const generalMessages =
    error instanceof ApiError
      ? error.messages.filter(
          (message) =>
            !fieldErrors(error, 'username').includes(message) &&
            !fieldErrors(error, 'password').includes(message),
        )
      : error === null
        ? []
        : [String(error)];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={editing ? `Edit ${user.full_name || user.username}` : 'New staff account'}
      subtitle={
        editing
          ? 'Leave the password blank to keep the current one.'
          : 'The account is usable immediately; share the password securely.'
      }
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="user-form" loading={busy}>
            {editing ? 'Save changes' : 'Create account'}
          </Button>
        </>
      }
    >
      {generalMessages.length > 0 ? (
        <div className="alert alert--error" role="alert" style={{ marginBottom: 16 }}>
          <div className="alert__content">
            <ul className="alert__list">
              {generalMessages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <form id="user-form" className="u-stack" onSubmit={(event) => void submit(event)}>
        <div className="form-grid">
          <TextField
            label="Username"
            value={values.username}
            onChange={(value) => set('username', value)}
            error={fieldErrors(error, 'username')}
            autoComplete="off"
            required
          />
          <TextField
            label="First name"
            value={values.first_name}
            onChange={(value) => set('first_name', value)}
            error={fieldErrors(error, 'first_name')}
          />
          <TextField
            label="Last name"
            value={values.last_name}
            onChange={(value) => set('last_name', value)}
            error={fieldErrors(error, 'last_name')}
          />
          <TextField
            label="Email"
            type="email"
            value={values.email}
            onChange={(value) => set('email', value)}
            error={fieldErrors(error, 'email')}
          />
          <TextField
            label="Phone"
            value={values.phone}
            onChange={(value) => set('phone', value)}
            error={fieldErrors(error, 'phone')}
          />
          <Select<number>
            label="Role"
            placeholder="No role"
            options={roleOptions.map((option) => ({ value: option.value, label: option.label }))}
            value={values.role}
            onChange={(value) => set('role', value)}
            error={fieldErrors(error, 'role')}
          />
        </div>

        <TextField
          label={editing ? 'New password (optional)' : 'Password'}
          type="password"
          value={values.password}
          onChange={(value) => set('password', value)}
          error={fieldErrors(error, 'password')}
          hint="At least 8 characters, not entirely numeric, and not a common password."
          autoComplete="new-password"
          required={!editing}
        />

        <Select<string>
          label="Account state"
          options={ACCOUNT_STATUS_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
          value={values.is_active ? 'true' : 'false'}
          onChange={(value) => set('is_active', value === 'true')}
        />
      </form>
    </Modal>
  );
}

// --------------------------------------------------------------------------- //
// Reset password
// --------------------------------------------------------------------------- //

function ResetPasswordModal({
  user,
  onClose,
}: {
  user: User | null;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  return (
    <Modal
      open={user !== null}
      onClose={() => {
        setPassword('');
        setError(null);
        setDone(false);
        onClose();
      }}
      size="sm"
      title={user === null ? '' : `Reset password for ${user.username}`}
      subtitle="The user keeps their username; only the password changes."
      footer={
        <>
          <Button
            onClick={() => {
              setPassword('');
              setError(null);
              setDone(false);
              onClose();
            }}
            disabled={busy}
          >
            Close
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={password === ''}
            onClick={() => {
              if (user === null) return;
              setBusy(true);
              setError(null);
              usersApi
                .resetPassword(user.id, password)
                .then(() => {
                  setDone(true);
                  setPassword('');
                })
                .catch((cause: unknown) => setError(cause))
                .finally(() => setBusy(false));
            }}
          >
            Set password
          </Button>
        </>
      }
    >
      {done ? (
        <InlineNote tone="info">
          Password updated. Communicate the new password to {user?.full_name || user?.username} through a
          secure channel — it is not shown again here.
        </InlineNote>
      ) : null}

      {error !== null ? (
        <div className="alert alert--error" role="alert" style={{ marginBottom: 12 }}>
          <div className="alert__content">
            {error instanceof ApiError
              ? error.messages.map((message) => <div key={message}>{message}</div>)
              : 'Could not reset the password.'}
          </div>
        </div>
      ) : null}

      <TextField
        label="New password"
        type="password"
        value={password}
        onChange={setPassword}
        error={fieldErrors(error, 'new_password')}
        autoComplete="new-password"
      />
    </Modal>
  );
}

// --------------------------------------------------------------------------- //
// Page
// --------------------------------------------------------------------------- //

export function UsersPage() {
  const { hasPerm, user: me } = useAuth();
  const canView = hasPerm(PERMISSIONS.USERS_VIEW);
  const canManage = hasPerm(PERMISSIONS.USERS_MANAGE);
  const { dateTime, number } = useSettings();

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<number | ''>('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [resetFor, setResetFor] = useState<User | null>(null);
  const [deactivating, setDeactivating] = useState<User | null>(null);

  const resetToFirstPage = useCallback((): void => setPage(1), []);

  const queryKey = [canView, search, roleFilter, statusFilter, page, pageSize].join('|');

  const resource = useAsyncResource(
    () =>
      canView
        ? usersApi.list({
            search: search.trim() === '' ? undefined : search.trim(),
            role: roleFilter === '' ? undefined : roleFilter,
            is_active: statusFilter === '' ? undefined : statusFilter === 'true',
            ordering: 'first_name',
            page,
            page_size: pageSize,
          })
        : Promise.resolve({ count: 0, page: 1, page_size: pageSize, total_pages: 0, next: null, previous: null, results: [] }),
    queryKey,
  );

  const rows = resource.data?.results ?? [];
  const count = resource.data?.count ?? 0;
  const totalPages = resource.data?.total_pages ?? 0;

  // RoleViewSet requires roles.manage, which a manager holding only users.view
  // does not have. Asking anyway would fire a 403 (and a console error) on every
  // visit to this screen, so the request is made only when it can succeed;
  // otherwise the picker falls back to the roles present on the loaded accounts.
  const canReadRoles = hasPerm(PERMISSIONS.ROLES_MANAGE);

  const rolesResource = useAsyncResource(
    () =>
      canView && canReadRoles
        ? rolesApi.list().catch(() => [] as Role[])
        : Promise.resolve([] as Role[]),
    `settings-roles|${canView}|${canReadRoles}`,
  );

  const roleOptions = useMemo<Array<{ value: number; label: string }>>(() => {
    const fromApi = rolesResource.data ?? [];
    if (fromApi.length > 0) {
      return fromApi.map((role) => ({ value: role.id, label: role.name }));
    }
    // Fall back to the roles actually present on the loaded page of users.
    const seen = new Map<number, string>();
    for (const row of rows) {
      if (row.role !== null && row.role !== undefined) seen.set(row.role, row.role_name);
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [rolesResource.data, rows]);

  const hasFilters = search.trim() !== '' || roleFilter !== '' || statusFilter !== '';

  const columns = useMemo<ReadonlyArray<TableColumn<User>>>(
    () => [
      {
        key: 'name',
        header: 'Staff member',
        render: (row) => (
          <span className="cell-stack">
            <span className="cell-stack__primary">{row.full_name || row.username}</span>
            <span className="cell-stack__secondary">@{row.username}</span>
          </span>
        ),
        sortValue: (row) => row.full_name || row.username,
      },
      {
        key: 'role',
        header: 'Role',
        width: '150px',
        render: (row) =>
          row.role_name ? (
            <Badge tone={row.is_superuser ? 'primary' : 'neutral'}>{row.role_name}</Badge>
          ) : (
            <span className="u-subtle">No role</span>
          ),
        sortValue: (row) => row.role_name,
      },
      { key: 'email', header: 'Email', render: (row) => row.email || <span className="u-subtle">—</span> },
      {
        key: 'phone',
        header: 'Phone',
        width: '150px',
        render: (row) => <span className="u-nowrap">{row.phone || '—'}</span>,
      },
      {
        key: 'is_active',
        header: 'State',
        width: '120px',
        render: (row) =>
          row.is_active ? (
            <Badge tone="success" dot>
              Active
            </Badge>
          ) : (
            <Badge tone="danger" dot>
              Deactivated
            </Badge>
          ),
        sortValue: (row) => (row.is_active ? 1 : 0),
      },
      {
        key: 'last_login',
        header: 'Last sign-in',
        width: '180px',
        render: (row) =>
          row.last_login === null || row.last_login === '' ? (
            <span className="u-subtle">never</span>
          ) : (
            <span className="u-nowrap">{dateTime(row.last_login)}</span>
          ),
        sortValue: (row) => row.last_login ?? '',
      },
    ],
    [dateTime],
  );

  const header = (
    <header className="page-header">
      <div className="page-header__heading">
        <h1 className="page-header__title">Users</h1>
        <p className="page-header__subtitle">
          {resource.loading
            ? 'Loading staff accounts…'
            : `${number(count)} ${count === 1 ? 'account' : 'accounts'} match the current filters.`}
        </p>
      </div>
      <div className="page-header__actions">
        <RefreshButton onClick={resource.reload} label="Reload" />
        {canManage ? (
          <Button
            variant="primary"
            icon="plus"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            New account
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
          <InlineNote tone="warning">
            Your role can use the application but not administer staff accounts: the server requires
            <code> users.view </code> to read this screen and <code> users.manage </code> to change anything.
          </InlineNote>
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
          placeholder="Name, username, email or phone"
          debounceMs={350}
        />
      </div>

      <Select<number>
        label="Role"
        labelHidden
        small
        placeholder="All roles"
        options={roleOptions}
        value={roleFilter}
        onChange={(value) => {
          setRoleFilter(value);
          resetToFirstPage();
        }}
      />

      <Select<string>
        label="State"
        labelHidden
        small
        placeholder="Any state"
        options={ACCOUNT_STATUS_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
        }))}
        value={statusFilter}
        onChange={(value) => {
          setStatusFilter(value);
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
        <Table<User>
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={resource.loading}
          error={resource.error}
          onRetry={resource.reload}
          paginated={false}
          dense
          stickyHeader
          toolbar={toolbar}
          emptyIcon="users"
          emptyTitle="No accounts found"
          emptyMessage={
            hasFilters
              ? 'Try clearing the search box or one of the filters.'
              : 'Staff accounts you create will appear here.'
          }
          actions={(row) =>
            canManage ? (
              <div className="u-row">
                <Button
                  size="sm"
                  icon="edit"
                  onClick={() => {
                    setEditing(row);
                    setFormOpen(true);
                  }}
                >
                  Edit
                </Button>
                <Button size="sm" onClick={() => setResetFor(row)}>
                  Reset password
                </Button>
                {row.is_active ? (
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={me !== null && me.id === row.id}
                    title={me !== null && me.id === row.id ? 'You cannot deactivate your own account' : undefined}
                    onClick={() => setDeactivating(row)}
                  >
                    Deactivate
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => {
                      void usersApi.setActive(row.id).then(() => resource.reload());
                    }}
                  >
                    Reactivate
                  </Button>
                )}
              </div>
            ) : undefined
          }
          actionsHeader={canManage ? 'Actions' : undefined}
          caption="Staff accounts"
          footer={
            <ServerPagination
              page={page}
              totalPages={totalPages}
              count={count}
              pageSize={pageSize}
              itemLabel="accounts"
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                resetToFirstPage();
              }}
            />
          }
        />
      </Card>

      {!canManage ? (
        <InlineNote>
          Your role can read staff accounts but not change them: creating, editing, resetting passwords and
          deactivating all require <code> users.manage </code> on the server.
        </InlineNote>
      ) : (
        <InlineNote tone="info">
          Accounts are deactivated rather than deleted. A deactivated account cannot sign in, but its audit
          entries, payments and payroll history stay intact.
        </InlineNote>
      )}

      <UserFormModal
        open={formOpen}
        user={editing}
        roleOptions={roleOptions}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSaved={() => {
          setFormOpen(false);
          setEditing(null);
          resource.reload();
        }}
      />

      <ResetPasswordModal
        user={resetFor}
        onClose={() => {
          setResetFor(null);
          resource.reload();
        }}
      />

      <ConfirmDialog
        open={deactivating !== null}
        title="Deactivate this account?"
        tone="danger"
        confirmLabel="Deactivate"
        message={
          <>
            <p style={{ marginTop: 0 }}>
              <strong>{deactivating?.full_name || deactivating?.username}</strong> will no longer be able to
              sign in.
            </p>
            <p style={{ marginBottom: 0 }} className="u-muted">
              The account is kept, not deleted: their audit entries, payments and payroll records stay
              attached. You can reactivate it at any time.
            </p>
          </>
        }
        onCancel={() => setDeactivating(null)}
        onConfirm={async () => {
          if (deactivating === null) return;
          await usersApi.deactivate(deactivating.id);
          setDeactivating(null);
          resource.reload();
        }}
      />
    </div>
  );
}

export default UsersPage;
