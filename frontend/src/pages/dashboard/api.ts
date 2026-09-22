/**
 * Dashboard data layer.
 *
 * `GET /api/dashboard` (apps/reporting/views.DashboardView ->
 * apps/reporting/services.py) is the single source of truth: the server
 * aggregates every KPI, widget, alert and at-risk row in one response. This
 * module only describes that payload - the page formats it and never computes a
 * total of its own.
 *
 * Money crosses the API as a decimal STRING ("89550000.00"), never a float:
 * REST_FRAMEWORK.COERCE_DECIMAL_TO_STRING is pinned in config/settings.py so one
 * rounding error can never become a real dispute with a real parent. Callers
 * convert with `toNumber` before handing values to the settings formatters.
 *
 * Two numbers the dashboard deliberately does not carry (total teachers, active
 * groups) are read from the pagination envelope of their own list endpoints with
 * `page_size=1`, which transfers no rows.
 */

import { api, list } from '../../api';
import { toNumber } from '../students/api';

export { toNumber };

export const DASHBOARD_PATH = '/api/dashboard';

// --------------------------------------------------------------------------- //
// Payload types (mirrors apps/reporting/services.py `dashboard_payload`)
// --------------------------------------------------------------------------- //

export interface DashboardCentre {
  name: string;
  currency: string;
  currency_symbol: string;
  currency_decimals: number;
}

export interface StudentKpis {
  total: number;
  active: number;
  new_this_month: number;
  left_this_month: number;
  new_previous_month: number;
  new_change_pct: string;
}

export interface AttendanceBucket {
  date: string;
  present: number;
  absent: number;
  late: number;
  excused: number;
  marked: number;
  percentage: string;
}

export interface AttendanceMonthBucket {
  from: string;
  to: string;
  present: number;
  absent: number;
  late: number;
  excused: number;
  percentage: string;
}

export interface AttendanceKpis {
  today: AttendanceBucket;
  month: AttendanceMonthBucket;
}

export interface FinanceKpis {
  income_month: string;
  expenses_month: string;
  net_month: string;
  student_fees_month: string;
  other_income_month: string;
  payroll_month: string;
  outstanding: string;
  overdue_count: number;
  payroll_payable: string;
  collected_today: string;
  net_previous_month: string;
  net_change_pct: string;
}

export interface AcademicKpis {
  exams_this_month: number;
  average_score: string;
  results_recorded: number;
  students_below_passing: number;
  declining_groups: number;
  pass_rate: string;
  passed: number;
  failed: number;
}

export interface LeadSourceRow {
  source: string;
  leads: number;
  registered: number;
  conversion_rate: number;
}

export interface CrmKpis {
  new_leads: number;
  trials: number;
  registered: number;
  lost: number;
  conversion_rate: number;
  by_source: LeadSourceRow[];
}

export interface DashboardKpis {
  students: StudentKpis;
  attendance: AttendanceKpis;
  finance: FinanceKpis;
  academic: AcademicKpis;
  crm: CrmKpis;
}

export interface ScheduleRow {
  id: number;
  group: number;
  group_name: string;
  teacher: string;
  room: string;
  start_time: string;
  end_time: string;
  students: number;
  attendance_pending: boolean;
  link: string;
}

export interface UpcomingScheduleRow {
  date: string;
  weekday: string;
  group: number;
  group_name: string;
  teacher: string;
  room: string;
  start_time: string;
  end_time: string;
}

export interface FinancialSeriesRow {
  label: string;
  month: number;
  income: string;
  expenses: string;
  net: string;
}

export interface FinancialMonth {
  from: string;
  to: string;
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
  label: string;
}

export type PaymentStatusKey = 'paid' | 'partial' | 'unpaid' | 'overdue' | 'waived';

export interface PaymentStatus {
  period_start: string;
  counts: Record<PaymentStatusKey, number>;
  amounts: Record<PaymentStatusKey, string>;
}

export interface RecentPayment {
  id: number;
  student: number;
  student_name: string;
  student_code: string;
  amount: string;
  method: string;
  date: string;
  received_by: string;
  period: string;
}

export interface DashboardAlert {
  key: string;
  kind: string;
  severity: string;
  title: string;
  body: string;
  link: string;
  count: number;
  payload: Record<string, unknown>;
}

export interface AtRiskReason {
  code: string;
  label: string;
}

export interface AtRiskStudent {
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
  reasons: AtRiskReason[];
  link: string;
}

export interface DashboardWidgets {
  attendance_today: AttendanceBucket;
  todays_schedule: ScheduleRow[];
  upcoming_schedule: UpcomingScheduleRow[];
  financial_series: FinancialSeriesRow[];
  financial_month: FinancialMonth;
  payment_status: PaymentStatus;
  recent_payments: RecentPayment[];
  leads_by_source: LeadSourceRow[];
}

/**
 * What the caller's role is allowed to see. The server already omits the data;
 * these flags exist so the page can hide the *sections* rather than render empty
 * ones. Hiding is cosmetic - the API is the enforcement (see apps/accounts/rbac.py).
 */
export interface DashboardPermissions {
  finance: boolean;
  receivables: boolean;
  payroll: boolean;
  crm: boolean;
}

export interface Dashboard {
  generated_at: string;
  date: string;
  centre: DashboardCentre;
  kpis: DashboardKpis;
  widgets: DashboardWidgets;
  alerts: DashboardAlert[];
  at_risk: AtRiskStudent[];
  permissions: DashboardPermissions;
}

// --------------------------------------------------------------------------- //
// Client
// --------------------------------------------------------------------------- //

export const dashboardApi = {
  get: (): Promise<Dashboard> => api.get<Dashboard>(DASHBOARD_PATH),

  /**
   * Total teachers. The dashboard payload does not carry it, so read the
   * pagination envelope of `/api/teachers/` with page_size=1 (no rows travel).
   */
  teacherCount: (): Promise<number> =>
    list<unknown>('/api/teachers/', { page_size: 1 }).then((page) => page.count),

  /** Active groups, same envelope trick against `/api/groups/?status=active`. */
  activeGroupCount: (): Promise<number> =>
    list<unknown>('/api/groups/', { page_size: 1, status: 'active' }).then((page) => page.count),
};

export default dashboardApi;
