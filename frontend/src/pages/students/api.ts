/**
 * Typed API surface for the Students and Groups module.
 *
 * Mirrors the backend exactly:
 *   backend/apps/academics/serializers.py  (Student/Group/Membership rows)
 *   backend/apps/academics/views.py        (the custom @action endpoints)
 *   backend/apps/attendance/services.py    (student/group attendance payloads)
 *   backend/apps/exams/services.py         (exam history + group performance)
 *   backend/apps/finance/services.py       (invoices, payments, billing summary)
 *
 * Money and percentages arrive from the API as *strings* (DRF decimal
 * coercion); they are normalised to numbers at the edge with `toNumber` so the
 * settings-aware formatters in src/utils/format.ts can be used directly.
 *
 * `groups` deliberately imports this file too: both modules live in the same
 * workstream and share one wire contract.
 */

import { api } from '../../api/client';
import { list } from '../../api/endpoints';
import type { Paginated, QueryParams } from '../../types';

// --------------------------------------------------------------------------- //
// Status vocabularies (apps/academics/models.py)
// --------------------------------------------------------------------------- //

export type StudentStatus =
  | 'lead'
  | 'trial'
  | 'active'
  | 'paused'
  | 'graduated'
  | 'dropped'
  | 'archived';

export const STUDENT_STATUS_OPTIONS: ReadonlyArray<{ value: StudentStatus; label: string }> = [
  { value: 'lead', label: 'Lead' },
  { value: 'trial', label: 'Trial' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'graduated', label: 'Graduated' },
  { value: 'dropped', label: 'Dropped' },
  { value: 'archived', label: 'Archived' },
];

export type GroupStatus = 'active' | 'paused' | 'graduated' | 'dropped' | 'archived';

export const GROUP_STATUS_OPTIONS: ReadonlyArray<{ value: GroupStatus; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'graduated', label: 'Graduated' },
  { value: 'dropped', label: 'Dropped' },
  { value: 'archived', label: 'Archived' },
];

export const GUARDIAN_RELATIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'mother', label: 'Mother' },
  { value: 'father', label: 'Father' },
  { value: 'guardian', label: 'Guardian' },
  { value: 'other', label: 'Other' },
];

export const GENDER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'unspecified', label: 'Not specified' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];

/** Money/percent strings from DRF -> number | null (never NaN on screen). */
export function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

// --------------------------------------------------------------------------- //
// Students
// --------------------------------------------------------------------------- //

/** GET /api/students/ rows (StudentListSerializer). */
export interface StudentListItem {
  id: number;
  code: string;
  first_name: string;
  last_name: string;
  full_name: string;
  photo: string | null;
  status: StudentStatus | string;
  phone: string;
  email: string;
  age: number | null;
  gender: string;
  registered_at: string | null;
  group_name: string;
  course_name: string;
  teacher_name: string;
  monthly_fee: string | null;
  parent_name: string;
  parent_phone: string;
}

/** Body accepted by POST/PATCH /api/students/ (StudentWriteSerializer). */
export interface StudentWritePayload {
  first_name?: string;
  last_name?: string;
  date_of_birth?: string | null;
  gender?: string;
  phone?: string;
  email?: string;
  address?: string;
  status?: StudentStatus;
  registered_at?: string | null;
  left_at?: string | null;
  leave_reason?: string;
  monthly_fee_override?: string | null;
  notes?: string;
  guardian_name?: string;
  guardian_phone?: string;
  guardian_relation?: string;
}

/** GET /api/students/{id}/overview/ */
export interface StudentOverviewGroup {
  id: number;
  name: string;
  course: string;
  teacher: string;
  room: string;
  schedule: string;
  joined_at: string | null;
}

export interface StudentOverview {
  student: StudentListItem;
  group: StudentOverviewGroup | null;
  monthly_fee: string | null;
  payment_status: string;
  outstanding_balance: string | null;
  attendance_pct: string | null;
  latest_exam_score: string | null;
  exam_average_pct: string | null;
  performance_trend: string;
}

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

export interface AttendanceSummary {
  total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  percentage: string | null;
}

export interface AttendanceMonthSummary {
  present: number;
  absent: number;
  late: number;
  excused: number;
  total: number;
  percentage?: string | null;
}

export interface AttendanceRow {
  id: number;
  date: string;
  group: string;
  status: AttendanceStatus | string;
  status_label: string;
  reason: string;
  note: string;
  modified_by: string | null;
}

/** GET /api/students/{id}/attendance/ */
export interface StudentAttendanceDetail {
  summary: AttendanceSummary;
  /** Keyed by `YYYY-MM`; newest month first (server-sorted). */
  monthly: Record<string, AttendanceMonthSummary>;
  records: AttendanceRow[];
  /** Keyed by `YYYY-MM-DD` -> attendance status. Powers the month grid. */
  calendar: Record<string, AttendanceStatus | string>;
}

export interface ExamResultRow {
  id: number;
  exam: number;
  exam_name: string;
  type: string;
  date: string;
  group: number;
  group_name: string;
  component: number | null;
  component_name: string;
  score: string | null;
  max_score: string | null;
  percentage: string | null;
  grade: string;
  teacher_comment: string;
}

export interface StudentExamSummary {
  exams_taken: number;
  average_percentage: string | null;
  latest_score: string | null;
  latest_percentage: string | null;
  highest_percentage: string | null;
  lowest_percentage: string | null;
  pass_count: number;
  fail_count: number;
  trend: string;
  recent: ExamResultRow[];
}

/** GET /api/students/{id}/exams/ */
export interface StudentExamHistory {
  summary: StudentExamSummary;
  results: ExamResultRow[];
}

export interface StudentBalance {
  student: number;
  student_name: string;
  total_due: string | null;
  total_paid: string | null;
  outstanding: string | null;
  credit: string | null;
  status: string;
  invoice_count: number;
  open_invoices: number;
  days_overdue: number;
  monthly_fee: string | null;
}

/** One row of `invoice_summary()` (finance/services.py). */
export interface InvoiceSummary {
  id: number;
  student: number;
  student_name: string;
  student_code: string;
  group: number | null;
  group_name: string;
  period: string;
  period_start: string;
  period_end: string;
  amount_due: string | null;
  amount_paid: string | null;
  remaining: string | null;
  credit: string | null;
  status: string;
  status_label: string;
  due_date: string;
  days_overdue: number;
  notes: string;
}

export interface PaymentRow {
  id: number;
  receipt: string;
  amount: string | null;
  paid_at: string | null;
  method: string;
  method_label: string;
  period: string;
  invoice: number | null;
  reference: string;
  received_by: string;
  is_void: boolean;
  void_reason: string;
  notes: string;
  created_at: string;
}

/** GET /api/students/{id}/payments/ */
export interface StudentFinancialHistory {
  balance: StudentBalance;
  invoices: InvoiceSummary[];
  payments: PaymentRow[];
}

/** GET/POST /api/students/{id}/notes/ */
export interface StudentNote {
  id: number;
  student: number;
  author: number | null;
  author_name: string;
  body: string;
  is_pinned: boolean;
  created_at: string;
}

/** One entry of the merged timeline from GET /api/students/{id}/activity/. */
export interface ActivityEvent {
  kind: string;
  title: string;
  detail: string;
  at: string | null;
  link: string;
}

export interface StudentListParams {
  search?: string;
  status?: string;
  group?: number | '';
  course?: number | '';
  teacher?: number | '';
  page?: number;
  page_size?: number;
  ordering?: string;
}

export interface TransferPayload {
  student: number;
  to_group: number;
  from_group?: number | null;
  effective_date?: string | null;
  reason?: string;
  allow_over_capacity?: boolean;
}

export interface ChangeStatusPayload {
  status: StudentStatus;
  reason?: string;
}

export const studentsApi = {
  list: (params?: StudentListParams): Promise<Paginated<StudentListItem>> =>
    list<StudentListItem>('/api/students/', params as QueryParams),

  get: (id: number): Promise<StudentListItem> => api.get<StudentListItem>(`/api/students/${id}/`),

  create: (payload: StudentWritePayload): Promise<StudentListItem> =>
    api.post<StudentListItem>('/api/students/', payload),

  update: (id: number, payload: StudentWritePayload): Promise<StudentListItem> =>
    api.patch<StudentListItem>(`/api/students/${id}/`, payload),

  overview: (id: number): Promise<StudentOverview> =>
    api.get<StudentOverview>(`/api/students/${id}/overview/`),

  attendance: (
    id: number,
    params?: { from?: string; to?: string },
  ): Promise<StudentAttendanceDetail> =>
    api.get<StudentAttendanceDetail>(`/api/students/${id}/attendance/`, {
      params: params as QueryParams,
    }),

  exams: (id: number): Promise<StudentExamHistory> =>
    api.get<StudentExamHistory>(`/api/students/${id}/exams/`),

  payments: (id: number): Promise<StudentFinancialHistory> =>
    api.get<StudentFinancialHistory>(`/api/students/${id}/payments/`),

  balance: (id: number): Promise<StudentBalance> =>
    api.get<StudentBalance>(`/api/students/${id}/balance/`),

  activity: (id: number): Promise<{ results: ActivityEvent[] }> =>
    api.get<{ results: ActivityEvent[] }>(`/api/students/${id}/activity/`),

  notes: (id: number): Promise<StudentNote[]> =>
    api.get<StudentNote[]>(`/api/students/${id}/notes/`),

  addNote: (id: number, payload: { body: string; is_pinned?: boolean }): Promise<StudentNote> =>
    api.post<StudentNote>(`/api/students/${id}/notes/`, payload),

  /** POST (not DELETE): notes are removed through an audited action endpoint. */
  deleteNote: (id: number, noteId: number): Promise<void> =>
    api.post<void>(`/api/students/${id}/notes/${noteId}/delete/`),

  changeStatus: (id: number, payload: ChangeStatusPayload): Promise<StudentListItem> =>
    api.post<StudentListItem>(`/api/students/${id}/change-status/`, payload),

  transfer: (id: number, payload: TransferPayload): Promise<GroupMembership> =>
    api.post<GroupMembership>(`/api/students/${id}/transfer/`, payload),
};

// --------------------------------------------------------------------------- //
// Groups
// --------------------------------------------------------------------------- //

/** GET /api/groups/ rows (GroupSerializer). */
export interface Group {
  id: number;
  name: string;
  course: number;
  course_name: string;
  teacher: number | null;
  teacher_name: string;
  room: number | null;
  room_name: string;
  capacity: number;
  level: string;
  monthly_fee: string | null;
  start_date: string | null;
  end_date: string | null;
  status: GroupStatus | string;
  notes: string;
  student_count: number;
  seats_available: number;
  schedule_summary: string;
  created_at: string;
}

export interface GroupWritePayload {
  name?: string;
  course?: number;
  teacher?: number | null;
  room?: number | null;
  capacity?: number;
  level?: string;
  monthly_fee?: string;
  start_date?: string | null;
  end_date?: string | null;
  status?: GroupStatus;
  notes?: string;
}

/** GroupMembershipSerializer row. */
export interface GroupMembership {
  id: number;
  student: number;
  student_name: string;
  student_code: string;
  student_photo: string | null;
  group: number;
  group_name: string;
  joined_at: string | null;
  left_at: string | null;
  status: string;
  monthly_fee: string | null;
  effective_fee: string | null;
  is_active: boolean;
  note: string;
  created_at: string;
}

/** GET /api/groups/{id}/capacity/ */
export interface GroupCapacity {
  capacity: number;
  enrolled: number;
  seats_available: number;
  is_full: boolean;
  over_capacity: boolean;
}

export interface GroupAttendanceDateRow {
  session: number;
  date: string;
  state: string;
  teacher: string | null;
  submitted_at: string | null;
  marked: number;
  unmarked: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  percentage: string | null;
}

export interface GroupAttendanceStudentRow {
  student: number;
  student_name: string;
  student_code: string;
  present: number;
  absent: number;
  late: number;
  excused: number;
  percentage: string | null;
}

/** GET /api/groups/{id}/attendance-summary/ */
export interface GroupAttendanceSummary {
  group: number;
  group_name: string;
  sessions: GroupAttendanceDateRow[];
  totals: { present: number; absent: number; late: number; excused: number; percentage: string | null };
  students: GroupAttendanceStudentRow[];
}

export interface GroupExamRow {
  exam: number;
  exam_name: string;
  type: string;
  date: string;
  max_score: string | null;
  passing_score: string | null;
  results_count: number;
  average_percentage: string | null;
  pass_rate: string | null;
}

export interface GroupPerformanceStudentRow {
  student: number;
  student_name: string;
  student_code: string;
  exams_taken: number;
  average_percentage: string | null;
  passed: number;
  failed: number;
  trend: string;
}

/** GET /api/groups/{id}/performance/ */
export interface GroupPerformance {
  group: number;
  group_name: string;
  exams: GroupExamRow[];
  average_percentage: string | null;
  pass_rate: string | null;
  students: GroupPerformanceStudentRow[];
  trend: string;
}

/** GET /api/groups/{id}/schedule/ */
export interface GroupScheduleSlot {
  id: number;
  weekday: number;
  weekday_name: string;
  start_time: string;
  end_time: string;
  teacher: string;
  room: string;
  effective_from: string | null;
  effective_to: string | null;
}

/** GET /api/groups/{id}/finance-summary/ */
export interface GroupFinanceSummary {
  group: number;
  group_name: string;
  period_start: string;
  students: InvoiceSummary[];
  amount_due: string | null;
  amount_paid: string | null;
  outstanding: string | null;
  paid_count: number;
  unpaid_count: number;
}

export interface GroupListParams {
  search?: string;
  status?: string;
  course?: number | '';
  teacher?: number | '';
  room?: number | '';
  page?: number;
  page_size?: number;
  ordering?: string;
}

export interface EnrollPayload {
  student: number;
  fee?: string | null;
  joined_at?: string | null;
  note?: string;
  allow_over_capacity?: boolean;
}

export interface RemoveStudentPayload {
  student: number;
  reason?: string;
  left_at?: string | null;
}

export const groupsApi = {
  list: (params?: GroupListParams): Promise<Paginated<Group>> =>
    list<Group>('/api/groups/', params as QueryParams),

  get: (id: number): Promise<Group> => api.get<Group>(`/api/groups/${id}/`),

  create: (payload: GroupWritePayload): Promise<Group> => api.post<Group>('/api/groups/', payload),

  update: (id: number, payload: GroupWritePayload): Promise<Group> =>
    api.patch<Group>(`/api/groups/${id}/`, payload),

  students: (id: number): Promise<GroupMembership[]> =>
    api.get<GroupMembership[]>(`/api/groups/${id}/students/`),

  memberships: (id: number): Promise<GroupMembership[]> =>
    api.get<GroupMembership[]>(`/api/groups/${id}/memberships/`),

  capacity: (id: number): Promise<GroupCapacity> =>
    api.get<GroupCapacity>(`/api/groups/${id}/capacity/`),

  attendanceSummary: (
    id: number,
    params?: { from?: string; to?: string },
  ): Promise<GroupAttendanceSummary> =>
    api.get<GroupAttendanceSummary>(`/api/groups/${id}/attendance-summary/`, {
      params: params as QueryParams,
    }),

  performance: (id: number): Promise<GroupPerformance> =>
    api.get<GroupPerformance>(`/api/groups/${id}/performance/`),

  schedule: (id: number): Promise<GroupScheduleSlot[]> =>
    api.get<GroupScheduleSlot[]>(`/api/groups/${id}/schedule/`),

  financeSummary: (id: number, params?: { period_start?: string }): Promise<GroupFinanceSummary> =>
    api.get<GroupFinanceSummary>(`/api/groups/${id}/finance-summary/`, {
      params: params as QueryParams,
    }),

  enroll: (id: number, payload: EnrollPayload): Promise<GroupMembership> =>
    api.post<GroupMembership>(`/api/groups/${id}/enroll/`, payload),

  removeStudent: (id: number, payload: RemoveStudentPayload): Promise<GroupMembership> =>
    api.post<GroupMembership>(`/api/groups/${id}/remove-student/`, payload),

  transfer: (id: number, payload: TransferPayload): Promise<GroupMembership> =>
    api.post<GroupMembership>(`/api/groups/${id}/transfer/`, payload),

  changeTeacher: (id: number, payload: { teacher: number | null }): Promise<Group> =>
    api.post<Group>(`/api/groups/${id}/change-teacher/`, payload),
};

// --------------------------------------------------------------------------- //
// Reference data (courses, rooms, teachers, memberships)
// --------------------------------------------------------------------------- //

export interface Course {
  id: number;
  code: string;
  name: string;
  description: string;
  level: string;
  default_monthly_fee: string | null;
  duration_months: number;
  status: string;
  groups_count: number;
  created_at: string;
}

export interface Room {
  id: number;
  name: string;
  capacity: number;
  location: string;
  equipment: string;
  status: string;
  groups_count: number;
}

export interface Teacher {
  id: number;
  first_name: string;
  last_name: string;
  full_name: string;
  phone: string;
  email: string;
  photo: string | null;
  specialization: string;
  employment_type: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  notes: string;
  user: number | null;
  has_account: boolean;
  groups_count: number;
  created_at: string;
}

export interface ReferenceData {
  courses: Course[];
  rooms: Room[];
  teachers: Teacher[];
}

const REFERENCE_PAGE_SIZE = 200;

/**
 * Load the dropdown vocabularies.
 *
 * Each call is independently tolerant: a user with `students.view` but without
 * `courses.view` still gets a working page, just with fewer filter options.
 */
export async function loadReferenceData(): Promise<ReferenceData> {
  const safe = async <T>(loader: () => Promise<Paginated<T>>): Promise<T[]> => {
    try {
      const page = await loader();
      return page.results;
    } catch {
      return [];
    }
  };

  const [courses, rooms, teachers] = await Promise.all([
    safe(() => list<Course>('/api/courses/', { page_size: REFERENCE_PAGE_SIZE })),
    safe(() => list<Room>('/api/rooms/', { page_size: REFERENCE_PAGE_SIZE })),
    safe(() => list<Teacher>('/api/teachers/', { page_size: REFERENCE_PAGE_SIZE })),
  ]);

  return { courses, rooms, teachers };
}

export const referenceApi = {
  courses: (params?: QueryParams): Promise<Paginated<Course>> => list<Course>('/api/courses/', params),
  rooms: (params?: QueryParams): Promise<Paginated<Room>> => list<Room>('/api/rooms/', params),
  teachers: (params?: QueryParams): Promise<Paginated<Teacher>> =>
    list<Teacher>('/api/teachers/', params),
  memberships: (params?: QueryParams): Promise<Paginated<GroupMembership>> =>
    list<GroupMembership>('/api/memberships/', params),
};
