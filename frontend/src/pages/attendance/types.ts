/**
 * Attendance module types.
 *
 * Mirrors apps/attendance/serializers.py + services.session_payload().
 * Every number the page renders (counts, percentages, marked/unmarked) comes
 * from the server payload - the UI never recomputes attendance maths.
 */

/** AttendanceStatus choices as returned by `statuses`. */
export type AttendanceStatusValue = 'present' | 'absent' | 'late' | 'excused';

/** `{value, label}` pair the API sends for statuses and absence reasons. */
export interface Choice {
  value: string;
  label: string;
}

/** One roster row of an opened sheet (`roster[]`). */
export interface RosterRow {
  student: number;
  student_name: string;
  student_code: string;
  photo: string | null;
  /** null when the student has not been marked yet. */
  status: AttendanceStatusValue | null;
  reason: string;
  note: string;
  record_id: number | null;
  modified_by: string | null;
  marked_at: string | null;
}

/** Server-computed totals for one sheet. */
export interface SheetStatistics {
  roster: number;
  marked: number;
  unmarked: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  /** Percentage string, e.g. "85.00". */
  percentage: string;
}

export interface SheetSession {
  id: number;
  group: number;
  group_name: string;
  date: string;
  state: string;
  submitted_at: string | null;
  teacher: string | null;
}

/** POST /api/attendance/ and GET /api/attendance/{id}/ payload. */
export interface AttendanceSheet {
  session: SheetSession;
  roster: RosterRow[];
  statistics: SheetStatistics;
  statuses: Choice[];
  reasons: Choice[];
}

/** Row of GET /api/attendance/ (AttendanceSessionSerializer). */
export interface AttendanceSessionRow {
  id: number;
  group: number;
  group_name: string;
  course_name: string;
  date: string;
  slot: number | null;
  teacher: number | null;
  teacher_name: string;
  state: string;
  submitted_at: string | null;
  note: string;
  marked: number;
  roster: number;
  created_at: string;
}

/** GET /api/attendance/today/ */
export interface DailyTotals {
  date: string;
  present: number;
  absent: number;
  late: number;
  excused: number;
  marked: number;
  percentage: string;
}

/** A group that had a class but no submitted sheet. */
export interface IncompleteSheet {
  group: number;
  group_name: string;
  date: string;
  /** "missing" (no sheet) or "not_submitted". */
  state: string;
  time: string;
}

export interface AttendanceTodayPayload {
  date: string;
  totals: DailyTotals;
  sessions: AttendanceSessionRow[];
  incomplete: IncompleteSheet[];
}

/** GET /api/attendance/absences/ row. */
export interface AbsenceWatchRow {
  student: number;
  student_name: string;
  student_code: string;
  absences: number;
  streak: number;
  /** "streak" or "count" - which threshold triggered the alert. */
  reason: string;
  from: string;
  to: string;
}

/** Subset of GroupSerializer used by the group picker. */
export interface GroupOption {
  id: number;
  name: string;
  course_name?: string;
  teacher_name?: string;
  room_name?: string;
  student_count?: number;
  capacity?: number;
  status?: string;
}

/** One row of GET /api/groups/{id}/schedule/ (used for the optional slot picker). */
export interface ScheduleSlotOption {
  id: number;
  weekday: number;
  weekday_name: string;
  start_time: string;
  end_time: string;
  teacher: string;
  room: string;
}

/** POST /api/attendance/{id}/mark/ entry. */
export interface MarkRecord {
  student: number;
  status: AttendanceStatusValue;
  reason?: string;
  note?: string;
}

/** Local draft of one roster row while the teacher is marking. */
export interface DraftRow {
  student: number;
  status: AttendanceStatusValue | '';
  reason: string;
  note: string;
}
