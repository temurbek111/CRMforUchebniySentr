/**
 * Group profile - Students tab.
 *
 * Two real views of GET /api/groups/{id}/students/ (the active roster) and
 * GET /api/groups/{id}/memberships/ (every membership ever, including the ones
 * that were archived with `left_at`). Removing a student from the roster is an
 * archive, and this tab shows exactly that: the row survives in the history
 * view with its leaving date and status.
 */

import { useMemo, useState } from 'react';
import { Button, Card, StatusBadge, Table, type TableColumn } from '../../components';
import { useSettings } from '../../settings/SettingsContext';
import {
  groupsApi,
  toNumber,
  type Group,
  type GroupMembership,
} from '../students/api';
import { useAsyncResource } from '../students/hooks';
import { AsyncSection, Avatar, FilterChips, RecordLink } from '../students/ui';
import { PermissionNotice, RemoveStudentDialog, TransferStudentDialog } from './groupDialogs';

export interface GroupStudentsTabProps {
  group: Group;
  canManage: boolean;
  /** Bubbles up so the detail page can refresh the header counts. */
  onChanged: () => void;
}

export function GroupStudentsTab({ group, canManage, onChanged }: GroupStudentsTabProps) {
  const settings = useSettings();
  const [scope, setScope] = useState('');
  const includeHistory = scope === 'all';

  const [removeTarget, setRemoveTarget] = useState<GroupMembership | null>(null);
  const [transferTarget, setTransferTarget] = useState<GroupMembership | null>(null);

  const resource = useAsyncResource(
    () => (includeHistory ? groupsApi.memberships(group.id) : groupsApi.students(group.id)),
    `group-students:${group.id}:${includeHistory ? 'all' : 'active'}`,
  );

  const rows = resource.data ?? [];
  const activeCount = rows.filter((row) => row.is_active).length;

  const columns = useMemo<ReadonlyArray<TableColumn<GroupMembership>>>(
    () => [
      {
        key: 'student',
        header: 'Student',
        render: (row) => (
          <span className="cell-name">
            <Avatar name={row.student_name} photo={row.student_photo} size="sm" />
            <RecordLink to={`/students/${row.student}`}>{row.student_name}</RecordLink>
          </span>
        ),
      },
      {
        key: 'code',
        header: 'Code',
        width: '96px',
        render: (row) => <span className="u-mono">{row.student_code}</span>,
      },
      {
        key: 'joined_at',
        header: 'Joined',
        width: '120px',
        render: (row) => <span className="u-nowrap">{settings.date(row.joined_at)}</span>,
      },
      {
        key: 'left_at',
        header: 'Left',
        width: '120px',
        render: (row) =>
          row.left_at === null ? (
            <span className="u-subtle">Still enrolled</span>
          ) : (
            <span className="u-nowrap">{settings.date(row.left_at)}</span>
          ),
      },
      {
        key: 'status',
        header: 'Membership',
        width: '140px',
        render: (row) => <StatusBadge status={row.is_active ? 'active' : row.status} />,
      },
      {
        key: 'fee',
        header: 'Fee',
        align: 'right',
        width: '130px',
        render: (row) => (
          <span className="u-nowrap">
            {settings.money(toNumber(row.effective_fee ?? row.monthly_fee))}
          </span>
        ),
      },
      {
        key: 'note',
        header: 'Note',
        render: (row) => row.note || <span className="u-subtle">—</span>,
      },
    ],
    [settings],
  );

  const toolbar = (
    <div className="toolbar-split">
      <FilterChips
        options={[{ value: 'all', label: 'Include past memberships' }]}
        value={scope}
        onChange={setScope}
        allLabel="Active roster"
        label="Roster scope"
      />
      <span className="toolbar-split__spacer" />
      <Button size="sm" icon="refresh" onClick={resource.reload}>
        Reload
      </Button>
    </div>
  );

  return (
    <>
      <AsyncSection
        loading={resource.loading}
        error={resource.error}
        onRetry={resource.reload}
        isEmpty={rows.length === 0}
        emptyIcon="students"
        emptyTitle={includeHistory ? 'No memberships yet' : 'Nobody is enrolled yet'}
        emptyMessage={
          includeHistory
            ? 'Every enrol, transfer and archive for this group will be listed here.'
            : canManage
              ? 'Use "Enrol student" above to add the first student to this group.'
              : 'An administrator can enrol students into this group.'
        }
        loadingRows={5}
      >
        {!canManage ? (
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <PermissionNotice code="groups.manage" />
          </div>
        ) : null}

        <Card
          flush
          title="Roster"
          subtitle={
            includeHistory
              ? `${settings.number(rows.length)} memberships · ${settings.number(activeCount)} still active · archived memberships keep their history`
              : `${settings.number(rows.length)} active ${rows.length === 1 ? 'student' : 'students'}`
          }
        >
          <Table<GroupMembership>
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            paginated={rows.length > 25}
            initialPageSize={25}
            dense
            stickyHeader
            toolbar={toolbar}
            caption="Group roster"
            emptyIcon="students"
            emptyTitle={includeHistory ? 'No memberships yet' : 'Nobody is enrolled yet'}
            emptyMessage="Students enrolled in this group appear here."
            actions={
              canManage
                ? (row) =>
                    row.is_active ? (
                      <>
                        <Button
                          size="sm"
                          icon="users"
                          onClick={() => setTransferTarget(row)}
                          title={`Transfer ${row.student_name} to another group`}
                        >
                          Transfer
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          icon="logout"
                          onClick={() => setRemoveTarget(row)}
                          title={`Archive ${row.student_name}'s membership (not a delete)`}
                        >
                          Archive
                        </Button>
                      </>
                    ) : null
                : undefined
            }
            actionsHeader={canManage ? 'Actions' : ''}
          />
        </Card>
      </AsyncSection>

      {removeTarget !== null ? (
        <RemoveStudentDialog
          group={group}
          membership={removeTarget}
          onClose={() => setRemoveTarget(null)}
          onRemoved={() => {
            setRemoveTarget(null);
            onChanged();
          }}
        />
      ) : null}

      {transferTarget !== null ? (
        <TransferStudentDialog
          group={group}
          membership={transferTarget}
          onClose={() => setTransferTarget(null)}
          onTransferred={() => {
            setTransferTarget(null);
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}

export default GroupStudentsTab;
