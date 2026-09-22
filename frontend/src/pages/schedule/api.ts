/**
 * Schedule module API calls.
 *
 * Paths match backend/apps/schedule/urls.py, apps/academics/urls.py and
 * apps/attendance/urls.py exactly. Conflicts (teacher / room / group) are
 * detected server-side and arrive as field errors on the 400 response - the
 * UI only displays them.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, list, listAll } from '../../api';
import type { ListQueryParams, Paginated, QueryParams } from '../../types';
import { toIsoDate } from '../../utils/format';
import type {
  CourseOption,
  GroupOption,
  IncompleteSession,
  PendingByDate,
  Room,
  ScheduleSlot,
  ScheduleSlotWritePayload,
  TeacherOption,
  WeekPayload,
} from './types';

const SCHEDULE = '/api/schedule/';

export interface WeekQuery {
  week_start: string;
  teacher?: number | '';
  room?: number | '';
  group?: number | '';
  course?: number | '';
}

export function weekSlots(params: WeekQuery): Promise<WeekPayload> {
  return api.get<WeekPayload>(`${SCHEDULE}week/`, { params: { ...params } });
}

/** The slots that occur today (already filtered to active, in-range slots). */
export function todaySlots(): Promise<ScheduleSlot[]> {
  return api.get<ScheduleSlot[]>(`${SCHEDULE}today/`);
}

export function slots(params: QueryParams): Promise<Paginated<ScheduleSlot>> {
  return list<ScheduleSlot>(SCHEDULE, params);
}

/** Create a slot; the server rejects overlapping teacher/room/group windows. */
export function createSlot(payload: ScheduleSlotWritePayload): Promise<ScheduleSlot> {
  return api.post<ScheduleSlot>(SCHEDULE, payload);
}

export function updateSlot(
  id: number,
  payload: Partial<ScheduleSlotWritePayload>,
): Promise<ScheduleSlot> {
  return api.patch<ScheduleSlot>(`${SCHEDULE}${id}/`, payload);
}

export function deleteSlot(id: number): Promise<void> {
  return api.delete<void>(`${SCHEDULE}${id}/`);
}

/** Query for the room list: the room filters plus the standard paging params. */
export interface RoomsQuery extends ListQueryParams {
  search?: string;
  status?: string;
}

/**
 * One page of rooms. The params object is spread straight into the query string,
 * so the standard `page` / `page_size` reach the server alongside the filters -
 * the type says so, so callers do not have to work around it.
 */
export function rooms(params: RoomsQuery = {}): Promise<Paginated<Room>> {
  return list<Room>('/api/rooms/', { ...params });
}

/** Every room, for the filter and slot-editor dropdowns. */
export function roomOptions(): Promise<Room[]> {
  return listAll<Room>('/api/rooms/', {}, 20);
}

export function groupOptions(search = ''): Promise<GroupOption[]> {
  return listAll<GroupOption>('/api/groups/', search === '' ? {} : { search }, 20);
}

export function teacherOptions(): Promise<TeacherOption[]> {
  return listAll<TeacherOption>('/api/teachers/', {}, 20);
}

export function courseOptions(): Promise<CourseOption[]> {
  return listAll<CourseOption>('/api/courses/', {}, 20);
}

/**
 * Which groups have a class but no submitted attendance sheet on `date`.
 * Used for the calendar's "attendance pending" indicator.
 */
export function incompleteForDate(
  date: string,
): Promise<{ date: string; results: IncompleteSession[] }> {
  return api.get<{ date: string; results: IncompleteSession[] }>('/api/attendance/incomplete/', {
    params: { date },
  });
}

/** Fetch the pending state of every elapsed day of a week, in parallel. */
export async function pendingForWeek(weekStart: string): Promise<PendingByDate> {
  const today = toIsoDate();
  const days = weekDates(weekStart).filter((day) => day <= today);
  const payloads = await Promise.all(days.map((day) => incompleteForDate(day)));
  const out: PendingByDate = {};
  for (const payload of payloads) {
    const bucket: Record<number, string> = {};
    for (const row of payload.results) bucket[row.group] = row.state;
    out[payload.date] = bucket;
  }
  return out;
}

// -------------------------------------------------------------------------- //
// Date helpers (all ISO `yyyy-mm-dd`, Monday-first weeks to match the API)
// -------------------------------------------------------------------------- //

function parseIso(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

/** Monday of the week containing `iso` (the API's `week_start`). */
export function startOfWeekIso(iso: string = toIsoDate()): string {
  const date = parseIso(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const weekday = date.getDay(); // 0 = Sunday
  const offset = weekday === 0 ? 6 : weekday - 1;
  return toIsoDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset));
}

export function addDaysIso(iso: string, days: number): string {
  const date = parseIso(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return toIsoDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
}

/** The seven ISO dates of the week that starts on `weekStart`. */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDaysIso(weekStart, index));
}

/** 0 = Monday .. 6 = Sunday (the API's `weekday` convention). */
export function weekdayOfIso(iso: string): number {
  const date = parseIso(iso);
  if (Number.isNaN(date.getTime())) return -1;
  const weekday = date.getDay();
  return weekday === 0 ? 6 : weekday - 1;
}

const weekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const longWeekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'long' });

/** Locale-aware weekday name for 0 = Monday .. 6 = Sunday. */
export function weekdayLabel(index: number, long = false): string {
  // 2024-01-01 is a Monday, so adding the index lands on the right weekday.
  const base = new Date(2024, 0, 1 + index);
  return (long ? longWeekdayFormatter : weekdayFormatter).format(base);
}

/** "09:30" from a "09:30:00" or "09:30" server time string. */
export function shortTime(value: string): string {
  return value.length > 5 ? value.slice(0, 5) : value;
}

/** Hours (1 decimal) from the server-computed duration in minutes. */
export function hoursFromMinutes(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10;
}

export interface ApiQuery<T> {
  data: T | null;
  loading: boolean;
  error: unknown;
  reload: () => void;
  setData: (value: T | null) => void;
}

/** Run an async request whenever `deps` change, cancelling on change/unmount. */
export function useApiQuery<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: ReadonlyArray<unknown>,
  enabled = true,
): ApiQuery<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    loadRef
      .current(controller.signal)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, enabled]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { data, loading, error, reload, setData };
}
