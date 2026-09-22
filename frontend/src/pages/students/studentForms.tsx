/**
 * Create / edit form for a student.
 *
 * Field-level problems are rendered inline from the API's uniform error body
 * (`{detail, errors: {field: ["..."]}}`); everything else is shown in an alert
 * at the top. The submit button lives in the modal footer and submits the form
 * through `form={formId}`, so Enter-to-submit keeps working.
 *
 * Scope note: `GET /api/students/{id}/` answers with `StudentListSerializer`,
 * which does not expose date of birth, gender, address, notes or the fee
 * override. Those fields are therefore only offered when creating. Status is
 * never PATCHed - `POST /students/{id}/change-status/` is the audited path and
 * it stamps `left_at`/`status_changed_at` correctly.
 */

import { useState, type FormEvent } from 'react';
import { Button, DateField, Icon, Modal, Select, TextField } from '../../components';
import {
  GENDER_OPTIONS,
  GUARDIAN_RELATIONS,
  STUDENT_STATUS_OPTIONS,
  studentsApi,
  type StudentListItem,
  type StudentStatus,
  type StudentWritePayload,
} from './api';
import { fieldErrors, generalErrorMessages } from './hooks';

export interface StudentFormValues {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  registered_at: string;
  guardian_name: string;
  guardian_phone: string;
  guardian_relation: string;
  date_of_birth: string;
  gender: string;
  status: StudentStatus;
  address: string;
  monthly_fee_override: string;
  notes: string;
}

export const EMPTY_STUDENT_FORM: StudentFormValues = {
  first_name: '',
  last_name: '',
  phone: '',
  email: '',
  registered_at: '',
  guardian_name: '',
  guardian_phone: '',
  guardian_relation: 'guardian',
  date_of_birth: '',
  gender: 'unspecified',
  status: 'active',
  address: '',
  monthly_fee_override: '',
  notes: '',
};

/** Prefill the editable subset from a list row (guardian comes from parent_*). */
export function studentFormValuesFrom(student: StudentListItem): StudentFormValues {
  return {
    ...EMPTY_STUDENT_FORM,
    first_name: student.first_name,
    last_name: student.last_name,
    phone: student.phone,
    email: student.email,
    registered_at: student.registered_at ?? '',
    guardian_name: student.parent_name,
    guardian_phone: student.parent_phone,
  };
}

function trimmed(value: string): string {
  return value.trim();
}

function buildPayload(values: StudentFormValues, mode: 'create' | 'edit'): StudentWritePayload {
  const payload: StudentWritePayload = {
    first_name: trimmed(values.first_name),
    last_name: trimmed(values.last_name),
    phone: trimmed(values.phone),
    email: trimmed(values.email),
  };

  if (values.registered_at !== '') payload.registered_at = values.registered_at;

  if (trimmed(values.guardian_name) !== '' || trimmed(values.guardian_phone) !== '') {
    payload.guardian_name = trimmed(values.guardian_name);
    payload.guardian_phone = trimmed(values.guardian_phone);
  }

  if (mode === 'create') {
    payload.status = values.status;
    payload.gender = values.gender;
    payload.guardian_relation = values.guardian_relation;
    payload.address = trimmed(values.address);
    payload.notes = trimmed(values.notes);
    payload.date_of_birth = values.date_of_birth === '' ? null : values.date_of_birth;
    payload.monthly_fee_override =
      trimmed(values.monthly_fee_override) === '' ? null : trimmed(values.monthly_fee_override);
  }

  return payload;
}

export interface StudentFormProps {
  mode: 'create' | 'edit';
  initial?: StudentFormValues;
  /** Required in edit mode: the record to PATCH. */
  studentId?: number;
  onSaved: (student: StudentListItem) => void;
  /** id of the owning <form>, so the modal footer button can submit it. */
  formId: string;
}

export function StudentForm({
  mode,
  initial,
  studentId,
  onSaved,
  formId,
}: StudentFormProps) {
  const [values, setValues] = useState<StudentFormValues>(initial ?? EMPTY_STUDENT_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [localErrors, setLocalErrors] = useState<Record<string, string[]>>({});

  const set = <K extends keyof StudentFormValues>(key: K, value: StudentFormValues[K]): void => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  /**
   * Inline messages for one field: the server's verdict wins (it is
   * authoritative), falling back to the client-side required checks.
   */
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
    if (trimmed(values.first_name) === '') problems.first_name = ['A first name is required.'];
    if (trimmed(values.last_name) === '') problems.last_name = ['A last name is required.'];
    if (Object.keys(problems).length > 0) {
      setLocalErrors(problems);
      return;
    }

    setLocalErrors({});
    setSaving(true);
    setError(null);
    try {
      const payload = buildPayload(values, mode);
      const saved =
        mode === 'create' || studentId === undefined
          ? await studentsApi.create(payload)
          : await studentsApi.update(studentId, payload);
      onSaved(saved);
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  };

  const generalMessages = generalErrorMessages(error);
  const showExtended = mode === 'create';

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

      <div className="form-grid form-grid--two">
        <TextField
          label="First name"
          value={values.first_name}
          onChange={(value) => set('first_name', value)}
          error={messagesFor('first_name')}
          required
          autoFocus
        />
        <TextField
          label="Last name"
          value={values.last_name}
          onChange={(value) => set('last_name', value)}
          error={messagesFor('last_name')}
          required
        />
        <TextField
          label="Phone"
          type="tel"
          value={values.phone}
          onChange={(value) => set('phone', value)}
          error={messagesFor('phone')}
        />
        <TextField
          label="Email"
          type="email"
          value={values.email}
          onChange={(value) => set('email', value)}
          error={messagesFor('email')}
        />

        {showExtended ? (
          <>
            <DateField
              label="Date of birth"
              value={values.date_of_birth}
              onChange={(value) => set('date_of_birth', value)}
              error={messagesFor('date_of_birth')}
            />
            <Select
              label="Gender"
              options={GENDER_OPTIONS}
              value={values.gender}
              onChange={(value) => set('gender', value)}
              error={messagesFor('gender')}
            />
          </>
        ) : null}

        <DateField
          label="Registered on"
          value={values.registered_at}
          onChange={(value) => set('registered_at', value)}
          error={messagesFor('registered_at')}
        />

        {showExtended ? (
          <>
            <Select<StudentStatus>
              label="Status"
              options={STUDENT_STATUS_OPTIONS}
              value={values.status}
              onChange={(value) => {
                if (value !== '') set('status', value);
              }}
              error={messagesFor('status')}
              hint="New records start as active unless you pick otherwise."
            />
            <TextField
              label="Fee override"
              type="number"
              min="0"
              step="0.01"
              value={values.monthly_fee_override}
              onChange={(value) => set('monthly_fee_override', value)}
              error={messagesFor('monthly_fee_override')}
              hint="Leave blank to use the group's fee."
            />
          </>
        ) : null}

        {showExtended ? (
          <TextField
            label="Address"
            className="form-grid--full"
            value={values.address}
            onChange={(value) => set('address', value)}
            error={messagesFor('address')}
          />
        ) : null}
      </div>

      <div className="u-stack">
        <h3>Guardian</h3>
        <div className="form-grid form-grid--two">
          <TextField
            label="Guardian name"
            value={values.guardian_name}
            onChange={(value) => set('guardian_name', value)}
            error={messagesFor('guardian_name')}
          />
          <TextField
            label="Guardian phone"
            type="tel"
            value={values.guardian_phone}
            onChange={(value) => set('guardian_phone', value)}
            error={messagesFor('guardian_phone')}
          />
          {showExtended ? (
            <Select
              label="Relation"
              options={GUARDIAN_RELATIONS}
              value={values.guardian_relation}
              onChange={(value) => set('guardian_relation', value)}
              error={messagesFor('guardian_relation')}
            />
          ) : null}
        </div>
      </div>

      {showExtended ? (
        <div className="field">
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
      ) : (
        <p className="u-subtle">
          Background details (date of birth, gender, address, notes and the fee override) are
          captured when a student is created.
        </p>
      )}

      {/* The visible actions live in the modal footer; this keeps Enter working. */}
      <button type="submit" className="visually-hidden" disabled={saving} tabIndex={-1}>
        Save
      </button>
    </form>
  );
}

export interface StudentFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  student?: StudentListItem | null;
  onClose: () => void;
  onSaved: (student: StudentListItem) => void;
}

/** Modal wrapper: the header, footer submit button and form live together. */
export function StudentFormModal({
  open,
  mode,
  student,
  onClose,
  onSaved,
}: StudentFormModalProps) {
  const formId = `student-form-${mode}-${student?.id ?? 'new'}`;
  const initial = student ? studentFormValuesFrom(student) : EMPTY_STUDENT_FORM;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={mode === 'create' ? 'New student' : `Edit ${student?.full_name ?? 'student'}`}
      subtitle={
        mode === 'create'
          ? 'A unique student code is generated automatically.'
          : student?.code
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary">
            {mode === 'create' ? 'Create student' : 'Save changes'}
          </Button>
        </>
      }
    >
      <StudentForm
        mode={mode}
        initial={initial}
        studentId={student?.id}
        onSaved={onSaved}
        formId={formId}
      />
    </Modal>
  );
}

export default StudentFormModal;
