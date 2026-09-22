/**
 * Attendance API calls + a small query hook.
 *
 * Paths match backend/apps/attendance/urls.py exactly.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, list, listAll } from '../../api';
import type { Paginated } from '../../types';
import type {
  AbsenceWatchRow,
  AttendanceSessionRow,
  AttendanceSheet,
  AttendanceTodayPayload,
  GroupOption,
  IncompleteSheet,
  MarkRecord,
  ScheduleSlotOption,
} from './types';

const PATH = '/api/attendance/';

/** Open (or re-open) the sheet for a group/date. Idempotent server-side. */
export function openSheet(payload: {
  group: number;
  date: string;
  slot?: number | null;
}): Promise<AttendanceSheet> {
  return api.post<AttendanceSheet>(PATH, payload);
}

export function getSheet(id: number): Promise<AttendanceSheet> {
  return api.get<AttendanceSheet>(`${PATH}${id}/`);
}

/** Bulk marking - the primary teacher workflow (one request per sheet). */
export function markSheet(
  id: number,
  records: MarkRecord[],
  submit: boolean,
): Promise<AttendanceSheet> {
  return api.post<AttendanceSheet>(`${PATH}${id}/mark/`, { records, submit });
}

/** Close the sheet for editing by marking it submitted. */
export function submitSheet(id: number): Promise<AttendanceSheet> {
  return api.post<AttendanceSheet>(`${PATH}${id}/submit/`);
}

export function todayAttendance(): Promise<AttendanceTodayPayload> {
  return api.get<AttendanceTodayPayload>(`${PATH}today/`);
}

export function incompleteSheets(
  date: string,
): Promise<{ date: string; results: IncompleteSheet[] }> {
  return api.get<{ date: string; results: IncompleteSheet[] }>(`${PATH}incomplete/`, {
    params: { date },
  });
}

export function absenceWatchlist(
  dateFrom: string,
  dateTo: string,
): Promise<{ results: AbsenceWatchRow[] }> {
  return api.get<{ results: AbsenceWatchRow[] }>(`${PATH}absences/`, {
    params: { date_from: dateFrom, date_to: dateTo },
  });
}

export interface SessionQuery {
  group?: number | '';
  date?: string;
  state?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
  page_size?: number;
}

export function attendanceSessions(
  params: SessionQuery,
): Promise<Paginated<AttendanceSessionRow>> {
  return list<AttendanceSessionRow>(PATH, { ...params });
}

/** Group picker options (server-scoped: a teacher only ever gets their own). */
export function groupOptions(search = ''): Promise<GroupOption[]> {
  return listAll<GroupOption>('/api/groups/', search === '' ? {} : { search }, 20);
}

/** The recurring slots of one group, for the optional slot selector. */
export function groupSchedule(groupId: number): Promise<ScheduleSlotOption[]> {
  return api.get<ScheduleSlotOption[]>(`/api/groups/${groupId}/schedule/`);
}

// -------------------------------------------------------------------------- //
// Small helpers
// -------------------------------------------------------------------------- //

/** ISO date -> 0 = Monday .. 6 = Sunday (Django's `weekday()` convention). */
export function weekdayIndex(isoDate: string): number {
  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return -1;
  const day = parsed.getDay();
  return day === 0 ? 6 : day - 1;
}

/** Parse a server decimal string ("85.00") into a number, or null. */
export function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface ApiQuery<T> {
  data: T | null;
  loading: boolean;
  error: unknown;
  reload: () => void;
  setData: (value: T | null) => void;
}

/**
 * Run an async request whenever `deps` change, cancelling the in-flight call
 * on unmount/dependency change. `load` is read through a ref so callers do not
 * need to memoise it.
 */
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
