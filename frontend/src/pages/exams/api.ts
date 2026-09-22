/**
 * Exams / Results / Progress API calls.
 *
 * Paths match backend/apps/exams/urls.py, apps/academics/urls.py and
 * apps/reporting/urls.py (at-risk) exactly.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, list, listAll } from '../../api';
import type { Paginated } from '../../types';
import type {
  AtRiskStudent,
  CourseOption,
  Exam,
  ExamComponent,
  ExamResultRow,
  ExamResultsSummary,
  ExamWritePayload,
  GroupOption,
  GroupPerformance,
  GroupStudent,
  ResultEntry,
  StudentExamHistory,
  StudentOption,
  TeacherOption,
} from './types';

const EXAMS = '/api/exams/';

export interface ExamQuery {
  group?: number | '';
  course?: number | '';
  exam_type?: string;
  teacher?: number | '';
  date_from?: string;
  date_to?: string;
  is_published?: boolean | '';
  search?: string;
  page?: number;
  page_size?: number;
  ordering?: string;
}

export function exams(params: ExamQuery): Promise<Paginated<Exam>> {
  return list<Exam>(EXAMS, { ...params });
}

/** Every exam the caller may see, for filter dropdowns (bounded page walk). */
export function allExams(params: ExamQuery = {}): Promise<Exam[]> {
  return listAll<Exam>(EXAMS, { ...params, page_size: 200 }, 10);
}

export function getExam(id: number): Promise<Exam> {
  return api.get<Exam>(`${EXAMS}${id}/`);
}

export function createExam(payload: ExamWritePayload): Promise<Exam> {
  return api.post<Exam>(EXAMS, payload);
}

export function updateExam(id: number, payload: Partial<ExamWritePayload>): Promise<Exam> {
  return api.patch<Exam>(`${EXAMS}${id}/`, payload);
}

export function removeExam(id: number): Promise<void> {
  return api.delete<void>(`${EXAMS}${id}/`);
}

export function examComponents(id: number): Promise<ExamComponent[]> {
  return api.get<ExamComponent[]>(`${EXAMS}${id}/components/`);
}

/** The mark sheet: components, per-student scores and server statistics. */
export function examResults(id: number): Promise<ExamResultsSummary> {
  return api.get<ExamResultsSummary>(`${EXAMS}${id}/results/`);
}

/** Bulk mark entry - idempotent upsert per (exam, component, student). */
export function saveResults(id: number, entries: ResultEntry[]): Promise<ExamResultsSummary> {
  return api.post<ExamResultsSummary>(`${EXAMS}${id}/results/`, { entries });
}

export function publishExam(id: number): Promise<Exam> {
  return api.post<Exam>(`${EXAMS}${id}/publish/`);
}

export interface ResultQuery {
  exam?: number | '';
  student?: number | '';
  group?: number | '';
  course?: number | '';
  grade?: string;
  date_from?: string;
  date_to?: string;
  overall_only?: boolean;
  passed?: boolean;
  search?: string;
  page?: number;
  page_size?: number;
  ordering?: string;
}

export function results(params: ResultQuery): Promise<Paginated<ExamResultRow>> {
  return list<ExamResultRow>('/api/results/', { ...params });
}

/** The active students of a group (used to render the whole class mark sheet). */
export function groupStudents(groupId: number): Promise<GroupStudent[]> {
  return api.get<GroupStudent[]>(`/api/groups/${groupId}/students/`);
}

/** Exam history + momentum summaries for one student. */
export function studentExamHistory(studentId: number): Promise<StudentExamHistory> {
  return api.get<StudentExamHistory>(`/api/students/${studentId}/exams/`);
}

/** Exam-by-exam and student-by-student performance for one group. */
export function groupPerformance(groupId: number): Promise<GroupPerformance> {
  return api.get<GroupPerformance>(`/api/groups/${groupId}/performance/`);
}

/** Objective at-risk flags with their reasons (needs reports.view). */
export function atRiskStudents(): Promise<{ students: AtRiskStudent[] }> {
  // Reporting paths are declared with explicit path() entries, so they carry no
  // trailing slash (see backend/apps/reporting/urls.py).
  return api.get<{ students: AtRiskStudent[] }>('/api/at-risk');
}

export function groupOptions(search = ''): Promise<GroupOption[]> {
  return listAll<GroupOption>('/api/groups/', search === '' ? {} : { search }, 20);
}

export function courseOptions(): Promise<CourseOption[]> {
  return listAll<CourseOption>('/api/courses/', {}, 20);
}

export function teacherOptions(): Promise<TeacherOption[]> {
  return listAll<TeacherOption>('/api/teachers/', {}, 20);
}

export function studentOptions(group?: number | ''): Promise<StudentOption[]> {
  const params: Record<string, string | number> = {};
  if (group !== undefined && group !== '') params.group = group;
  return listAll<StudentOption>('/api/students/', params, 30);
}

// -------------------------------------------------------------------------- //
// Helpers
// -------------------------------------------------------------------------- //

/** Parse a server decimal string ("72.50") into a number, or null. */
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
