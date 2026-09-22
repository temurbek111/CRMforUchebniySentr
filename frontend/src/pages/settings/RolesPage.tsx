/**
 * Roles - the permission matrix, READ-ONLY.
 *
 * Why read-only: authorization is currently decided by the permission matrix
 * compiled into the server (apps/accounts/rbac.py `ROLE_MATRIX`, reached through
 * `permissions_for_role` -> `effective_permissions` -> `RequirePerms`). The
 * `Role.permissions` rows this screen reads are stored faithfully by
 * `PATCH /api/roles/{id}/`, but nothing in the request path consults them.
 *
 * So an editor here would save successfully and change nothing for anybody -
 * a convincing lie. This screen therefore shows the stored role definition and
 * says plainly whose word counts. Editing is withheld until the two sources are
 * reconciled; see the characterisation test
 * `test_role_permissions_in_the_database_do_not_yet_drive_enforcement` in
 * backend/apps/accounts/tests/test_permissions.py, which pins the divergence and
 * fails the moment it is fixed.
 *
 * `roles.manage` is what the server requires to reach this endpoint; only
 * super_admin holds it.
 */

import { useMemo, useState } from 'react';
import { Badge, Button, Card, ErrorState, LoadingState, Table, type TableColumn } from '../../components';
import { useAuth } from '../../auth/AuthContext';
import { PERMISSIONS } from '../../types';
import type { Role } from '../../types';
import { useAsyncResource } from '../students/hooks';
import { InlineNote, RefreshButton } from '../students/ui';
import { groupPermissionsByModule, isSecuritySensitive, permissionsApi, rolesApi } from './api';

export function RolesPage() {
  const { hasPerm } = useAuth();
  const canRead = hasPerm(PERMISSIONS.ROLES_MANAGE);

  const roles = useAsyncResource(() => (canRead ? rolesApi.list() : Promise.resolve([] as Role[])), 'roles');
  const catalogue = useAsyncResource(
    () => (canRead ? permissionsApi.list() : Promise.resolve([])),
    'permissions',
  );

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const roleList = roles.data ?? [];
  const selected = roleList.find((role) => role.id === selectedId) ?? roleList[0] ?? null;

  const groups = useMemo(() => groupPermissionsByModule(catalogue.data ?? []), [catalogue.data]);

  /** Permission rows belonging to the selected role, per module. */
  const selectedByModule = useMemo(() => {
    if (selected === null) return [];
    const held = new Set(selected.permissions);
    return groups
      .map((group) => ({
        module: group.module,
        permissions: group.permissions.filter((permission) => held.has(permission.id)),
      }))
      .filter((group) => group.permissions.length > 0);
  }, [groups, selected]);

  const roleColumns = useMemo<ReadonlyArray<TableColumn<Role>>>(
    () => [
      {
        key: 'name',
        header: 'Role',
        render: (row) => (
          <span className="cell-stack">
            <span className="cell-stack__primary">{row.name}</span>
            <span className="cell-stack__secondary">{row.code}</span>
          </span>
        ),
        sortValue: (row) => row.name,
      },
      {
        key: 'description',
        header: 'Purpose',
        render: (row) => row.description || <span className="u-subtle">—</span>,
      },
      {
        key: 'permissions',
        header: 'Stored codes',
        align: 'right',
        width: '130px',
        render: (row) => row.permission_codes.length,
        sortValue: (row) => row.permission_codes.length,
      },
      {
        key: 'users',
        header: 'Accounts',
        align: 'right',
        width: '110px',
        render: (row) => row.user_count,
        sortValue: (row) => row.user_count,
      },
      {
        key: 'system',
        header: '',
        width: '110px',
        render: (row) =>
          row.is_system ? (
            <Badge tone="info" dot>
              Built in
            </Badge>
          ) : (
            <Badge tone="warning" dot>
              Custom
            </Badge>
          ),
      },
    ],
    [],
  );

  const header = (
    <header className="page-header">
      <div className="page-header__heading">
        <h1 className="page-header__title">Roles</h1>
        <p className="page-header__subtitle">
          What each role is allowed to do, and where that decision actually comes from.
        </p>
      </div>
      <div className="page-header__actions">
        <RefreshButton onClick={roles.reload} label="Reload" />
      </div>
    </header>
  );

  if (roles.loading || catalogue.loading) {
    return (
      <div className="module-page">
        {header}
        <LoadingState label="Loading roles…" variant="skeleton" rows={6} />
      </div>
    );
  }

  if (roles.error !== null) {
    return (
      <div className="module-page">
        {header}
        <ErrorState error={roles.error} title="Could not load roles" onRetry={roles.reload} />
      </div>
    );
  }

  if (!canRead) {
    return (
      <div className="module-page">
        {header}
        <Card>
          <InlineNote tone="warning">
            Reading the role matrix requires <code> roles.manage </code>, which only a super administrator
            holds.
          </InlineNote>
        </Card>
      </div>
    );
  }

  return (
    <div className="module-page">
      {header}

      <InlineNote tone="warning">
        <strong>This screen is read-only, deliberately.</strong> At present the server decides access from
        the permission matrix compiled into the code
        (<code> backend/apps/accounts/rbac.py </code>), not from the stored role rows shown below. An edit
        saved here would succeed and change nothing for any user, so editing is withheld rather than
        offered and quietly ignored. The two sources are kept aligned by
        <code> make rbac </code>.
      </InlineNote>

      <Card title="Roles" subtitle={`${roleList.length} role(s)`} flush>
        <Table<Role>
          columns={roleColumns}
          rows={roleList}
          rowKey={(row) => row.id}
          onRowClick={(row) => setSelectedId(row.id)}
          paginated={false}
          dense
          emptyTitle="No roles defined"
          emptyIcon="shield"
          caption="Roles"
          actions={(row) => (
            <Button
              size="sm"
              variant={selected !== null && selected.id === row.id ? 'primary' : 'secondary'}
              onClick={() => setSelectedId(row.id)}
            >
              {selected !== null && selected.id === row.id ? 'Shown' : 'Show'}
            </Button>
          )}
          actionsHeader="Matrix"
        />
      </Card>

      {selected !== null ? (
        <Card
          title={`${selected.name} — stored role definition`}
          subtitle={`${selected.permission_codes.length} permission(s) stored · held by ${selected.user_count} account(s)`}
        >
          {selectedByModule.length === 0 ? (
            <p className="u-muted" style={{ margin: 0 }}>
              No permissions are stored on this role row.
            </p>
          ) : (
            <div className="u-stack" style={{ gap: 'var(--space-4)' }}>
              {selectedByModule.map((group) => (
                <section key={group.module} className="u-stack">
                  <strong>
                    {group.module}{' '}
                    <span className="u-muted">({group.permissions.length})</span>
                  </strong>
                  <div className="form-grid">
                    {group.permissions.map((permission) => (
                      <div key={permission.id} className="u-row" style={{ gap: 'var(--space-2)' }}>
                        <Badge tone="neutral" dot>
                          granted
                        </Badge>
                        <span>
                          {permission.name}
                          <br />
                          <span className="u-muted" style={{ fontSize: '0.85em' }}>
                            {permission.code}
                          </span>
                          {isSecuritySensitive(permission.code) ? (
                            <>
                              {' '}
                              <Badge tone="warning" title="Granting this is a security decision">
                                sensitive
                              </Badge>
                            </>
                          ) : null}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}

export default RolesPage;
