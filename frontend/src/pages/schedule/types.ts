/**
 * Schedule (timetable, calendar, rooms) module types.
 *
 * Mirrors apps/schedule/serializers.py, apps/schedule/models.py,
 * apps/academics/serializers.py (rooms, groups) and the attendance
 * incomplete-session payload used for the "attendance pending" indicator.
 */

/** GET/POST /api/schedule/ row (ScheduleSlotSerializer). */
export interface ScheduleSlot {
  id: number;
  group: number;
  group_name: string;
  course_name: string;
  teacher: number | null;
  teacher_name: string;
  room: number | null;
  room_name: string;
  weekday: number;
  weekday_name: string;
  start_time: string;
  end_time: string;
  /** Server-computed duration in minutes. */
  duration_minutes: number;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  note: string;
  student_count: number;
  created_at: string;
}

/** GET /api/schedule/week/ */
export interface WeekPayload {
  week_start: string;
  slots: ScheduleSlot[];
}

export interface ScheduleSlotWritePayload {
  group: number;
  weekday: number;
  start_time: string;
  end_time: string;
  teacher?: number | null;
  room?: number | null;
  effective_from?: string | null;
  effective_to?: string | null;
  note?: string;
  is_active?: boolean;
  allow_capacity_override?: boolean;
}

/** GET /api/rooms/ row (RoomSerializer). */
export interface Room {
  id: number;
  name: string;
  capacity: number;
  location: string;
  equipment: string;
  status: string;
  groups_count: number;
}

/** GET /api/groups/ subset used by the filters and the slot editor. */
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

export interface TeacherOption {
  id: number;
  full_name: string;
  status?: string;
}

export interface CourseOption {
  id: number;
  code: string;
  name: string;
}

/** One entry of GET /api/attendance/incomplete/?date= . */
export interface IncompleteSession {
  group: number;
  group_name: string;
  date: string;
  /** "missing" (no sheet) or "not_submitted". */
  state: string;
  time: string;
}

/** date -> group id -> incomplete state, built for the calendar's indicators. */
export type PendingByDate = Record<string, Record<number, string>>;
