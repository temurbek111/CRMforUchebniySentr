/**
 * Create / edit form for a group (POST/PATCH /api/groups/).
 *
 * Field-level problems arrive in the API's uniform error body
 * (`{detail, errors: {field: ["..."]}}`) and are rendered inline; everything
 * else is shown in the alert at the top. Capacity is enforced by the server and
 * by the room the group sits in, so this form only ever *warns* - it never
 * blocks a submit on a client-side capacity guess.
 */

import { useState, type FormEvent } from 'react';
import { Button, DateField, Icon, Modal, Select, TextField } from '../../components';
import {
  GROUP_STATUS_OPTIONS,
  groupsApi,
  type Group,
  type GroupStatus,
  type GroupWritePayload,
} from '../students/api';
import { fieldErrors, generalErrorMessages, useReferenceData } from '../students/hooks';
import { AsyncSection } from '../students/ui';

export interface GroupFormValues {
  name: string;
  course: number | '';
  teacher: number | '';
  room: number | '';
  capacity: string;
  monthly_fee: string;
  level: string;
  start_date: string;
  end_date: string;
  status: GroupStatus;
  notes: string;
}

export const EMPTY_GROUP_FORM: GroupFormValues = {
  name: '',
  course: '',
  teacher: '',
  room: '',
  capacity: '15',
  monthly_fee: '',
  level: '',
  start_date: '',
  end_date: '',
  status: 'active',
  notes: '',
};

/** Prefill from an existing group row (POST/PATCH payload shape). */
export function groupFormValuesFrom(group: Group): GroupFormValues {
  const fee = group.monthly_fee;
  return {
    name: group.name,
    course: group.course,
    teacher: group.teacher ?? '',
    room: group.room ?? '',
    capacity: String(group.capacity),
    monthly_fee: fee === null || fee === undefined ? '' : String(fee),
    level: group.level,
    start_date: group.start_date ?? '',
    end_date: group.end_date ?? '',
    status: (group.status as GroupStatus) ?? 'active',
    notes: group.notes,
  };
}

function buildPayload(values: GroupFormValues): GroupWritePayload {
  const payload: GroupWritePayload = {
    name: values.name.trim(),
    capacity: Number(values.capacity),
    monthly_fee: values.monthly_fee.trim(),
    level: values.level.trim(),
    status: values.status,
    notes: values.notes.trim(),
  };

  if (values.course !== '') payload.course = values.course;
  payload.teacher = values.teacher === '' ? null : values.teacher;
  payload.room = values.room === '' ? null : values.room;
  payload.start_date = values.start_date === '' ? null : values.start_date;
  payload.end_date = values.end_date === '' ? null : values.end_date;

  return payload;
}

export interface GroupFormProps {
  mode: 'create' | 'edit';
  initial?: GroupFormValues;
  /** Required in edit mode: the record to PATCH. */
  groupId?: number;
  onSaved: (group: Group) => void;
  /** id of the owning <form>, so the modal footer button can submit it. */
  formId: string;
}

export function GroupForm({ mode, initial, groupId, onSaved, formId }: GroupFormProps) {
  const reference = useReferenceData();
  const [values, setValues] = useState<GroupFormValues>(initial ?? EMPTY_GROUP_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [localErrors, setLocalErrors] = useState<Record<string, string[]>>({});

  const courses = reference.data?.courses ?? [];
  const teachers = reference.data?.teachers ?? [];
  const rooms = reference.data?.rooms ?? [];

  const set = <K extends keyof GroupFormValues>(key: K, value: GroupFormValues[K]): void => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  /** Server messages win (they are authoritative); local checks are the fallback. */
  const apiErrors = fieldErrors(error);
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
    if (values.name.trim() === '') problems.name = ['A group name is required.'];
    if (values.course === '') problems.course = ['Pick the course this group teaches.'];

    const capacity = Number(values.capacity);
    if (values.capacity.trim() === '' || !Number.isInteger(capacity) || capacity < 1) {
      problems.capacity = ['Capacity must be a whole number of at least 1.'];
    }

    const fee = Number(values.monthly_fee);
    if (values.monthly_fee.trim() === '' || !Number.isFinite(fee) || fee < 0) {
      problems.monthly_fee = ['Enter the monthly fee (0 or more).'];
    }

    if (values.start_date !== '' && values.end_date !== '' && values.end_date < values.start_date) {
      problems.end_date = ['The end date cannot be before the start date.'];
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
        mode === 'create' || groupId === undefined
          ? await groupsApi.create(payload)
          : await groupsApi.update(groupId, payload);
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
          <span className="alert__icon" aria-hidden="true">
            <Icon name="alertCircle" size={16} />
          </span>
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

      <AsyncSection
        loading={reference.loading}
        error={null}
        inline
        loadingLabel="Loading courses, teachers and rooms…"
      >
        <div className="form-grid form-grid--two">
          <TextField
            label="Group name"
            value={values.name}
            onChange={(value) => set('name', value)}
            error={messagesFor('name')}
            required
            autoFocus
            hint="Names are unique across the centre."
          />
          <Select<number>
            label="Course"
            options={courses.map((entry) => ({ value: entry.id, label: entry.name }))}
            value={values.course}
            onChange={(value) => {
              if (value !== '') set('course', value);
            }}
            placeholder="Select a course"
            error={messagesFor('course')}
            required
          />
          <Select<number>
            label="Teacher"
            options={teachers.map((entry) => ({ value: entry.id, label: entry.full_name }))}
            value={values.teacher}
            onChange={(value) => set('teacher', value)}
            placeholder="No teacher assigned"
            error={messagesFor('teacher')}
          />
          <Select<number>
            label="Room"
            options={rooms.map((entry) => ({
              value: entry.id,
              label: `${entry.name} (holds ${entry.capacity})`,
            }))}
            value={values.room}
            onChange={(value) => set('room', value)}
            placeholder="No room assigned"
            error={messagesFor('room')}
            hint="The server rejects a room smaller than the enrolled roster."
          />
          <TextField
            label="Capacity"
            type="number"
            min="1"
            step="1"
            value={values.capacity}
            onChange={(value) => set('capacity', value)}
            error={messagesFor('capacity')}
            required
          />
          <TextField
            label="Monthly fee"
            type="number"
            min="0"
            step="0.01"
            value={values.monthly_fee}
            onChange={(value) => set('monthly_fee', value)}
            error={messagesFor('monthly_fee')}
            required
          />
          <TextField
            label="Level"
            value={values.level}
            onChange={(value) => set('level', value)}
            error={messagesFor('level')}
            placeholder="e.g. Beginner"
          />
          <Select<GroupStatus>
            label="Status"
            options={GROUP_STATUS_OPTIONS}
            value={values.status}
            onChange={(value) => {
              if (value !== '') set('status', value);
            }}
            error={messagesFor('status')}
          />
          <DateField
            label="Starts"
            value={values.start_date}
            onChange={(value) => set('start_date', value)}
            error={messagesFor('start_date')}
          />
          <DateField
            label="Ends"
            value={values.end_date}
            onChange={(value) => set('end_date', value)}
            error={messagesFor('end_date')}
            hint="Leave blank for an open-ended group."
          />
          <div className="form-grid--full field">
            <label className="field__label" htmlFor={`${formId}-notes`}>
              Notes
            </label>
            <textarea
              id={`${formId}-notes`}
              className="textarea"
              rows={3}
              value={values.notes}
              onChange={(event) => set('notes', event.target.value)}
            />
          </div>
        </div>
      </AsyncSection>

      {/* The visible actions live in the modal footer; this keeps Enter working. */}
      <button type="submit" className="visually-hidden" disabled={saving} tabIndex={-1}>
        Save
      </button>
    </form>
  );
}

export interface GroupFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  group?: Group | null;
  onClose: () => void;
  onSaved: (group: Group) => void;
}

/** Modal wrapper: header, footer submit button and form live together. */
export function GroupFormModal({ open, mode, group, onClose, onSaved }: GroupFormModalProps) {
  const formId = `group-form-${mode}-${group?.id ?? 'new'}`;
  const initial = group ? groupFormValuesFrom(group) : EMPTY_GROUP_FORM;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={mode === 'create' ? 'New group' : `Edit ${group?.name ?? 'group'}`}
      subtitle={
        mode === 'create'
          ? 'Pick a course, a teacher and a room. Capacity is enforced by the server.'
          : group?.course_name
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary">
            {mode === 'create' ? 'Create group' : 'Save changes'}
          </Button>
        </>
      }
    >
      <GroupForm
        key={formId}
        mode={mode}
        initial={initial}
        groupId={group?.id}
        onSaved={onSaved}
        formId={formId}
      />
    </Modal>
  );
}

export default GroupFormModal;
