/**
 * Dashboard module entry point.
 *
 * Unlike the domain modules this one contributes no path routes: the dashboard
 * is the shell's index route (`{ index: true }` in router.tsx). It exports the
 * page and the data layer so the shell imports the module rather than reaching
 * into its files.
 */

export { DashboardPage } from './DashboardPage';
export { dashboardApi, DASHBOARD_PATH, toNumber } from './api';
export type {
  AtRiskStudent,
  Dashboard,
  DashboardAlert,
  DashboardCentre,
  DashboardKpis,
  DashboardPermissions,
  DashboardWidgets,
  FinancialMonth,
  PaymentStatus,
  RecentPayment,
  ScheduleRow,
} from './api';
