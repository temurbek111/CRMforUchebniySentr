/**
 * Lead record - the whole admissions pipeline for one prospect.
 *
 * Everything here is driven by the endpoints the backend actually exposes:
 *
 *   GET  /api/leads/{id}/            the record
 *   GET  /api/leads/{id}/timeline/   activities + audit entries, newest first
 *   POST /api/leads/{id}/activities/      log a note / call / message
 *   POST /api/leads/{id}/status/          audited status move (note -> lost_reason)
 *   POST /api/leads/{id}/schedule-trial/  book a trial, status becomes trial_scheduled
 *   POST /api/leads/{id}/trial-completed/ attended | no-show (a no-show closes as lost)
 *   POST /api/leads/{id}/convert/         idempotent: creates one student, or reuses
 *                                         an existing person matched by phone
 *
 * Status is never PATCHed (LeadWriteSerializer does not accept it) and a lead is
 * never deleted: it is closed with a status and a reason.
 */

import { useCallback, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import {
  Button,
  Card,
  ConfirmDialog,
  DateField,
  EmptyState,
  Icon,
  Modal,
  Select,
  TextField,
} from '../../components';
import { useAuth } from '../../auth/AuthContext';
import { useSettings } from '../../settings/SettingsContext';
import { ApiError, PERMISSIONS } from '../../types';
import { fieldErrors, generalErrorMessages, useAsyncResource } from '../students/hooks';
import {
  AsyncSection,
  DataField,
  InlineNote,
  RecordHeader,
  RecordLink,
  RefreshButton,
} from '../students/ui';
import {
  LEAD_STATUS_OPTIONS,
  LOGGABLE_ACTIVITY_KINDS,
  crmApi,
  isClosedLeadStatus,
  leadStatusLabel,
  type Lead,
  type LeadActivityKind,
  type LeadStatus,
  type LeadTimelineEvent,
} from './api';
import { LeadStatusBadge } from './widgets';

// --------------------------------------------------------------------------- //
// Shared dialog helpers
// --------------------------------------------------------------------------- //

/** Everything the API said, minus the field messages rendered next to their own input. */
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

function messagesFor(
  error: unknown,
  localErrors: Record<string, string[]>,
  field: string,
): string[] | undefined {
  const remote = fieldErrors(error)[field];
  if (remote !== undefined && remote.length > 0) return remote;
  const local = localErrors[field];
  return local !== undefined && local.length > 0 ? local : undefined;
}

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

/** `.timeline__meta` label for a namespaced timeline kind. */
function labelForKind(kind: string): string {
  if (kind.startsWith('activity:')) return `activity · ${kind.slice('activity:'.length).replace(/_/g, ' ')}`;
  if (kind.startsWith('audit:')) return `audit · ${kind.slice('audit:'.length).replace(/_/g, ' ')}`;
  return kind.replace(/_/g, ' ');
}

type DotTone = 'success' | 'warning' | 'danger' | 'info' | 'default';

/** Dot colour per event kind - state only, never decoration. */
function toneForKind(kind: string): DotTone {
  switch (kind) {
    case 'activity:trial_completed':
      return 'success';
    case 'activity:trial_scheduled':
      return 'info';
    case 'activity:status_change':
      return 'warning';
    case 'audit:create':
      return 'success';
    case 'audit:update':
      return 'info';
    case 'audit:delete':
      return 'danger';
    default:
      return 'default';
  }
}

// --------------------------------------------------------------------------- //
// Log activity
// --------------------------------------------------------------------------- //

interface LogActivityModalProps {
  lead: Lead;
  onClose: () => void;
  onSaved: () => void;
}

const LOG_ACTIVITY_FORM_ID = 'lead-activity-form';

function LogActivityModal({ lead, onClose, onSaved }: LogActivityModalProps) {
  const [kind, setKind] = useState<LeadActivityKind>('note');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [localErrors, setLocalErrors] = useState<Record<string, string[]>>({});

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (note.trim() === '') {
      setLocalErrors({ note: ['Write what happened - an empty entry is not useful.'] });
      return;
    }
    setLocalErrors({});
    setSaving(true);
    setError(null);
    try {
      // POST /leads/{id}/activities/ {kind, note}
      await crmApi.logActivity(lead.id, { kind, note: note.trim() });
      onSaved();
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
      title="Log activity"
      subtitle={`${lead.full_name} · ${lead.phone}`}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={LOG_ACTIVITY_FORM_ID} variant="primary" loading={saving}>
            Add entry
          </Button>
        </>
      }
    >
      <form
        id={LOG_ACTIVITY_FORM_ID}
        className="u-stack"
        onSubmit={(event) => void submit(event)}
        noValidate
      >
        <ErrorAlert messages={alertMessages(error, ['kind', 'note'])} />

        <Select<LeadActivityKind>
          label="Kind"
          options={LOGGABLE_ACTIVITY_KINDS}
          value={kind}
          onChange={(value) => {
            if (value !== '') setKind(value);
          }}
          error={messagesFor(error, localErrors, 'kind')}
          required
          hint="Trials and status moves are recorded by their own actions below."
        />

        <div className="field">
          <label className="field__label" htmlFor="lead-activity-note">
            What happened?
          </label>
          <textarea
            id="lead-activity-note"
            className="textarea"
            rows={3}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              if (localErrors.note !== undefined) setLocalErrors({});
            }}
            aria-invalid={messagesFor(error, localErrors, 'note') !== undefined || undefined}
            autoFocus
          />
          {messagesFor(error, localErrors, 'note') !== undefined ? (
            <p className="field__error">{messagesFor(error, localErrors, 'note')?.join(' ')}</p>
          ) : null}
        </div>

        <button type="submit" className="visually-hidden" disabled={saving} tabIndex={-1}>
          Save
        </button>
      </form>
    </Modal>
  );
}

// --------------------------------------------------------------------------- //
// Change status
// --------------------------------------------------------------------------- //

interface StatusChangeModalProps {
  lead: Lead;
  onClose: () => void;
  onSaved: (lead: Lead) => void;
}

const STATUS_FORM_ID = 'lead-status-form';

function StatusChangeModal({ lead, onClose, onSaved }: StatusChangeModalProps) {
  const current: LeadStatus | '' = LEAD_STATUS_OPTIONS.some((option) => option.value === lead.status)
    ? (lead.status as LeadStatus)
    : '';

  const [status, setStatus] = useState<LeadStatus | ''>(current);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [localErrors, setLocalErrors] = useState<Record<string, string[]>>({});

  const losesLead = status === 'lost';

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    const problems: Record<string, string[]> = {};
    if (status === '') problems.status = ['Choose the status this lead moves to.'];
    // A lead is never deleted; closing it as lost stores the reason, so the
    // reason is mandatory here.
    if (losesLead && note.trim() === '') {
      problems.note = ['Say why this lead was lost - it is stored as the lost reason.'];
    }
    if (Object.keys(problems).length > 0) {
      setLocalErrors(problems);
      return;
    }
    if (status === '') return;

    setLocalErrors({});
    setSaving(true);
    setError(null);
    try {
      const saved = await crmApi.changeStatus(lead.id, { status, note: note.trim() });
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
      subtitle={`${lead.full_name} · ${leadStatusLabel(lead.status, lead.status_label)}`}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={STATUS_FORM_ID} variant="primary" loading={saving}>
            Save status
          </Button>
        </>
      }
    >
      <form id={STATUS_FORM_ID} className="u-stack" onSubmit={(event) => void submit(event)} noValidate>
        <ErrorAlert messages={alertMessages(error, ['status', 'note'])} />

        <p className="u-subtle">
          Status never changes through a plain edit: this endpoint dates the move, records who made
          it and mirrors it in the timeline.
        </p>

        <Select<LeadStatus>
          label="New status"
          options={LEAD_STATUS_OPTIONS}
          value={status}
          onChange={(value) => {
            if (value !== '') setStatus(value);
          }}
          placeholder="Choose a status"
          error={messagesFor(error, localErrors, 'status')}
          required
        />

        <TextField
          label={losesLead ? 'Reason (required)' : 'Note'}
          value={note}
          onChange={(value) => {
            setNote(value);
            if (localErrors.note !== undefined) setLocalErrors({});
          }}
          error={messagesFor(error, localErrors, 'note')}
          hint={
            losesLead
              ? 'Stored as the lead’s lost reason.'
              : 'Optional; shown on the timeline.'
          }
          required={losesLead}
          autoFocus
        />

        <button type="submit" className="visually-hidden" disabled={saving} tabIndex={-1}>
          Save
        </button>
      </form>
    </Modal>
  );
}

// --------------------------------------------------------------------------- //
// Schedule trial
// --------------------------------------------------------------------------- //

interface ScheduleTrialModalProps {
  lead: Lead;
  onClose: () => void;
  onSaved: (lead: Lead) => void;
}

const TRIAL_FORM_ID = 'lead-trial-form';

function ScheduleTrialModal({ lead, onClose, onSaved }: ScheduleTrialModalProps) {
  const [trialDate, setTrialDate] = useState(lead.trial_date ?? '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [localErrors, setLocalErrors] = useState<Record<string, string[]>>({});

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (trialDate === '') {
      setLocalErrors({ trial_date: ['Pick the date of the trial lesson.'] });
      return;
    }
    setLocalErrors({});
    setSaving(true);
    setError(null);
    try {
      const saved = await crmApi.scheduleTrial(lead.id, {
        trial_date: trialDate,
        note: note.trim() === '' ? undefined : note.trim(),
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
      title="Schedule trial"
      subtitle={`${lead.full_name} · ${lead.interested_course_name || 'no course chosen yet'}`}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={TRIAL_FORM_ID} variant="primary" loading={saving}>
            Book trial
          </Button>
        </>
      }
    >
      <form id={TRIAL_FORM_ID} className="u-stack" onSubmit={(event) => void submit(event)} noValidate>
        <ErrorAlert messages={alertMessages(error, ['trial_date', 'note'])} />

        <p className="u-subtle">
          Booking a trial sets the lead&rsquo;s status to <strong>Trial scheduled</strong> and puts
          the date on the trials agenda.
        </p>

        <DateField
          label="Trial date"
          value={trialDate}
          onChange={(value) => {
            setTrialDate(value);
            if (localErrors.trial_date !== undefined) setLocalErrors({});
          }}
          error={messagesFor(error, localErrors, 'trial_date')}
          required
          autoFocus
        />

        <TextField
          label="Note"
          value={note}
          onChange={setNote}
          error={messagesFor(error, localErrors, 'note')}
          hint="Optional; appended to the timeline as its own entry."
        />

        <button type="submit" className="visually-hidden" disabled={saving} tabIndex={-1}>
          Save
        </button>
      </form>
    </Modal>
  );
}

// --------------------------------------------------------------------------- //
// Trial outcome
// --------------------------------------------------------------------------- //

interface TrialOutcomeModalProps {
  lead: Lead;
  attended: boolean;
  onClose: () => void;
  onSaved: (lead: Lead) => void;
}

const OUTCOME_FORM_ID = 'lead-trial-outcome-form';

function TrialOutcomeModal({ lead, attended, onClose, onSaved }: TrialOutcomeModalProps) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [localErrors, setLocalErrors] = useState<Record<string, string[]>>({});

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    // A no-show closes the lead as lost, so the reason is required; the note is
    // optional when the trial was attended.
    if (!attended && note.trim() === '') {
      setLocalErrors({ note: ['Say why the trial was missed - it becomes the lost reason.'] });
      return;
    }
    setLocalErrors({});
    setSaving(true);
    setError(null);
    try {
      const saved = await crmApi.trialCompleted(lead.id, {
        attended,
        note: note.trim(),
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
      title={attended ? 'Mark trial attended' : 'Mark trial not attended'}
      subtitle={`${lead.full_name} · trial ${lead.trial_date ?? 'date not set'}`}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={OUTCOME_FORM_ID}
            variant={attended ? 'primary' : 'danger'}
            loading={saving}
          >
            {attended ? 'Trial attended' : 'Trial not attended'}
          </Button>
        </>
      }
    >
      <form id={OUTCOME_FORM_ID} className="u-stack" onSubmit={(event) => void submit(event)} noValidate>
        <ErrorAlert messages={alertMessages(error, ['note', 'attended'])} />

        <p className="u-subtle">
          {attended
            ? 'The lead moves to Trial completed and joins the admissions queue.'
            : 'A no-show closes the lead as lost — nothing is deleted, the reason below is stored.'}
        </p>

        <TextField
          label={attended ? 'Note' : 'Reason (required)'}
          value={note}
          onChange={(value) => {
            setNote(value);
            if (localErrors.note !== undefined) setLocalErrors({});
          }}
          error={messagesFor(error, localErrors, 'note')}
          required={!attended}
          hint={attended ? 'Defaults to "Trial attended" when left blank.' : undefined}
          autoFocus
        />

        <button type="submit" className="visually-hidden" disabled={saving} tabIndex={-1}>
          Save
        </button>
      </form>
    </Modal>
  );
}

// --------------------------------------------------------------------------- //
// Page
// --------------------------------------------------------------------------- //

type OpenDialog = 'activity' | 'status' | 'trial' | 'outcome-attended' | 'outcome-missed' | 'convert' | null;

export function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const settings = useSettings();
  const { hasPerm } = useAuth();

  const leadId = Number(id);
  const validId = Number.isInteger(leadId) && leadId > 0;

  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [flash, setFlash] = useState<ReactNode>(null);

  const leadResource = useAsyncResource(
    () => (validId ? crmApi.get(leadId) : Promise.reject(new ApiError(404, 'That lead id is not valid.'))),
    `lead:${leadId}`,
  );
  const timelineResource = useAsyncResource(
    () =>
      validId
        ? crmApi.timeline(leadId)
        : Promise.reject(new ApiError(404, 'That lead id is not valid.')),
    `lead-timeline:${leadId}`,
  );

  const lead = leadResource.data;
  const events: LeadTimelineEvent[] = useMemo(
    () => timelineResource.data?.events ?? [],
    [timelineResource.data],
  );

  const canManage = hasPerm(PERMISSIONS.LEADS_MANAGE);
  const canConvert = hasPerm(PERMISSIONS.ADMISSIONS_MANAGE);

  /** Applies a write result without a refetch, then refreshes the timeline. */
  const applyLead = useCallback(
    (next: Lead): void => {
      leadResource.setData(next);
      timelineResource.reload();
    },
    [leadResource, timelineResource],
  );

  const closeDialog = useCallback((): void => setDialog(null), []);

  if (!validId) {
    return (
      <div className="module-page">
        <EmptyState
          title="That lead does not exist"
          message="The address does not contain a lead id."
          icon="crm"
        />
      </div>
    );
  }

  if (leadResource.error !== null || (leadResource.loading && lead === null)) {
    return (
      <div className="module-page">
        <AsyncSection
          loading={leadResource.loading}
          error={leadResource.error}
          onRetry={leadResource.reload}
          loadingRows={6}
        >
          <span />
        </AsyncSection>
      </div>
    );
  }

  if (lead === null) {
    return (
      <div className="module-page">
        <EmptyState title="Lead not found" message="It may have been removed." icon="crm" />
      </div>
    );
  }

  const closed = isClosedLeadStatus(lead.status);
  const converted = lead.is_converted || lead.converted_student !== null;

  const actions: ReactNode = (
    <>
      {canManage ? (
        <>
          <Button icon="plus" size="sm" onClick={() => setDialog('activity')}>
            Log activity
          </Button>
          <Button icon="filter" size="sm" onClick={() => setDialog('status')}>
            Change status
          </Button>
          {!closed ? (
            <Button icon="calendar" size="sm" onClick={() => setDialog('trial')}>
              {lead.has_trial ? 'Reschedule trial' : 'Schedule trial'}
            </Button>
          ) : null}
          {!closed && lead.has_trial ? (
            <>
              <Button icon="check" size="sm" onClick={() => setDialog('outcome-attended')}>
                Trial attended
              </Button>
              <Button icon="close" size="sm" onClick={() => setDialog('outcome-missed')}>
                Trial not attended
              </Button>
            </>
          ) : null}
        </>
      ) : null}
      {canConvert && !converted ? (
        <Button variant="primary" icon="students" size="sm" onClick={() => setDialog('convert')}>
          Convert to student
        </Button>
      ) : null}
      <RefreshButton onClick={leadResource.reload} />
    </>
  );

  return (
    <div className="module-page">
      <RecordHeader
        title={lead.full_name}
        code={
          <span>
            Lead #{lead.id} · <span className="u-mono">{lead.phone}</span>
          </span>
        }
        badges={
          <>
            <LeadStatusBadge status={lead.status} label={leadStatusLabel(lead.status, lead.status_label)} />
            {converted ? (
              <span className="badge">
                <Icon name="checkCircle" size={12} /> Converted
              </span>
            ) : null}
          </>
        }
        actions={actions}
      >
        <div className="meta-grid">
          <DataField label="Phone">{lead.phone || '—'}</DataField>
          <DataField label="Email">{lead.email || '—'}</DataField>
          <DataField label="Source">{lead.source || '—'}</DataField>
          <DataField label="Interested course">
            {lead.interested_course_name || '—'}
          </DataField>
          <DataField label="Owner">{lead.assigned_to_name || 'Unassigned'}</DataField>
          <DataField label="Trial date">{settings.date(lead.trial_date)}</DataField>
          <DataField label="Created">
            {settings.dateTime(lead.created_at)}
            {lead.created_by_name !== '' ? ` · ${lead.created_by_name}` : ''}
          </DataField>
          <DataField label="Status changed">
            {settings.dateTime(lead.status_changed_at)}
          </DataField>
          <DataField label="Activities">{settings.number(lead.activities_count)}</DataField>
          {lead.lost_reason !== '' ? (
            <DataField label="Lost reason">{lead.lost_reason}</DataField>
          ) : null}
        </div>
      </RecordHeader>

      {flash !== null ? (
        <InlineNote tone="info">{flash}</InlineNote>
      ) : null}

      {converted ? (
        <InlineNote tone="info">
          This lead is already registered.{' '}
          <RecordLink to={`/students/${lead.converted_student ?? ''}`}>
            {lead.converted_student_name || 'Open the student record'}
          </RecordLink>
          {lead.converted_student_code !== '' ? ` (${lead.converted_student_code})` : ''} — converting
          again would return the same student, so the action is not offered.
        </InlineNote>
      ) : null}

      {lead.notes !== '' ? (
        <Card title="Notes" subtitle="Captured when the lead was created.">
          <p style={{ whiteSpace: 'pre-wrap' }}>{lead.notes}</p>
        </Card>
      ) : null}

      <Card
        title="Timeline"
        subtitle="Follow-up entries, trials and status moves, newest first."
        actions={<RefreshButton onClick={timelineResource.reload} />}
      >
        <AsyncSection
          loading={timelineResource.loading}
          error={timelineResource.error}
          onRetry={timelineResource.reload}
          isEmpty={events.length === 0}
          emptyIcon="clipboard"
          emptyTitle="Nothing recorded yet"
          emptyMessage="Log a call, book a trial or move the status and it will appear here."
          loadingRows={4}
        >
          <ol className="timeline">
            {events.map((event, index) => {
              const tone = toneForKind(event.kind);
              return (
                <li className="timeline__item" key={`${event.kind}-${event.at ?? 'unknown'}-${index}`}>
                  <span
                    className={['timeline__dot', tone === 'default' ? '' : `timeline__dot--${tone}`]
                      .filter(Boolean)
                      .join(' ')}
                    aria-hidden="true"
                  />
                  <div className="timeline__body">
                    <span className="timeline__title">{event.title}</span>
                    {event.detail !== '' ? (
                      <span className="timeline__detail">{event.detail}</span>
                    ) : null}
                    <span className="timeline__meta">
                      {labelForKind(event.kind)} · {event.actor} · {settings.dateTime(event.at)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        </AsyncSection>
      </Card>

      {dialog === 'activity' ? (
        <LogActivityModal
          lead={lead}
          onClose={closeDialog}
          onSaved={() => {
            closeDialog();
            setFlash('Activity recorded.');
            timelineResource.reload();
          }}
        />
      ) : null}

      {dialog === 'status' ? (
        <StatusChangeModal
          lead={lead}
          onClose={closeDialog}
          onSaved={(saved) => {
            closeDialog();
            setFlash(
              `Status is now ${leadStatusLabel(saved.status, saved.status_label)}.`,
            );
            applyLead(saved);
          }}
        />
      ) : null}

      {dialog === 'trial' ? (
        <ScheduleTrialModal
          lead={lead}
          onClose={closeDialog}
          onSaved={(saved) => {
            closeDialog();
            setFlash(`Trial booked for ${settings.date(saved.trial_date)}.`);
            applyLead(saved);
          }}
        />
      ) : null}

      {dialog === 'outcome-attended' ? (
        <TrialOutcomeModal
          lead={lead}
          attended
          onClose={closeDialog}
          onSaved={(saved) => {
            closeDialog();
            setFlash('Trial marked as attended — the lead is in the admissions queue.');
            applyLead(saved);
          }}
        />
      ) : null}

      {dialog === 'outcome-missed' ? (
        <TrialOutcomeModal
          lead={lead}
          attended={false}
          onClose={closeDialog}
          onSaved={(saved) => {
            closeDialog();
            setFlash('Trial marked as not attended; the lead has been closed as lost.');
            applyLead(saved);
          }}
        />
      ) : null}

      {dialog === 'convert' ? (
        <ConfirmDialog
          open
          tone="primary"
          title="Convert to student"
          confirmLabel="Convert"
          message={
            <div className="u-stack">
              <p>
                <strong>{lead.full_name}</strong> becomes a student record. If a student with the
                phone number <span className="u-mono">{lead.phone}</span> already exists, that record
                is reused instead of creating a second person.
              </p>
              <p className="u-subtle">
                Converting is idempotent: the lead is registered once, and no group enrolment is made
                here — assign one from the student or group screens afterwards.
              </p>
            </div>
          }
          onCancel={closeDialog}
          onConfirm={async () => {
            const result = await crmApi.convert(lead.id);
            applyLead(result.lead);
            setFlash(
              result.already_converted
                ? `This lead was already converted — ${result.student.full_name} (${result.student.code}) is the same student.`
                : result.reused_existing_student
                  ? `Registered as ${result.student.full_name} (${result.student.code}); an existing student with this phone number was reused, so no duplicate was created.`
                  : `Registered as ${result.student.full_name} (${result.student.code}).`,
            );
            setDialog(null);
          }}
        />
      ) : null}
    </div>
  );
}

export default LeadDetailPage;
