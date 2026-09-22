/**
 * Teachers + salary-policy API access for the page modules.
 *
 * Paths mirror backend/apps/academics/urls.py (teachers) and
 * backend/apps/payroll/urls.py (salaries, teacher earnings).
 */

import { api } from '../../api/client';
import type { Paginated, QueryParams } from '../../types';
import { isRecord } from '../../api/client';
import type { DecimalString } from '../finance/shared';
import type { PayrollItemRow } from '../finance/api';

/** GET /api/teachers/ row (academics TeacherSerializer). */
export interface TeacherRow {
  id: number;
  first_name: string;
  last_name: string;
  full_name: string;
  phone: string;
  email: string;
  photo: string | null;
  specialization: string;
  employment_type: string;
  start_date: string;
  end_date: string | null;
  status: string;
  notes: string;
  user: number | null;
  has_account: boolean;
  groups_count: number;
  created_at: string;
}

/** POST/PATCH /api/teachers/ body (TeacherWriteSerializer). */
export interface TeacherWritePayload {
  first_name: string;
  last_name: string;
  phone?: string;
  email?: string;
  specialization?: string;
  employment_type?: string;
  start_date?: string;
  end_date?: string | null;
  status?: string;
  notes?: string;
  /** Supplying both creates the linked login account. */
  username?: string;
  password?: string;
}

/** GET /api/teachers/{id}/groups/ row (academics GroupSerializer). */
export interface TeacherGroupRow {
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
  monthly_fee: DecimalString;
  start_date: string;
  end_date: string | null;
  status: string;
  notes: string;
  student_count: number;
  seats_available: number;
  schedule_summary: string;
  created_at: string;
}

/** GET /api/salaries/ row (payroll SalaryPolicySerializer). */
export interface SalaryPolicyRow {
  id: number;
  teacher: number;
  teacher_name: string;
  model: string;
  model_label: string;
  base_amount: DecimalString;
  per_lesson_rate: DecimalString;
  revenue_share_pct: DecimalString;
  lesson_bonus: DecimalString;
  effective_from: string;
  effective_to: string | null;
  is_open: boolean;
  note: string;
  created_at: string;
}

/** POST /api/salaries/ body (SalaryPolicyWriteSerializer) - always a NEW version. */
export interface SalaryPolicyWritePayload {
  teacher: number;
  model: string;
  effective_from: string;
  base_amount?: DecimalString;
  per_lesson_rate?: DecimalString;
  revenue_share_pct?: DecimalString;
  lesson_bonus?: DecimalString;
  note?: string;
}

/** One row of GET /api/salaries/current/. */
export interface CurrentSalaryRow {
  teacher: number;
  teacher_name: string;
  policy: SalaryPolicyRow | null;
  lessons_this_month: number;
}

/** A policy snapshot row (from services.policy_snapshot_row). */
export interface PolicySnapshotRow {
  id: number;
  note: string;
  model: string;
  model_label: string;
  base_amount: DecimalString;
  per_lesson_rate: DecimalString;
  revenue_share_pct: DecimalString;
  lesson_bonus: DecimalString;
  effective_from: string;
  effective_to: string | null;
}

/** A payroll line as returned inside a teacher's earnings history. */
export interface EarningsItemRow extends PayrollItemRow {
  run_label: string;
  run_status: string;
}

/** GET /api/teachers/{id}/earnings/. */
export interface TeacherEarnings {
  teacher: number;
  teacher_name: string;
  total_earned: DecimalString;
  payments_count: number;
  policies: PolicySnapshotRow[];
  items: EarningsItemRow[];
}

export const TEACHER_PATH = {
  teachers: '/api/teachers/',
  groups: '/api/groups/',
  salaries: '/api/salaries/',
  salariesCurrent: '/api/salaries/current/',
  teacherGroups: (id: number): string => `/api/teachers/${id}/groups/`,
  teacherEarnings: (id: number): string => `/api/teachers/${id}/earnings/`,
} as const;

/**
 * GET /api/salaries/current/ answers `{date, results: [...]}`; older builds
 * answered with a bare array, so both are accepted without inventing data.
 */
export function readCurrentSalaries(payload: unknown): CurrentSalaryRow[] {
  if (Array.isArray(payload)) return payload as CurrentSalaryRow[];
  if (isRecord(payload) && Array.isArray(payload.results)) {
    return payload.results as CurrentSalaryRow[];
  }
  return [];
}

export const teacherApi = {
  teachers: {
    list: (params: QueryParams, signal?: AbortSignal): Promise<Paginated<TeacherRow>> =>
      api.get<Paginated<TeacherRow>>(TEACHER_PATH.teachers, { params, signal }),
    get: (id: number, signal?: AbortSignal): Promise<TeacherRow> =>
      api.get<TeacherRow>(`${TEACHER_PATH.teachers}${id}/`, { signal }),
    create: (payload: TeacherWritePayload): Promise<TeacherRow> =>
      api.post<TeacherRow>(TEACHER_PATH.teachers, payload),
    update: (id: number, payload: Partial<TeacherWritePayload>): Promise<TeacherRow> =>
      api.patch<TeacherRow>(`${TEACHER_PATH.teachers}${id}/`, payload),
    /** DELETE archives the teacher server-side (history is preserved). */
    archive: (id: number): Promise<void> => api.delete<void>(`${TEACHER_PATH.teachers}${id}/`),
    groups: (id: number, signal?: AbortSignal): Promise<TeacherGroupRow[]> =>
      api.get<TeacherGroupRow[]>(TEACHER_PATH.teacherGroups(id), { signal }),
    earnings: (id: number, signal?: AbortSignal): Promise<TeacherEarnings> =>
      api.get<TeacherEarnings>(TEACHER_PATH.teacherEarnings(id), { signal }),
  },

  salaries: {
    list: (params: QueryParams, signal?: AbortSignal): Promise<Paginated<SalaryPolicyRow>> =>
      api.get<Paginated<SalaryPolicyRow>>(TEACHER_PATH.salaries, { params, signal }),
    current: (params: QueryParams, signal?: AbortSignal): Promise<CurrentSalaryRow[]> =>
      api
        .get<unknown>(TEACHER_PATH.salariesCurrent, { params, signal })
        .then((payload) => readCurrentSalaries(payload)),
    /** Creates a NEW policy version and closes the previous one. */
    create: (payload: SalaryPolicyWritePayload): Promise<SalaryPolicyRow> =>
      api.post<SalaryPolicyRow>(TEACHER_PATH.salaries, payload),
  },

  groups: {
    list: (params: QueryParams, signal?: AbortSignal): Promise<Paginated<TeacherGroupRow>> =>
      api.get<Paginated<TeacherGroupRow>>(TEACHER_PATH.groups, { params, signal }),
  },
};

export default teacherApi;
