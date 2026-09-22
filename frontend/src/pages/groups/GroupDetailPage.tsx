/**
 * Group profile: the shell the five group tabs plug into.
 *
 * The page owns the record header (course, teacher, room, schedule, capacity),
 * the tab shell — the active tab lives in the URL (`?tab=attendance`) so every
 * tab is linkable and survives a refresh — and the four audited write actions:
 * edit, change teacher, enrol and (archive) remove or transfer a student.
 *
 * Capacity is the server's rule. Nothing here pre-empts it: the dialogs surface
 * the API's refusal inline, and the over-capacity override is only offered to a
 * user holding `groups.override_capacity`.
 */

import { useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusBadge,
} from '../../components';
import { useAuth } from '../../auth/AuthContext';
import { useSettings } from '../../settings/SettingsContext';
import { ApiError, PERMISSIONS } from '../../types';
import {
  groupsApi,
  toNumber,
  type GroupMembership,
} from '../students/api';
import { useAsyncResource } from '../students/hooks';
import {
  Avatar,
  DataField,
  RecordHeader,
  TabNav,
  TabPanel,
  UtilisationBar,
  type TabDefinition,
} from '../students/ui';
import { GroupFormModal } from './groupForms';
import {
  ChangeTeacherDialog,
  EnrollStudentDialog,
  RemoveStudentDialog,
  TransferStudentDialog,
} from './groupDialogs';
import { GroupAttendanceTab } from './GroupAttendanceTab';
import { GroupPaymentsTab } from './GroupPaymentsTab';
import { GroupPerformanceTab } from './GroupPerformanceTab';
import { GroupScheduleTab } from './GroupScheduleTab';
import { GroupStudentsTab } from './GroupStudentsTab';

type GroupTabKey = 'students' | 'attendance' | 'performance' | 'schedule' | 'payments';

const TABS: ReadonlyArray<TabDefinition<GroupTabKey>> = [
  { key: 'students', label: 'Students' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'performance', label: 'Performance' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'payments', label: 'Payments' },
];

const TAB_KEYS: ReadonlyArray<string> = TABS.map((tab) => tab.key);

function isTabKey(value: string | null): value is GroupTabKey {
  return value !== null && TAB_KEYS.includes(value);
}

export function GroupDetailPage(): ReactNode {
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const settings = useSettings();
  const { hasPerm } = useAuth();

  const groupId = Number(params.id);
  const validId = Number.isFinite(groupId) && groupId > 0;

  const group = useAsyncResource(
    () => groupsApi.get(groupId),
    `group:${groupId}`,
  );
  const capacity = useAsyncResource(
    () => groupsApi.capacity(groupId),
    `group-capacity:${groupId}`,
  );

  const [editOpen, setEditOpen] = useState(false);
  const [teacherOpen, setTeacherOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<GroupMembership | null>(null);
  const [transferTarget, setTransferTarget] = useState<GroupMembership | null>(null);

  const requestedTab = searchParams.get('tab');
  const activeTab: GroupTabKey = isTabKey(requestedTab) ? requestedTab : 'students';

  const selectTab = (key: GroupTabKey): void => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', key);
    setSearchParams(next, { replace: true });
  };

  const canManage = hasPerm(PERMISSIONS.GROUPS_MANAGE);

  if (!validId) {
    return (
      <EmptyState
        title="That group does not exist"
        message="The address does not contain a valid group id."
        action={
          <Link className="btn btn--secondary" to="/groups">
            Back to groups
          </Link>
        }
      />
    );
  }

  if (group.loading && group.data === null) {
    return <LoadingState label="Loading group…" />;
  }

  if (group.error !== null) {
    const notFound = group.error instanceof ApiError && group.error.status === 404;
    const forbidden = group.error instanceof ApiError && group.error.status === 403;
    if (notFound || forbidden) {
      return (
        <EmptyState
          title={notFound ? 'Group not found' : 'You cannot view this group'}
          message={
            notFound
              ? 'It may have been removed, or the link is wrong.'
              : 'Your role does not include access to this group.'
          }
          action={
            <Link className="btn btn--secondary" to="/groups">
              Back to groups
            </Link>
          }
        />
      );
    }
    return <ErrorState error={group.error} onRetry={group.reload} />;
  }

  const record = group.data;
  if (record === null) return <LoadingState label="Loading group…" />;

  const refreshAll = (): void => {
    group.reload();
    capacity.reload();
  };

  return (
    <>
      <div className="u-row u-row--between" style={{ marginBottom: 8 }}>
        <Link className="link" to="/groups">
          ← Back to groups
        </Link>
      </div>

      <Card>
        {/* The visible title lives in the RecordHeader; this gives the document
            outline (and screen readers) the one h1 every page must have. */}
        <h1 className="visually-hidden">{record.name} — group profile</h1>
        <RecordHeader
          avatar={<Avatar name={record.name} size="lg" />}
          title={record.name}
          code={record.course_name}
          badges={
            <>
              <StatusBadge status={record.status} />
              {record.level ? <StatusBadge status={record.level} /> : null}
            </>
          }
          actions={
            canManage ? (
              <>
                <Button icon="edit" onClick={() => setEditOpen(true)}>
                  Edit
                </Button>
                <Button icon="user" onClick={() => setTeacherOpen(true)}>
                  Change teacher
                </Button>
                <Button variant="primary" icon="plus" onClick={() => setEnrollOpen(true)}>
                  Enrol student
                </Button>
              </>
            ) : undefined
          }
        >
          <div className="u-grid" style={{ gap: 16 }}>
            <DataField label="Teacher">{record.teacher_name || '—'}</DataField>
            <DataField label="Room">{record.room_name || '—'}</DataField>
            <DataField label="Schedule">{record.schedule_summary || '—'}</DataField>
            <DataField label="Monthly fee">
              {record.monthly_fee === null ? '—' : settings.money(toNumber(record.monthly_fee))}
            </DataField>
            <DataField label="Starts">
              {record.start_date === null ? '—' : settings.date(record.start_date)}
            </DataField>
            <DataField label="Ends">
              {record.end_date === null ? '—' : settings.date(record.end_date)}
            </DataField>
            <DataField label="Capacity">
              <UtilisationBar enrolled={record.student_count} capacity={record.capacity} />
              {capacity.data !== null ? (
                <div className="u-muted" style={{ fontSize: '0.875em' }}>
                  {capacity.data.enrolled} of {capacity.data.capacity} filled
                  {capacity.data.is_full ? ' · full' : ''}
                </div>
              ) : null}
            </DataField>
          </div>
          {record.notes ? (
            <p className="u-muted" style={{ marginTop: 12, marginBottom: 0 }}>
              {record.notes}
            </p>
          ) : null}
        </RecordHeader>
      </Card>

      <Card>
        <TabNav<GroupTabKey>
          tabs={TABS}
          active={activeTab}
          onChange={selectTab}
          label="Group sections"
          idPrefix="group-detail"
        />

        <TabPanel id={`group-detail-panel-${activeTab}`} labelId={`group-detail-tab-${activeTab}`}>
          {activeTab === 'students' ? (
            <GroupStudentsTab
              group={record}
              canManage={canManage}
              onChanged={refreshAll}
            />
          ) : null}
          {activeTab === 'attendance' ? <GroupAttendanceTab group={record} /> : null}
          {activeTab === 'performance' ? <GroupPerformanceTab group={record} /> : null}
          {activeTab === 'schedule' ? <GroupScheduleTab group={record} /> : null}
          {activeTab === 'payments' ? <GroupPaymentsTab group={record} /> : null}
        </TabPanel>
      </Card>

      <GroupFormModal
        open={editOpen}
        mode="edit"
        group={record}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false);
          refreshAll();
        }}
      />

      {teacherOpen ? (
        <ChangeTeacherDialog
          group={record}
          onClose={() => setTeacherOpen(false)}
          onChanged={() => {
            setTeacherOpen(false);
            refreshAll();
          }}
        />
      ) : null}

      {enrollOpen ? (
        <EnrollStudentDialog
          group={record}
          capacity={capacity.data}
          onClose={() => setEnrollOpen(false)}
          onEnrolled={() => {
            setEnrollOpen(false);
            refreshAll();
          }}
        />
      ) : null}

      {removeTarget !== null ? (
        <RemoveStudentDialog
          group={record}
          membership={removeTarget}
          onClose={() => setRemoveTarget(null)}
          onRemoved={() => {
            setRemoveTarget(null);
            refreshAll();
          }}
        />
      ) : null}

      {transferTarget !== null ? (
        <TransferStudentDialog
          group={record}
          membership={transferTarget}
          onClose={() => setTransferTarget(null)}
          onTransferred={() => {
            setTransferTarget(null);
            refreshAll();
          }}
        />
      ) : null}
    </>
  );
}

export default GroupDetailPage;
