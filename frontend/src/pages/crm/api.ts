/**
 * Typed API surface for the CRM (leads, trials, admissions) module.
 *
 * Mirrors the backend exactly - nothing here is guessed:
 *
 *   backend/apps/crm/models.py        (LeadStatus, LeadActivityKind, the Lead row)
 *   backend/apps/crm/serializers.py   (LeadSerializer, LeadActivitySerializer,
 *                                      LeadStatusChangeSerializer, ScheduleTrialSerializer,
 *                                      TrialCompletedSerializer, ConvertLeadSerializer)
 *   backend/apps/crm/views.py         (the custom @action endpoints on /api/leads/)
 *   backend/apps/crm/filters.py       (the list query parameters)
 *
 * Two deliberate departures from the older module docs, both read off the live
 * API rather than assumed:
 *
 *   - `POST /leads/{id}/status/` takes `note`, not `reason`; the server copies
 *     that note into `lost_reason` when the new status is `lost`.
 *   - Decimal values are NOT strings here (`COERCE_DECIMAL_TO_STRING = False`):
 *     `pipeline.conversion_rate` arrives as a JSON number. The one exception is
 *     the `student.monthly_fee` inside the convert response, which the view
 *     stringifies by hand. Both are normalised with `toNumber` before they
 *     reach a formatter.
 *
 * The lead `source` vocabulary is an administrator setting
 * (`SystemSettings.lead_sources`, served by GET /api/settings), so the source
 * pickers read it from the settings context instead of hard-coding a list.
 */

import { api } from '../../api/client';
import { list } from '../../api/endpoints';
import type { Paginated, QueryParams } from '../../types';
import type { Group } from '../students/api';

// --------------------------------------------------------------------------- //
// Vocabularies (apps/crm/models.py)
// --------------------------------------------------------------------------- //

export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'trial_scheduled'
  | 'trial_completed'
  | 'interested'
  | 'registered'
  | 'lost';

/** Labels are exactly `LeadStatus`'s own, so the UI matches `status_label`. */
export const LEAD_STATUS_OPTIONS: ReadonlyArray<{ value: LeadStatus; label: string }> = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'trial_scheduled', label: 'Trial scheduled' },
  { value: 'trial_completed', label: 'Trial completed' },
  { value: 'interested', label: 'Interested' },
  { value: 'registered', label: 'Registered' },
  { value: 'lost', label: 'Lost' },
];

/** Statuses that close a lead (`models.CLOSED_STATUSES`). */
export const CLOSED_LEAD_STATUSES: ReadonlyArray<LeadStatus> = ['registered', 'lost'];

/** Statuses that belong in the admissions queue. */
export const ADMISSIONS_QUEUE_STATUSES: ReadonlyArray<LeadStatus> = ['trial_completed', 'interested'];

export type LeadActivityKind =
  | 'note'
  | 'call'
  | 'message'
  | 'trial_scheduled'
  | 'trial_completed'
  | 'status_change';

/**
 * Kinds a human logs by hand. Trials and status moves have their own dedicated
 * endpoints (they carry payloads), so they are not offered in "Log activity".
 */
export const LOGGABLE_ACTIVITY_KINDS: ReadonlyArray<{ value: LeadActivityKind; label: string }> = [
  { value: 'note', label: 'Note' },
  { value: 'call', label: 'Call' },
  { value: 'message', label: 'Message' },
];

/** Every kind the API accepts on POST /leads/{id}/activities/ (LeadActivityKind). */
export const ACTIVITY_KIND_OPTIONS: ReadonlyArray<{ value: LeadActivityKind; label: string }> = [
  { value: 'note', label: 'Note' },
  { value: 'call', label: 'Call' },
  { value: 'message', label: 'Message' },
  { value: 'trial_scheduled', label: 'Trial scheduled' },
  { value: 'trial_completed', label: 'Trial completed' },
  { value: 'status_change', label: 'Status change' },
];

const LEAD_STATUS_VALUES: ReadonlyArray<string> = LEAD_STATUS_OPTIONS.map((option) => option.value);

export function isLeadStatus(value: string | null | undefined): value is LeadStatus {
  return typeof value === 'string' && LEAD_STATUS_VALUES.includes(value);
}

/** The server's `status_label` when present, else the local label for the code. */
export function leadStatusLabel(status: string, statusLabel?: string): string {
  if (statusLabel !== undefined && statusLabel.trim() !== '') return statusLabel;
  const match = LEAD_STATUS_OPTIONS.find((option) => option.value === status);
  return match === undefined ? status.replace(/_/g, ' ') : match.label;
}

export function isClosedLeadStatus(status: string): boolean {
  return CLOSED_LEAD_STATUSES.includes(status as LeadStatus);
}

// --------------------------------------------------------------------------- //
// Lead rows
// --------------------------------------------------------------------------- //

/** GET /api/leads/ rows (LeadSerializer). */
export interface Lead {
  id: number;
  full_name: string;
  phone: string;
  email: string;
  /** Free text from SystemSettings.lead_sources, never a fixed enum. */
  source: string;
  interested_course: number | null;
  interested_course_name: string;
  assigned_to: number | null;
  assigned_to_name: string;
  status: LeadStatus | string;
  status_label: string;
  trial_date: string | null;
  lost_reason: string;
  notes: string;
  converted_student: number | null;
  converted_student_code: string;
  converted_student_name: string;
  is_converted: boolean;
  has_trial: boolean;
  created_by: number | null;
  created_by_name: string;
  activities_count: number;
  created_at: string;
  updated_at: string;
  status_changed_at: string | null;
}

/** Body accepted by POST /api/leads/ and PATCH /api/leads/{id}/ (LeadWriteSerializer). */
export interface LeadWritePayload {
  full_name?: string;
  phone?: string;
  email?: string;
  source?: string;
  interested_course?: number | null;
  assigned_to?: number | null;
  notes?: string;
}

/** GET /api/leads/{id}/activities/ row (LeadActivitySerializer). */
export interface LeadActivity {
  id: number;
  lead: number;
  kind: LeadActivityKind | string;
  kind_label: string;
  note: string;
  actor: number | null;
  actor_name: string;
  created_at: string;
}

/**
 * One entry of GET /api/leads/{id}/timeline/.
 *
 * `kind` is namespaced: `activity:<LeadActivityKind>` for the follow-up trail,
 * `audit:<AuditLog.Action>` for the audit entries the same write produces.
 */
export interface LeadTimelineEvent {
  kind: string;
  title: string;
  detail: string;
  actor: string;
  at: string | null;
}

export interface LeadTimeline {
  lead: number;
  events: LeadTimelineEvent[];
}

/** GET /api/leads/pipeline/ (crm/services.pipeline_metrics). */
export interface PipelineSourceRow {
  source: string;
  leads: number;
  registered: number;
  /** A JSON number: the project serves decimals with COERCE_DECIMAL_TO_STRING off. */
  conversion_rate: number;
}

export interface PipelineAssigneeRow {
  assigned_to: number | null;
  assigned_to_name: string;
  leads: number;
  registered: number;
  conversion_rate: number;
}

export interface LeadPipeline {
  new_leads: number;
  contacted: number;
  trials_scheduled: number;
  trials_completed: number;
  interested: number;
  registered: number;
  lost: number;
  conversion_rate: number;
  by_source: PipelineSourceRow[];
  by_assignee: PipelineAssigneeRow[];
}

/** Body accepted by the custom action endpoints. */
export interface StatusChangePayload {
  status: LeadStatus;
  /** The serializer field is `note`; it becomes `lost_reason` when status is lost. */
  note?: string;
}

export interface ScheduleTrialPayload {
  trial_date: string;
  note?: string;
}

export interface TrialCompletedPayload {
  attended: boolean;
  note?: string;
}

/** Body of POST /api/leads/{id}/convert/ (ConvertLeadSerializer). */
export interface ConvertLeadPayload {
  group?: number | null;
  course?: number | null;
  /** Decimal string, e.g. "450000.00" - DRF takes it as-is. */
  monthly_fee?: string | null;
  start_date?: string | null;
  payment_terms?: string;
}

/** The compact student summary the convert action answers with. */
export interface ConvertedStudentSummary {
  id: number;
  code: string;
  full_name: string;
  status: string;
  phone: string;
  monthly_fee: string;
}

export interface ConvertLeadResult {
  lead: Lead;
  student: ConvertedStudentSummary;
  /** True when the lead had already been converted (the call is idempotent). */
  already_converted: boolean;
  /** True when an existing student was matched by phone instead of created. */
  reused_existing_student: boolean;
}

export interface LeadListParams {
  search?: string;
  status?: string;
  source?: string;
  interested_course?: number | '';
  assigned_to?: number | '';
  has_trial?: boolean;
  converted?: boolean;
  trial_from?: string;
  trial_to?: string;
  ordering?: string;
  page?: number;
  page_size?: number;
}

// --------------------------------------------------------------------------- //
// Endpoints
// --------------------------------------------------------------------------- //

const LEADS_PATH = '/api/leads/';

export const crmApi = {
  list: (params?: LeadListParams): Promise<Paginated<Lead>> =>
    list<Lead>(LEADS_PATH, params as QueryParams),

  get: (id: number): Promise<Lead> => api.get<Lead>(`${LEADS_PATH}${id}/`),

  create: (payload: LeadWritePayload): Promise<Lead> => api.post<Lead>(LEADS_PATH, payload),

  /** PATCH only accepts the write fields - status goes through `changeStatus`. */
  update: (id: number, payload: LeadWritePayload): Promise<Lead> =>
    api.patch<Lead>(`${LEADS_PATH}${id}/`, payload),

  activities: (id: number): Promise<LeadActivity[]> =>
    api.get<LeadActivity[]>(`${LEADS_PATH}${id}/activities/`),

  logActivity: (
    id: number,
    payload: { kind: LeadActivityKind; note: string },
  ): Promise<LeadActivity> =>
    api.post<LeadActivity>(`${LEADS_PATH}${id}/activities/`, payload),

  timeline: (id: number): Promise<LeadTimeline> =>
    api.get<LeadTimeline>(`${LEADS_PATH}${id}/timeline/`),

  /** Audited status move; a lost lead keeps the note as its `lost_reason`. */
  changeStatus: (id: number, payload: StatusChangePayload): Promise<Lead> =>
    api.post<Lead>(`${LEADS_PATH}${id}/status/`, payload),

  /** Books the trial and moves the lead to `trial_scheduled` server-side. */
  scheduleTrial: (id: number, payload: ScheduleTrialPayload): Promise<Lead> =>
    api.post<Lead>(`${LEADS_PATH}${id}/schedule-trial/`, payload),

  /** A no-show (`attended: false`) closes the lead as lost on the server. */
  trialCompleted: (id: number, payload: TrialCompletedPayload): Promise<Lead> =>
    api.post<Lead>(`${LEADS_PATH}${id}/trial-completed/`, payload),

  /** Idempotent: a repeat call returns the same student, never a duplicate. */
  convert: (id: number, payload: ConvertLeadPayload = {}): Promise<ConvertLeadResult> =>
    api.post<ConvertLeadResult>(`${LEADS_PATH}${id}/convert/`, payload),

  /** NOTE the trailing slash: this is a viewset @action, not a hand-written path. */
  pipeline: (params?: { from?: string; to?: string }): Promise<LeadPipeline> =>
    api.get<LeadPipeline>('/api/leads/pipeline/', { params: params as QueryParams }),
};

// --------------------------------------------------------------------------- //
// Vocabularies that live in the backend, not in this file
// --------------------------------------------------------------------------- //

/**
 * The lead-source list is an administrator setting
 * (`SystemSettings.lead_sources`), so it is read from GET /api/settings at
 * runtime. Sources already seen on real leads are merged in, which keeps the
 * filter useful if a source was removed from the settings after leads were
 * captured with it.
 */
export function mergeLeadSources(
  configured: ReadonlyArray<string>,
  observed: ReadonlyArray<string> = [],
): string[] {
  const out: string[] = [];
  for (const raw of [...configured, ...observed]) {
    const value = raw.trim();
    if (value !== '' && !out.includes(value)) out.push(value);
  }
  return out.sort((left, right) => left.localeCompare(right));
}

/** Sources present on a set of leads (used when settings carry none). */
export function observedSources(leads: ReadonlyArray<Lead>): string[] {
  const out: string[] = [];
  for (const lead of leads) {
    const value = (lead.source ?? '').trim();
    if (value !== '' && !out.includes(value)) out.push(value);
  }
  return out;
}

/**
 * Group options for the convert dialog, labelled with the live seat count so
 * a full group is obvious before the server refuses it.
 */
export function groupOptions(groups: ReadonlyArray<Group>): Array<{
  value: number;
  label: string;
  disabled: boolean;
}> {
  return groups.map((group) => {
    const full = group.seats_available <= 0;
    return {
      value: group.id,
      label: full
        ? `${group.name} — full (${group.student_count}/${group.capacity})`
        : `${group.name} — ${group.seats_available} ${
            group.seats_available === 1 ? 'seat' : 'seats'
          } available`,
      // Convert has no capacity override (ConvertLeadSerializer has no such
      // field), so the picker refuses what the server would refuse.
      disabled: full || group.status !== 'active',
    };
  });
}

export default crmApi;
