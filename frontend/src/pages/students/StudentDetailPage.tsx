/**
 * Student profile: the shell the six student tabs plug into.
 *
 * This page owns exactly three things:
 *
 *   1. the record header - identity, contact details, guardian, age,
 *      registration date and the effective monthly fee rendered through the
 *      settings money formatter;
 *   2. the tab shell - the active tab lives in the URL (`?tab=attendance`), so
 *      every tab is linkable and survives a refresh, and only the active tab
 *      is mounted (each tab loads its own endpoint, so nothing is fetched
 *      twice and nothing is fetched before it is asked for);
 *   3. the audited writes - edit, change status, transfer, archive.
 *
 * Status is *never* PATCHed: POST /api/students/{id}/change-status/ is the
 * audited path and it is the one that stamps `left_at`/`status_changed_at` and
 * records the reason. The same applies to notes and transfers - they all go
 * through their own action endpoints.
 *
 * Errors keep their shape: field-level problems from the API's uniform body
 * (`{detail, errors: {field: ["..."]}}`) are rendered on the input that caused
 * them, and anything that is not tied to a rendered field is listed in an
 * alert, so a failed write is never silent.
 */

import { useCallback, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Button,
  Card,
  ConfirmDialog,
  DateField,
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
  Modal,
  Select,
  StatusBadge,
  TextField,
  type SelectOption,
} from '../../components';
import { useAuth } from '../../auth/AuthContext';
import { useSettings } from '../../settings/SettingsContext';
import { ApiError, PERMISSIONS } from '../../types';
import {
  groupsApi,
  studentsApi,
  toNumber,
  STUDENT_STATUS_OPTIONS,
  type StudentListItem,
  type StudentStatus,
  type TransferPayload,
} from './api';
import {
  fieldError,
  fieldErrors,
  generalErrorMessages,
  useAsyncResource,
} from './hooks';
import {
  Avatar,
  DataField,
  InlineNote,
  RecordHeader,
  RefreshButton,
  TabNav,
  TabPanel,
  type TabDefinition,
} from './ui';
import { StudentFormModal } from './studentForms';
import { StudentActivityTab } from './StudentActivityTab';
import { StudentAttendanceTab } from './StudentAttendanceTab';
import { StudentExamsTab } from './StudentExamsTab';
import { StudentNotesTab } from './StudentNotesTab';
import { StudentOverviewTab } from './StudentOverviewTab';
import { StudentPaymentsTab } from './StudentPaymentsTab';

// --------------------------------------------------------------------------- //
// Tabs
// --------------------------------------------------------------------------- //

type StudentTabKey = 'overview' | 'attendance' | 'exams' | 'payments' | 'notes' | 'activity';

const DEFAULT_TAB: StudentTabKey = 'overview';

const TABS: ReadonlyArray<TabDefinition<StudentTabKey>> = [
  { key: 'overview', label: 'Overview' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'exams', label: 'Exams' },
  { key: 'payments', label: 'Payments' },
  { key: 'notes', label: 'Notes' },
  { key: 'activity', label: 'Activity' },
];

const TAB_KEYS: ReadonlyArray<string> = TABS.map((tab) => tab.key);

function isTabKey(value: string | null): value is StudentTabKey {
  return value !== null && TAB_KEYS.includes(value);
}

function isStudentStatus(value: string): value is StudentStatus {
  return STUDENT_STATUS_OPTIONS.some((option) => option.value === value);
}

// --------------------------------------------------------------------------- //
// Error helpers
// --------------------------------------------------------------------------- //

/**
 * Everything the API said, minus the field messages already rendered next to
 * their own input. Guarantees that a rejected write always shows *something*.
 */
function alertMessages(error: unknown, renderedFields: ReadonlyArray<string>): string[] {
  if (error === null || error === undefined) return [];
  const out = generalErrorMessages(error);
  const fields = fieldErrors(error);
  for (const [field, messages] of Object.entries(fields)) {
    if (renderedFields.includes(field)) continue;
    for (const message of messages) {
      if (!out.includes(message)) out.push(message);
    }
  }
  return out;
}

/** Inline error list for the top of a modal/form. */
function ErrorAlert({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <div className="alert alert--error" role="alert">
      <span className="alert__icon" aria-hidden="true">
        <Icon name="alertCircle" size={16} />
      </span>
      <div className="alert__content">
        {messages.length === 1 ? (
          <span>{messages[0]}</span>
        ) : (
          <ul className="alert__list">
            {messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Local (client-side) messages win only when the server said nothing. */
function messagesFor(
  error: unknown,
  localErrors: Record<string, string[]>,
  field: string,
): string[] | undefined {
  const remote = fieldError(error, field);
  if (remote !== undefined) return remote;
  const local = localErrors[field];
  return local !== undefined && local.length > 0 ? local : undefined;
}

// --------------------------------------------------------------------------- //
// Change status (audited)
// --------------------------------------------------------------------------- //

interface StatusChangeModalProps {
  student: StudentListItem;
  onClose: () => void;
  onSaved: (student: StudentListItem) => void;
}

function StatusChangeModal({ student, onClose, onSaved }: StatusChangeModalProps) {
  const currentStatus: StudentStatus = isStudentStatus(student.status) ? student.status : 'active';

  const [status, setStatus] = useState<StudentStatus>(currentStatus);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [localErrors, setLocalErrors] = useState<Record<string, string[]>>({});

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (reason.trim() === '') {
      setLocalErrors({ reason: ['A reason is required — it is written to the audit log.'] });
      return;
    }
    setLocalErrors({});
    setSaving(true);
    setError(null);
    try {
      const saved = await studentsApi.changeStatus(student.id, {
        status,
        reason: reason.trim(),
      });
      onSaved(saved);
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      closeOnBackdrop={!saving}
      title="Change status"
      subtitle={`${student.full_name} · ${student.code}`}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="student-status-form" variant="primary" loading={saving}>
            Save status
          </Button>
        </>
      }
    >
      <form
        id="student-status-form"
        className="u-stack"
        onSubmit={(event) => void submit(event)}
        noValidate
      >
        <ErrorAlert messages={alertMessages(error, ['status', 'reason'])} />

        <p className="u-subtle">
          Status never changes through a plain edit: this endpoint records who changed it, when and
          why, and stamps the leave date when the new status is terminal.
        </p>

        <Select<StudentStatus>
          label="New status"
          options={STUDENT_STATUS_OPTIONS}
          value={status}
          onChange={(value) => {
            if (value !== '') setStatus(value);
          }}
          placeholder="Choose a status"
          error={messagesFor(error, localErrors, 'status')}
          required
        />

        <TextField
          label="Reason"
          value={reason}
          onChange={(value) => {
            setReason(value);
            if (localErrors.reason !== undefined) setLocalErrors({});
          }}
          error={messagesFor(error, localErrors, 'reason')}
          hint={`Stored on the audit entry. Current status: ${currentStatus}.`}
          required
          autoFocus
        />

        {/* Keeps Enter-to-submit working; the visible button lives in the footer. */}
        <button type="submit" className="visually-hidden" disabled={saving} tabIndex={-1}>
          Save
        </button>
      </form>
    </Modal>
  );
}

// --------------------------------------------------------------------------- //
// Transfer to another group
// --------------------------------------------------------------------------- //

interface TransferModalProps {
  student: StudentListItem;
  canOverrideCapacity: boolean;
  onClose: () => void;
  onTransferred: () => void;
}

function TransferModal({
  student,
  canOverrideCapacity,
  onClose,
  onTransferred,
}: TransferModalProps) {
  const [targetGroup, setTargetGroup] = useState<number | ''>('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [reason, setReason] = useState('');
  const [allowOverCapacity, setAllowOverCapacity] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [localErrors, setLocalErrors] = useState<Record<string, string[]>>({});

  // Loaded on mount of the modal only - the group catalogue is not needed
  // until somebody actually opens the transfer dialog.
  const groupsResource = useAsyncResource(
    () => groupsApi.list({ page_size: 200 }).then((page) => page.results),
    'student-transfer-groups',
  );
  const groups = groupsResource.data ?? [];

  const selected = groups.find((group) => group.id === targetGroup) ?? null;
  const isFull = selected !== null && selected.seats_available <= 0;

  const options: ReadonlyArray<SelectOption<number>> = groups.map((group) => ({
    value: group.id,
    label:
      group.seats_available <= 0
        ? `${group.name} — full (${group.student_count}/${group.capacity})`
        : `${group.name} — ${group.seats_available} ${
            group.seats_available === 1 ? 'seat' : 'seats'
          } available`,
    disabled: group.name === student.group_name,
  }));

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (targetGroup === '') {
      setLocalErrors({ to_group: ['Choose the group this student is moving into.'] });
      return;
    }
    setLocalErrors({});
    setSaving(true);
    setError(null);
    try {
      const payload: TransferPayload = { student: student.id, to_group: targetGroup };
      if (effectiveDate !== '') payload.effective_date = effectiveDate;
      if (reason.trim() !== '') payload.reason = reason.trim();
      if (isFull) payload.allow_over_capacity = allowOverCapacity;
      await studentsApi.transfer(student.id, payload);
      onTransferred();
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      closeOnBackdrop={!saving}
      title="Transfer to another group"
      subtitle={`${student.full_name} · currently ${
        student.group_name === '' ? 'not enrolled in a group' : student.group_name
      }`}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="student-transfer-form" variant="primary" loading={saving}>
            Transfer student
          </Button>
        </>
      }
    >
      <form
        id="student-transfer-form"
        className="u-stack"
        onSubmit={(event) => void submit(event)}
        noValidate
      >
        <ErrorAlert messages={alertMessages(error, ['to_group', 'effective_date', 'reason'])} />

        {groupsResource.loading ? <LoadingState label="Loading groups…" inline /> : null}

        {groupsResource.error !== null ? (
          <ErrorState error={groupsResource.error} onRetry={groupsResource.reload} />
        ) : null}

        {!groupsResource.loading && groupsResource.error === null && groups.length === 0 ? (
          <EmptyState
            icon="users"
            title="No groups to transfer into"
            message="There are no groups you can see. Create a group first, or ask for the groups.view permission."
          />
        ) : null}

        {groups.length > 0 ? (
          <>
            <Select<number>
              label="Move into"
              options={options}
              value={targetGroup}
              onChange={(value) => {
                setTargetGroup(value);
                setAllowOverCapacity(false);
                if (localErrors.to_group !== undefined) setLocalErrors({});
              }}
              placeholder="Choose a group"
              hint="The student's current group cannot be chosen."
              error={messagesFor(error, localErrors, 'to_group')}
              required
            />

            {selected !== null ? (
              <p className="u-subtle">
                {selected.course_name}
                {selected.teacher_name === '' ? '' : ` · ${selected.teacher_name}`} ·{' '}
                {selected.student_count}/{selected.capacity} enrolled
              </p>
            ) : null}

            {isFull && selected !== null ? (
              canOverrideCapacity ? (
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={allowOverCapacity}
                    onChange={(event) => setAllowOverCapacity(event.target.checked)}
                  />
                  <span>
                    {selected.name} is full. Transfer anyway and record the over-capacity override
                    on the audit log.
                  </span>
                </label>
              ) : (
                <InlineNote tone="warning">
                  {selected.name} is full and you do not have the{' '}
                  <code>{PERMISSIONS.GROUPS_OVERRIDE_CAPACITY}</code> permission, so the server will
                  reject this transfer.
                </InlineNote>
              )
            ) : null}

            <DateField
              label="Effective from"
              value={effectiveDate}
              onChange={setEffectiveDate}
              hint="Leave blank to move them immediately."
              error={messagesFor(error, localErrors, 'effective_date')}
            />

            <TextField
              label="Reason"
              value={reason}
              onChange={setReason}
              hint="Stored on the audit entry for this transfer."
              error={messagesFor(error, localErrors, 'reason')}
            />
          </>
        ) : null}

        <button type="submit" className="visually-hidden" disabled={saving} tabIndex={-1}>
          Transfer
        </button>
      </form>
    </Modal>
  );
}

// --------------------------------------------------------------------------- //
// Archive (status -> archived)
// --------------------------------------------------------------------------- //

interface ArchiveDialogProps {
  student: StudentListItem;
  onClose: () => void;
  onArchived: (student: StudentListItem) => void;
}

function ArchiveDialog({ student, onClose, onArchived }: ArchiveDialogProps) {
  const [reason, setReason] = useState('');
  const [localErrors, setLocalErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<unknown>(null);

  const confirm = async (): Promise<void> => {
    if (reason.trim() === '') {
      setLocalErrors({ reason: ['A reason is required — it is written to the audit log.'] });
      return;
    }
    setLocalErrors({});
    setError(null);
    try {
      const saved = await studentsApi.changeStatus(student.id, {
        status: 'archived',
        reason: reason.trim(),
      });
      onArchived(saved);
    } catch (cause) {
      // Swallowed on purpose: ConfirmDialog only shows its own error when
      // onConfirm throws, and these messages belong next to the field.
      setError(cause);
    }
  };

  return (
    <ConfirmDialog
      open
      tone="danger"
      title={`Archive ${student.full_name}?`}
      confirmLabel="Archive student"
      message={
        <div className="u-stack">
          <p>
            This marks the record <strong>archived</strong>: the student leaves the active roster,
            but <strong>nothing is deleted</strong>. Their attendance, exam results, invoices,
            payments and notes all stay on file, and an administrator can change the status again
            later.
          </p>
          <TextField
            label="Reason"
            value={reason}
            onChange={(value) => {
              setReason(value);
              if (localErrors.reason !== undefined) setLocalErrors({});
            }}
            error={messagesFor(error, localErrors, 'reason')}
            hint="Recorded on the audit entry for this status change."
            required
            autoFocus
          />
          <ErrorAlert messages={alertMessages(error, ['reason'])} />
        </div>
      }
      onConfirm={confirm}
      onCancel={onClose}
    />
  );
}

// --------------------------------------------------------------------------- //
// Page
// --------------------------------------------------------------------------- //

export function StudentDetailPage(): ReactNode {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasPerm } = useAuth();
  const settings = useSettings();
  const [searchParams, setSearchParams] = useSearchParams();

  const rawId = (params.id ?? '').trim();
  const studentId = Number(rawId);
  const validId = /^\d+$/.test(rawId) && Number.isInteger(studentId) && studentId > 0;

  const canManage = hasPerm(PERMISSIONS.STUDENTS_MANAGE);
  const canOverrideCapacity = hasPerm(PERMISSIONS.GROUPS_OVERRIDE_CAPACITY);

  const [editOpen, setEditOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  /** Bumped after a write so the activity timeline is rebuilt from scratch. */
  const [timelineNonce, setTimelineNonce] = useState(0);

  const tabParam = searchParams.get('tab');
  const activeTab: StudentTabKey = isTabKey(tabParam) ? tabParam : DEFAULT_TAB;

  /** Tabs are links: the query string is the single source of truth. */
  const selectTab = useCallback(
    (key: StudentTabKey) => {
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        if (key === DEFAULT_TAB) next.delete('tab');
        else next.set('tab', key);
        return next;
      });
    },
    [setSearchParams],
  );

  const resource = useAsyncResource<StudentListItem | null>(
    () => (validId ? studentsApi.get(studentId) : Promise.resolve(null)),
    `student:${validId ? studentId : rawId}`,
  );

  const student = resource.data;
  const loadGroup = useCallback(
    (groupId: number): void => {
      navigate(`/groups/${groupId}`);
    },
    [navigate],
  );

  if (!validId) {
    return (
      <div className="module-page">
        <Card title="Student">
          <EmptyState
            icon="alertCircle"
            title="That student reference is not valid"
            message={`“${rawId}” is not a student id. Open a student from the list instead.`}
            action={
              <Link className="btn btn--secondary" to="/students">
                Back to students
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const apiError = resource.error instanceof ApiError ? resource.error : null;
  const notFound = apiError !== null && apiError.status === 404;
  const forbidden = apiError !== null && apiError.isAuthError;
  const failed = resource.error !== null && student === null;

  return (
    <div className="module-page">
      <header className="page-header">
        <div className="page-header__heading">
          <Link to="/students" className="u-muted">
            ← All students
          </Link>
        </div>
        <div className="page-header__actions">
          <RefreshButton onClick={resource.reload} label="Reload" />
        </div>
      </header>

      {resource.loading && student === null ? (
        <LoadingState variant="skeleton" rows={5} label="Loading the student…" />
      ) : null}

      {failed && notFound ? (
        <Card title="Student not found">
          <EmptyState
            icon="alertCircle"
            title={`No student with id ${studentId}`}
            message={
              apiError.detail === ''
                ? 'That record does not exist, or it was removed.'
                : apiError.detail
            }
            action={
              <Link className="btn btn--secondary" to="/students">
                Back to students
              </Link>
            }
          />
        </Card>
      ) : null}

      {failed && !notFound && forbidden ? (
        <Card title="Student">
          <EmptyState
            icon="lock"
            title="You do not have access to this student"
            message={
              apiError.detail === ''
                ? `Your role does not include the ${PERMISSIONS.STUDENTS_VIEW} permission, so this profile cannot be opened.`
                : apiError.detail
            }
            action={
              <Link className="btn btn--secondary" to="/students">
                Back to students
              </Link>
            }
          />
        </Card>
      ) : null}

      {failed && !notFound && !forbidden ? (
        <Card title="Student">
          <ErrorState error={resource.error} onRetry={resource.reload} />
        </Card>
      ) : null}

      {student !== null ? (
        <>
          <Card>
            <div className="section-stack">
              <h1 className="visually-hidden">{student.full_name} — student profile</h1>

              <RecordHeader
                avatar={<Avatar name={student.full_name} photo={student.photo} size="lg" />}
                title={student.full_name}
                code={student.code}
                badges={
                  <>
                    <StatusBadge status={student.status} />
                    {student.group_name === '' ? (
                      <span className="u-subtle">Not enrolled in a group</span>
                    ) : (
                      <span className="u-subtle">{student.group_name}</span>
                    )}
                  </>
                }
                actions={
                  canManage ? (
                    <>
                      <Button icon="edit" onClick={() => setEditOpen(true)}>
                        Edit
                      </Button>
                      <Button icon="arrowUpDown" onClick={() => setStatusOpen(true)}>
                        Change status
                      </Button>
                      <Button icon="users" onClick={() => setTransferOpen(true)}>
                        Transfer
                      </Button>
                      {student.status !== 'archived' ? (
                        <Button icon="inbox" variant="danger" onClick={() => setArchiveOpen(true)}>
                          Archive
                        </Button>
                      ) : null}
                    </>
                  ) : undefined
                }
              />

              <div className="meta-grid">
                <DataField label="Group">
                  {student.group_name === '' ? '—' : student.group_name}
                </DataField>
                <DataField label="Course">
                  {student.course_name === '' ? '—' : student.course_name}
                </DataField>
                <DataField label="Teacher">
                  {student.teacher_name === '' ? '—' : student.teacher_name}
                </DataField>
                <DataField label="Phone">{student.phone === '' ? '—' : student.phone}</DataField>
                <DataField label="Email">{student.email === '' ? '—' : student.email}</DataField>
                <DataField label="Guardian">
                  {student.parent_name === '' && student.parent_phone === '' ? (
                    '—'
                  ) : (
                    <span className="cell-stack">
                      <span>{student.parent_name === '' ? '—' : student.parent_name}</span>
                      {student.parent_phone === '' ? null : (
                        <span className="cell-stack__secondary">{student.parent_phone}</span>
                      )}
                    </span>
                  )}
                </DataField>
                <DataField label="Age">
                  {student.age === null
                    ? '—'
                    : `${settings.number(student.age)} ${student.age === 1 ? 'year' : 'years'}`}
                </DataField>
                <DataField label="Registered">{settings.date(student.registered_at)}</DataField>
                <DataField label="Monthly fee">
                  {settings.money(toNumber(student.monthly_fee))}
                </DataField>
              </div>
            </div>
          </Card>

          {!canManage ? (
            <InlineNote>
              You have read-only access to this student. Editing, status changes, notes and
              transfers need the <code>{PERMISSIONS.STUDENTS_MANAGE}</code> permission.
            </InlineNote>
          ) : null}

          <div className="section-stack">
            <TabNav<StudentTabKey>
              tabs={TABS}
              active={activeTab}
              onChange={selectTab}
              label="Student sections"
              idPrefix="student-detail"
            />

            <TabPanel
              id={`student-detail-panel-${activeTab}`}
              labelId={`student-detail-tab-${activeTab}`}
            >
              {activeTab === 'overview' ? (
                <StudentOverviewTab studentId={student.id} onOpenGroup={loadGroup} />
              ) : null}
              {activeTab === 'attendance' ? <StudentAttendanceTab studentId={student.id} /> : null}
              {activeTab === 'exams' ? <StudentExamsTab studentId={student.id} /> : null}
              {activeTab === 'payments' ? <StudentPaymentsTab studentId={student.id} /> : null}
              {activeTab === 'notes' ? (
                <StudentNotesTab
                  studentId={student.id}
                  onChanged={() => setTimelineNonce((current) => current + 1)}
                />
              ) : null}
              {activeTab === 'activity' ? (
                <StudentActivityTab key={timelineNonce} studentId={student.id} />
              ) : null}
            </TabPanel>
          </div>
        </>
      ) : null}

      {editOpen && student !== null ? (
        <StudentFormModal
          open
          mode="edit"
          student={student}
          onClose={() => setEditOpen(false)}
          onSaved={(saved) => {
            setEditOpen(false);
            resource.setData(saved);
          }}
        />
      ) : null}

      {statusOpen && student !== null ? (
        <StatusChangeModal
          student={student}
          onClose={() => setStatusOpen(false)}
          onSaved={(saved) => {
            setStatusOpen(false);
            resource.setData(saved);
            setTimelineNonce((current) => current + 1);
          }}
        />
      ) : null}

      {transferOpen && student !== null ? (
        <TransferModal
          student={student}
          canOverrideCapacity={canOverrideCapacity}
          onClose={() => setTransferOpen(false)}
          onTransferred={() => {
            setTransferOpen(false);
            resource.reload();
            setTimelineNonce((current) => current + 1);
          }}
        />
      ) : null}

      {archiveOpen && student !== null ? (
        <ArchiveDialog
          student={student}
          onClose={() => setArchiveOpen(false)}
          onArchived={(saved) => {
            setArchiveOpen(false);
            resource.setData(saved);
            setTimelineNonce((current) => current + 1);
          }}
        />
      ) : null}
    </div>
  );
}

export default StudentDetailPage;
