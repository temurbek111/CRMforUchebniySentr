/**
 * Reports data layer.
 *
 * One endpoint per report name (`/api/reports/<name>`, apps/reporting/views.
 * ReportView) plus a CSV twin (`/export.csv`). The registry below is the
 * frontend's single source of truth for what exists - it mirrors
 * apps/reporting/services.REPORTS exactly, and a name that is not in it will
 * come back 404.
 *
 * IMPORTANT: the range parameters are `from` and `to`. The backend reads those
 * exact names (`_range()` in apps/reporting/views.py) and silently ignores
 * anything else - a typo does not error, it quietly returns the default range.
 *
 * Money crosses the wire as a decimal string; convert before formatting.
 */

import { api, withQuery } from '../../api';
import { toNumber } from '../students/api';

export { toNumber };

/** Reports that require reports.finance rather than reports.view. */
const FINANCE_GATED: ReadonlySet<string> = new Set(['finance', 'management']);

export interface ReportDefinition {
  name: string;
  label: string;
  description: string;
  /** True when the server requires Perm.REPORTS_FINANCE instead of REPORTS_VIEW. */
  financeGated: boolean;
  /**
   * False for the two reports whose builders accept no range
   * (`lambda **_:` in apps/reporting/services.REPORTS): 'groups' and 'at-risk'
   * always describe the present. The UI says so rather than letting a start and
   * end date imply they do something.
   */
  rangeAware: boolean;
}

/** Mirrors apps/reporting/services.REPORTS. */
export const REPORTS: ReadonlyArray<ReportDefinition> = [
  {
    name: 'students',
    label: 'Students',
    description: 'Enrolment movement: active, new, paused, dropped and graduated, by course and group.',
    financeGated: false,
    rangeAware: true,
  },
  {
    name: 'attendance',
    label: 'Attendance',
    description: 'Present, absent, late and excused totalled per day, per group and per student.',
    financeGated: false,
    rangeAware: true,
  },
  {
    name: 'academic',
    label: 'Academic',
    description: 'Exam averages, pass rate, who is below passing and which groups are declining.',
    financeGated: false,
    rangeAware: true,
  },
  {
    name: 'finance',
    label: 'Finance',
    description: 'Income, expenses, net result, collection rate, outstanding balances and the monthly series.',
    financeGated: true,
    rangeAware: true,
  },
  {
    name: 'management',
    label: 'Management',
    description: 'One page for the whole centre: students, attendance, finance, academic, admissions and payroll.',
    financeGated: true,
    rangeAware: true,
  },
  {
    name: 'groups',
    label: 'Groups',
    description: 'Every group with its course, teacher, room, enrolment and capacity utilisation.',
    financeGated: false,
    rangeAware: false,
  },
  {
    name: 'at-risk',
    label: 'At-risk students',
    description: 'Students breaching the attendance, payment or exam thresholds, with the reason for each flag.',
    financeGated: false,
    rangeAware: false,
  },
];

/**
 * The reports a caller may actually open.
 *
 * Two independent gates on the server (apps/reporting/views.ReportView):
 * `reports.view` for the whole endpoint, and additionally `reports.finance` for
 * the 'finance' and 'management' names. Checking only the finance gate would
 * offer reports to a role that cannot read any of them - the request would 403.
 */
export function reportsVisibleTo(
  hasPerm: (code: string) => boolean,
  viewCode: string,
  financeCode: string,
): ReportDefinition[] {
  if (!hasPerm(viewCode)) return [];
  return REPORTS.filter((report) => !report.financeGated || hasPerm(financeCode));
}

export function isFinanceGated(name: string): boolean {
  return FINANCE_GATED.has(name);
}

// --------------------------------------------------------------------------- //
// Payload types (only the fields these views render)
// --------------------------------------------------------------------------- //

export interface RangeLabel {
  from: string;
  to: string;
}

export interface NameCount {
  course?: string;
  group?: string;
  students: number;
}

export interface StudentsReport extends RangeLabel {
  active: number;
  new: number;
  dropped: number;
  graduated: number;
  paused: number;
  total_tracked: number;
  by_course: NameCount[];
  by_group: NameCount[];
}

export interface AttendanceSummary extends RangeLabel {
  present: number;
  absent: number;
  late: number;
  excused: number;
  percentage: string;
}

export interface AttendanceDailyRow {
  date: string;
  present: number;
  absent: number;
  late: number;
  excused: number;
}

export interface AttendanceGroupRow {
  group: string;
  present: number;
  absent: number;
  late: number;
}

export interface AttendanceStudentRow {
  student: number;
  student_name: string;
  student_code: string;
  present: number;
  absent: number;
  late: number;
  excused: number;
  percentage: string;
}

export interface RepeatedAbsenceRow {
  student: number;
  student_name: string;
  student_code: string;
  absences: number;
  streak: number;
  reason: string;
}

export interface AttendanceReport extends RangeLabel {
  summary: AttendanceSummary;
  daily: AttendanceDailyRow[];
  by_group: AttendanceGroupRow[];
  students: AttendanceStudentRow[];
  repeated_absences: RepeatedAbsenceRow[];
}

export interface AcademicSummary {
  exams_this_month: number;
  average_score: string;
  results_recorded: number;
  students_below_passing: number;
  declining_groups: number;
  pass_rate: string;
  passed: number;
  failed: number;
}

export interface BelowPassingRow {
  student: number;
  student_name: string;
  student_code: string;
  exam: number;
  exam_name: string;
  date: string;
  percentage: string;
  passing_percentage: string;
  link: string;
}

export interface DecliningGroupRow {
  group: number;
  group_name: string;
  first_average: string;
  last_average: string;
  delta: string;
  trend: string;
  link: string;
}

export interface AcademicReport extends RangeLabel {
  summary: AcademicSummary;
  below_passing: BelowPassingRow[];
  declining_groups: DecliningGroupRow[];
  upcoming_exams: unknown[];
}

export interface FinanceSummary extends RangeLabel {
  student_fees: string;
  other_income: string;
  gross_income: string;
  payroll: string;
  other_expenses: string;
  total_expenses: string;
  net_result: string;
  outstanding: string;
  overdue_count: number;
  collection_rate: string;
}

export interface BreakdownRow {
  category: string;
  amount: string;
  count?: number;
  payments?: number;
}

/** `revenue_by_course` is keyed by `course`, not `category`. */
export interface CourseRevenueRow {
  course: string;
  amount: string;
  payments: number;
}

export interface MonthlySeriesRow {
  label: string;
  month: number;
  income: string;
  expenses: string;
  net: string;
}

export interface OutstandingBuckets {
  [bucket: string]: { count: number; amount: string };
}

export interface FinanceReport {
  summary: FinanceSummary;
  income_breakdown: BreakdownRow[];
  expense_breakdown: BreakdownRow[];
  revenue_by_course: CourseRevenueRow[];
  outstanding: { as_of: string; count: number; amount: string; buckets: OutstandingBuckets };
  monthly_series: MonthlySeriesRow[];
  recent_payments: Array<Record<string, unknown>>;
}

export interface GroupReportRow {
  group: number;
  name: string;
  course: string;
  teacher: string;
  room: string;
  students: number;
  capacity: number;
  monthly_fee: string;
  status: string;
  utilisation_pct: string;
}

export interface GroupsReport {
  groups: GroupReportRow[];
}

export interface AtRiskRow {
  student: number;
  student_name: string;
  student_code: string;
  status: string;
  attendance_pct: string;
  absences_this_month: number;
  overdue: { days: number; amount: string };
  failed_exams: number;
  trend: string;
  severity: string;
  reasons: Array<{ code: string; label: string }>;
  link: string;
}

export interface AtRiskReport {
  students: AtRiskRow[];
}

export interface LeadsBlock {
  new_leads: number;
  trials: number;
  registered: number;
  lost: number;
  conversion_rate: number;
  by_source: Array<{ source: string; leads: number; registered: number; conversion_rate: number }>;
}

export interface PayrollBlock {
  label?: string;
  status?: string;
  total_net?: string;
  teachers_count?: number;
  [key: string]: unknown;
}

export interface ManagementReport {
  label: string;
  from: string;
  to: string;
  students: StudentsReport;
  attendance: AttendanceSummary;
  finance: FinanceSummary;
  academic: AcademicSummary;
  leads: LeadsBlock;
  groups: GroupReportRow[];
  payroll: PayrollBlock;
}

export type ReportPayload =
  | StudentsReport
  | AttendanceReport
  | AcademicReport
  | FinanceReport
  | ManagementReport
  | GroupsReport
  | AtRiskReport;

export interface ReportRange {
  from?: string;
  to?: string;
}

export const reportsApi = {
  /** Fetch one report for an optional range (`from`/`to`, ISO dates). */
  get: <T = ReportPayload>(name: string, range: ReportRange = {}): Promise<T> =>
    api.get<T>(withQuery(`/api/reports/${name}`, { from: range.from, to: range.to })),

  /**
   * URL of the CSV twin. Used as an anchor href so the browser performs the
   * download with the session cookie; the server sets Content-Disposition.
   */
  exportUrl: (name: string, range: ReportRange = {}): string =>
    withQuery(`/api/reports/${name}/export.csv`, { from: range.from, to: range.to }),
};

export default reportsApi;
