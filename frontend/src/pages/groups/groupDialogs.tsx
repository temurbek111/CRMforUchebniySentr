/**
 * Group action dialogs: change teacher, enrol, remove (archive) and transfer.
 *
 * Every mutation goes through `groupsApi` - this module never re-implements the
 * group API. Capacity is a *server* rule: the dialogs surface the server's
 * verdict inline (`errors.group` / `errors.student`) and only ever warn about a
 * full group client-side.
 *
 * Removing a student from a group is an ARCHIVE: the membership is closed
 * (`left_at` is stamped, status becomes `left`/`transferred`) and the student,
 * their attendance, marks and payments are untouched. Nothing here is a delete,
 * and the copy says so explicitly.
 */

import { useState, type FormEvent } from 'react';
import {
  Button,
  ConfirmDialog,
  DateField,
  Icon,
  Modal,
  SearchInput,
  Select,
  TextField,
} from '../../components';
import { useAuth } from '../../auth/AuthContext';
import { useSettings } from '../../settings/SettingsContext';
import { PERMISSIONS } from '../../types';
import {
  groupsApi,
  studentsApi,
  type EnrollPayload,
  type Group,
  type GroupCapacity,
  type GroupMembership,
  type RemoveStudentPayload,
  type StudentListParams,
  type StudentListItem,
  type TransferPayload,
} from '../students/api';
import { fieldErrors, generalErrorMessages, useAsyncResource, useReferenceData } from '../students/hooks';
import { AsyncSection, Avatar, InlineNote } from '../students/ui';

/** The minimal student identity the pickers and dialogs pass around. */
export interface StudentOption {
  id: number;
  name: string;
  code: string;
  /** Current group name, so the picker can show where they are now. */
  groupName: string;
}

function toOption(row: StudentListItem): StudentOption {
  return { id: row.id, name: row.full_name, code: row.code, groupName: row.group_name };
}

// --------------------------------------------------------------------------- //
// Error rendering
// --------------------------------------------------------------------------- //

/** Inline alert for messages the API puts on a field with no visible control. */
function ErrorAlert({ messages }: { messages: ReadonlyArray<string> }) {
  if (messages.length === 0) return null;
  return (
    <InlineNote tone="error">
      {messages.length === 1 ? (
        <span>{messages[0]}</span>
      ) : (
        <ul className="alert__list">
          {messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
    </InlineNote>
  );
}

/** Duplicate the general messages plus any keys that have no input of their own. */
function serverMessages(error: unknown, extraFields: ReadonlyArray<string>): string[] {
  const out = generalErrorMessages(error);
  const errors = fieldErrors(error);
  for (const field of extraFields) {
    for (const message of errors[field] ?? []) {
      if (!out.includes(message)) out.push(message);
    }
  }
  return out;
}

/** Shown when the roster already fills the group. Never blocks the submit. */
function CapacityWarning({
  enrolled,
  limit,
  canOverride,
}: {
  enrolled: number;
  limit: number;
  canOverride: boolean;
}) {
  return (
    <InlineNote tone="warning">
      <strong>
        This group is full ({enrolled}/{limit}).
      </strong>{' '}
      {canOverride
        ? 'Tick the capacity override below to proceed — the server still has the final say.'
        : 'The server will reject this unless it carries a capacity override, and your account does not hold the groups.override_capacity permission.'}
    </InlineNote>
  );
}

// --------------------------------------------------------------------------- //
// Student picker
// --------------------------------------------------------------------------- //

export interface StudentPickerProps {
  selected: StudentOption | null;
  onSelect: (student: StudentOption | null) => void;
  /** Message rendered under the picker (server or local validation). */
  error?: string[];
  /** Students that cannot be chosen (already in the target group). */
  disabledIds?: ReadonlyArray<number>;
}

/**
 * Search-and-pick control for a student. Loads GET /api/students/ for the
 * current term; a student already in the group is shown but not selectable.
 */
export function StudentPicker({
  selected,
  onSelect,
  error,
  disabledIds = [],
}: StudentPickerProps) {
  const [search, setSearch] = useState('');

  const resource = useAsyncResource(async () => {
    const params: StudentListParams = { page_size: 25, ordering: 'last_name' };
    const term = search.trim();
    if (term !== '') params.search = term;
    const page = await studentsApi.list(params);
    return page.results;
  }, `group-student-picker:${search}`);

  const rows = resource.data ?? [];

  return (
    <div className="picker">
      {selected !== null ? (
        <div className="picker__selection">
          <Avatar name={selected.name} size="sm" />
          <span className="picker__option-main">
            <span className="picker__option-name">{selected.name}</span>
            <span className="picker__option-meta">
              {selected.code}
              {selected.groupName !== '' ? ` · currently in ${selected.groupName}` : ''}
            </span>
          </span>
          <Button size="sm" icon="close" onClick={() => onSelect(null)}>
            Change
          </Button>
        </div>
      ) : (
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search students by name, code or phone"
          label="Search students"
          debounceMs={300}
        />
      )}

      {error !== undefined && error.length > 0 ? (
        <p className="field__error">{error.join(' ')}</p>
      ) : null}

      {selected === null ? (
        <AsyncSection
          loading={resource.loading}
          error={resource.error}
          onRetry={resource.reload}
          inline
          loadingLabel="Searching students…"
          isEmpty={rows.length === 0}
          emptyIcon="students"
          emptyTitle={search.trim() === '' ? 'No students yet' : 'No student matches that search'}
          emptyMessage={
            search.trim() === ''
              ? 'Add students in the Students module first.'
              : 'Try a different name, code or phone number.'
          }
        >
          <div className="picker__results">
            {rows.map((row) => {
              const disabled = disabledIds.includes(row.id);
              return (
                <button
                  key={row.id}
                  type="button"
                  className="picker__option"
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    setSearch('');
                    onSelect(toOption(row));
                  }}
                >
                  <Avatar name={row.full_name} photo={row.photo} size="sm" />
                  <span className="picker__option-main">
                    <span className="picker__option-name">{row.full_name}</span>
                    <span className="picker__option-meta">
                      {row.code}
                      {row.group_name !== '' ? ` · in ${row.group_name}` : ' · no group'}
                    </span>
                  </span>
                  {disabled ? <span className="picker__option-meta">Already enrolled</span> : null}
                </button>
              );
            })}
          </div>
        </AsyncSection>
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Change teacher
// --------------------------------------------------------------------------- //

export interface ChangeTeacherDialogProps {
  group: Group;
  onClose: () => void;
  onChanged: (group: Group) => void;
}

/** POST /api/groups/{id}/change-teacher/ — audited on the server. */
export function ChangeTeacherDialog({ group, onClose, onChanged }: ChangeTeacherDialogProps) {
  const reference = useReferenceData();
  const [teacher, setTeacher] = useState<number | ''>(group.teacher ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const formId = `group-teacher-${group.id}`;

  const teachers = reference.data?.teachers ?? [];
  const teacherMessages = fieldErrors(error)['teacher'];
  const generalMessages = generalErrorMessages(error);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const updated = await groupsApi.changeTeacher(group.id, {
        teacher: teacher === '' ? null : teacher,
      });
      onChanged(updated);
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
      title="Change teacher"
      subtitle={group.name}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" loading={saving}>
            Change teacher
          </Button>
        </>
      }
    >
      <form id={formId} className="u-stack" onSubmit={(event) => void submit(event)} noValidate>
        <ErrorAlert messages={generalMessages} />

        <p className="u-muted">
          Currently taught by <strong>{group.teacher_name || 'nobody'}</strong>. The change is
          recorded in the audit log; existing attendance, exams and invoices keep the teacher they
          were created with.
        </p>

        <AsyncSection
          loading={reference.loading}
          error={null}
          inline
          loadingLabel="Loading teachers…"
        >
          <Select<number>
            label="Teacher"
            options={teachers.map((entry) => ({ value: entry.id, label: entry.full_name }))}
            value={teacher}
            onChange={(value) => setTeacher(value)}
            placeholder="No teacher assigned"
            error={teacherMessages}
            hint="Leave it unassigned to clear the teacher."
          />
        </AsyncSection>

        <button type="submit" className="visually-hidden" disabled={saving} tabIndex={-1}>
          Change teacher
        </button>
      </form>
    </Modal>
  );
}

// --------------------------------------------------------------------------- //
// Enrol
// --------------------------------------------------------------------------- //

export interface EnrollStudentDialogProps {
  group: Group;
  /** Live state from /capacity/ when the detail page already has it. */
  capacity: GroupCapacity | null;
  onClose: () => void;
  onEnrolled: (membership: GroupMembership) => void;
}

/** POST /api/groups/{id}/enroll/ */
export function EnrollStudentDialog({
  group,
  capacity,
  onClose,
  onEnrolled,
}: EnrollStudentDialogProps) {
  const { hasPerm } = useAuth();
  const canOverride = hasPerm(PERMISSIONS.GROUPS_OVERRIDE_CAPACITY);

  const [student, setStudent] = useState<StudentOption | null>(null);
  const [fee, setFee] = useState('');
  const [joinedAt, setJoinedAt] = useState('');
  const [note, setNote] = useState('');
  const [allowOverCapacity, setAllowOverCapacity] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [localErrors, setLocalErrors] = useState<Record<string, string[]>>({});
  const formId = `group-enroll-${group.id}`;

  const enrolled = capacity?.enrolled ?? group.student_count;
  const limit = capacity?.capacity ?? group.capacity;
  const isFull = capacity?.is_full ?? (limit > 0 && enrolled >= limit);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (student === null) {
      setLocalErrors({ student: ['Pick the student to enrol.'] });
      return;
    }
    if (fee.trim() !== '' && !Number.isFinite(Number(fee))) {
      setLocalErrors({ fee: ['Enter a valid fee, or leave it blank to use the group fee.'] });
      return;
    }

    setLocalErrors({});
    setSaving(true);
    setError(null);
    try {
      const payload: EnrollPayload = { student: student.id };
      if (fee.trim() !== '') payload.fee = fee.trim();
      if (joinedAt !== '') payload.joined_at = joinedAt;
      if (note.trim() !== '') payload.note = note.trim();
      if (canOverride && allowOverCapacity) payload.allow_over_capacity = true;
      const membership = await groupsApi.enroll(group.id, payload);
      onEnrolled(membership);
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
      size="lg"
      title="Enrol a student"
      subtitle={group.name}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" loading={saving}>
            Enrol student
          </Button>
        </>
      }
    >
      <form id={formId} className="u-stack" onSubmit={(event) => void submit(event)} noValidate>
        <ErrorAlert messages={serverMessages(error, ['group'])} />

        {isFull ? (
          <CapacityWarning enrolled={enrolled} limit={limit} canOverride={canOverride} />
        ) : (
          <p className="u-muted">
            {limit - enrolled} of {limit} seat{limit - enrolled === 1 ? '' : 's'} free in this group.
            Enrolling a lead or trial student also activates them on the server.
          </p>
        )}

        <div className="field">
          <span className="field__label">Student</span>
          <StudentPicker
            selected={student}
            onSelect={setStudent}
            error={localErrors.student ?? fieldErrors(error)['student']}
          />
        </div>

        <div className="form-grid form-grid--two">
          <TextField
            label="Fee override"
            type="number"
            min="0"
            step="0.01"
            value={fee}
            onChange={setFee}
            error={fieldErrors(error)['fee']}
            hint="Leave blank to use the group's monthly fee."
          />
          <DateField
            label="Joined on"
            value={joinedAt}
            onChange={setJoinedAt}
            error={fieldErrors(error)['joined_at']}
            hint="Defaults to today."
          />
          <TextField
            label="Note"
            className="form-grid--full"
            value={note}
            onChange={setNote}
            error={fieldErrors(error)['note']}
            placeholder="Anything the teacher should know"
          />
        </div>

        {canOverride ? (
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={allowOverCapacity}
              onChange={(event) => setAllowOverCapacity(event.target.checked)}
            />
            <span>
              Allow enrolment over capacity. The server still validates this and records the
              override in the audit log.
            </span>
          </label>
        ) : null}

        <button type="submit" className="visually-hidden" disabled={saving} tabIndex={-1}>
          Enrol student
        </button>
      </form>
    </Modal>
  );
}

// --------------------------------------------------------------------------- //
// Remove (archive)
// --------------------------------------------------------------------------- //

export interface RemoveStudentDialogProps {
  group: Group;
  /** Set when the action starts from the roster row (no picker needed). */
  membership?: GroupMembership | null;
  onClose: () => void;
  onRemoved: (membership: GroupMembership) => void;
}

/**
 * POST /api/groups/{id}/remove-student/
 *
 * This is an archive: the membership is closed with `left_at` + status `left`.
 * The ConfirmDialog owns the request, so a server refusal is shown inside it.
 */
export function RemoveStudentDialog({
  group,
  membership,
  onClose,
  onRemoved,
}: RemoveStudentDialogProps) {
  const settings = useSettings();
  const [student, setStudent] = useState<StudentOption | null>(
    membership
      ? {
          id: membership.student,
          name: membership.student_name,
          code: membership.student_code,
          groupName: membership.group_name,
        }
      : null,
  );
  const [reason, setReason] = useState('');
  const [leftAt, setLeftAt] = useState('');
  const [localErrors, setLocalErrors] = useState<Record<string, string[]>>({});
  const [confirming, setConfirming] = useState(false);
  const formId = `group-remove-${group.id}-${membership?.student ?? 'pick'}`;

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (student === null) {
      setLocalErrors({ student: ['Pick the student who is leaving this group.'] });
      return;
    }
    setLocalErrors({});
    setConfirming(true);
  };

  const confirm = async (): Promise<void> => {
    if (student === null) return;
    const payload: RemoveStudentPayload = { student: student.id };
    if (reason.trim() !== '') payload.reason = reason.trim();
    if (leftAt !== '') payload.left_at = leftAt;
    const updated = await groupsApi.removeStudent(group.id, payload);
    onRemoved(updated);
  };

  return (
    <>
      <Modal
        open={!confirming}
        onClose={onClose}
        title="Archive a student's membership"
        subtitle={group.name}
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" form={formId} variant="danger">
              Review and archive
            </Button>
          </>
        }
      >
        <form id={formId} className="u-stack" onSubmit={submit} noValidate>
          <InlineNote tone="info">
            This is <strong>not a delete</strong>. The membership is closed with a leaving date and
            the student keeps every record — attendance, exams and payments stay intact, and they
            can be enrolled again later.
          </InlineNote>

          <div className="field">
            <span className="field__label">Student</span>
            <StudentPicker
              selected={student}
              onSelect={setStudent}
              error={localErrors.student}
            />
          </div>

          <div className="form-grid form-grid--two">
            <TextField
              label="Reason"
              value={reason}
              onChange={setReason}
              placeholder="e.g. Finished the course"
              hint="Stored on the membership record."
            />
            <DateField
              label="Left on"
              value={leftAt}
              onChange={setLeftAt}
              hint="Defaults to today."
            />
          </div>

          <button type="submit" className="visually-hidden" tabIndex={-1}>
            Review and archive
          </button>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirming}
        tone="danger"
        title="Archive this membership?"
        confirmLabel="Archive membership"
        message={
          student === null ? null : (
            <div className="u-stack">
              <p>
                <strong>{student.name}</strong> ({student.code}) is archived out of{' '}
                <strong>{group.name}</strong>
                {leftAt !== '' ? ` from ${settings.date(leftAt)}` : ' today'}.
              </p>
              <p className="u-muted">
                The membership keeps its history: <code>left_at</code> is stamped and its status
                becomes <code>left</code>. Nothing is deleted — the student, their attendance, exam
                results and payments are all untouched, and the past membership stays visible in the
                group's history.
              </p>
              {reason.trim() !== '' ? (
                <p className="u-muted">Reason recorded: {reason.trim()}</p>
              ) : null}
            </div>
          )
        }
        onConfirm={confirm}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

// --------------------------------------------------------------------------- //
// Transfer
// --------------------------------------------------------------------------- //

export interface TransferStudentDialogProps {
  group: Group;
  /** Set when the action starts from the roster row. */
  membership?: GroupMembership | null;
  onClose: () => void;
  onTransferred: (membership: GroupMembership) => void;
}

/** POST /api/groups/{id}/transfer/ — closes this membership and opens another. */
export function TransferStudentDialog({
  group,
  membership,
  onClose,
  onTransferred,
}: TransferStudentDialogProps) {
  const settings = useSettings();
  const { hasPerm } = useAuth();
  const canOverride = hasPerm(PERMISSIONS.GROUPS_OVERRIDE_CAPACITY);

  const [student, setStudent] = useState<StudentOption | null>(
    membership
      ? {
          id: membership.student,
          name: membership.student_name,
          code: membership.student_code,
          groupName: membership.group_name,
        }
      : null,
  );
  const [toGroup, setToGroup] = useState<number | ''>('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [reason, setReason] = useState('');
  const [allowOverCapacity, setAllowOverCapacity] = useState(false);
  const [localErrors, setLocalErrors] = useState<Record<string, string[]>>({});
  const [confirming, setConfirming] = useState(false);
  const formId = `group-transfer-${group.id}-${membership?.student ?? 'pick'}`;

  // Destination options: every other group, with its live occupancy.
  const optionsResource = useAsyncResource(async () => {
    const page = await groupsApi.list({ page_size: 200 });
    return page.results.filter((entry) => entry.id !== group.id);
  }, `group-transfer-options:${group.id}`);

  const destinations = optionsResource.data ?? [];
  const destination = destinations.find((entry) => entry.id === toGroup);
  const destinationFull =
    destination !== undefined &&
    destination.capacity > 0 &&
    destination.student_count >= destination.capacity;

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const problems: Record<string, string[]> = {};
    if (student === null) problems.student = ['Pick the student to transfer.'];
    if (toGroup === '') problems.to_group = ['Pick the destination group.'];
    if (Object.keys(problems).length > 0) {
      setLocalErrors(problems);
      return;
    }
    setLocalErrors({});
    setConfirming(true);
  };

  const confirm = async (): Promise<void> => {
    if (student === null || toGroup === '') return;
    const payload: TransferPayload = { student: student.id, to_group: toGroup };
    if (effectiveDate !== '') payload.effective_date = effectiveDate;
    if (reason.trim() !== '') payload.reason = reason.trim();
    if (canOverride && allowOverCapacity) payload.allow_over_capacity = true;
    const created = await groupsApi.transfer(group.id, payload);
    onTransferred(created);
  };

  return (
    <>
      <Modal
        open={!confirming}
        onClose={onClose}
        size="lg"
        title="Transfer a student"
        subtitle={group.name}
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" form={formId} variant="primary">
              Review transfer
            </Button>
          </>
        }
      >
        <form id={formId} className="u-stack" onSubmit={submit} noValidate>
          <p className="u-muted">
            The current membership is closed as <code>transferred</code> — it stays as history — and
            a new membership is opened in the destination group.
          </p>

          <div className="field">
            <span className="field__label">Student</span>
            <StudentPicker selected={student} onSelect={setStudent} error={localErrors.student} />
          </div>

          <AsyncSection
            loading={optionsResource.loading}
            error={optionsResource.error}
            onRetry={optionsResource.reload}
            inline
            loadingLabel="Loading groups…"
            isEmpty={destinations.length === 0}
            emptyIcon="academic"
            emptyTitle="No other group to transfer into"
            emptyMessage="Create another group first, then transfer this student."
          >
            <Select<number>
              label="Destination group"
              options={destinations.map((entry) => ({
                value: entry.id,
                label: `${entry.name} · ${entry.course_name} (${entry.student_count}/${entry.capacity})`,
              }))}
              value={toGroup}
              onChange={(value) => setToGroup(value)}
              placeholder="Select a group"
              error={localErrors.to_group}
            />
          </AsyncSection>

          {destinationFull ? (
            <InlineNote tone="warning">
              <strong>{destination?.name}</strong> is full ({destination?.student_count}/
              {destination?.capacity}). The server will reject the transfer unless it carries a
              capacity override
              {canOverride ? ' — tick the box below to send one.' : ', which needs the groups.override_capacity permission.'}
            </InlineNote>
          ) : null}

          <div className="form-grid form-grid--two">
            <DateField
              label="Effective date"
              value={effectiveDate}
              onChange={setEffectiveDate}
              hint="Defaults to today."
            />
            <TextField
              label="Reason"
              value={reason}
              onChange={setReason}
              placeholder="e.g. Moved to a more suitable level"
            />
          </div>

          {canOverride ? (
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={allowOverCapacity}
                onChange={(event) => setAllowOverCapacity(event.target.checked)}
              />
              <span>Allow the destination to go over capacity (audited on the server).</span>
            </label>
          ) : null}

          <button type="submit" className="visually-hidden" tabIndex={-1}>
            Review transfer
          </button>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirming}
        tone="primary"
        title="Confirm the transfer"
        confirmLabel="Transfer student"
        message={
          student === null ? null : (
            <div className="u-stack">
              <p>
                Move <strong>{student.name}</strong> out of <strong>{group.name}</strong> and into{' '}
                <strong>{destination?.name ?? 'the destination group'}</strong>
                {effectiveDate !== '' ? ` from ${settings.date(effectiveDate)}` : ' today'}.
              </p>
              <p className="u-muted">
                Their membership here keeps its history (<code>left_at</code> + status{' '}
                <code>transferred</code>) and a new membership is opened in the destination. Nothing
                is deleted.
              </p>
              {reason.trim() !== '' ? (
                <p className="u-muted">Reason recorded: {reason.trim()}</p>
              ) : null}
            </div>
          )
        }
        onConfirm={confirm}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

/** Small helper so pages can render a "not permitted" note consistently. */
export function PermissionNotice({ code }: { code: string }) {
  return (
    <InlineNote tone="info">
      <span className="u-row">
        <Icon name="lock" size={14} />
        This action needs the <code>{code}</code> permission.
      </span>
    </InlineNote>
  );
}
