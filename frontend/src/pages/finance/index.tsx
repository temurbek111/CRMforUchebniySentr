import type { RouteObject } from 'react-router-dom';
import { ExpensesPage } from './ExpensesPage';
import { IncomePage } from './IncomePage';
import { PaymentsPage } from './PaymentsPage';
import { PayrollPage } from './PayrollPage';

export { ExpensesPage } from './ExpensesPage';
export { FinanceOverviewSection } from './FinanceOverviewSection';
export { IncomePage } from './IncomePage';
export { PaymentsPage } from './PaymentsPage';
export { PayrollPage } from './PayrollPage';

export { LedgerPage } from './LedgerPage';
export { ReasonDialog } from './ReasonDialog';
export { financeApi, FINANCE_PATH, loadAllPages } from './api';
export type {
  BillingPeriodRow,
  BreakdownExpenseRow,
  BreakdownIncomeRow,
  ExpenseRow,
  FinanceBreakdown,
  FinanceSeries,
  FinanceSeriesPoint,
  FinanceSummary,
  GenerateInvoicesResult,
  IncomeRow,
  InvoiceRow,
  InvoiceWritePayload,
  LedgerRow,
  LedgerWritePayload,
  OutstandingSummary,
  PayrollCalculatePayload,
  PayrollItemRow,
  PayrollPayable,
  PayrollRunDetail,
  PayrollRunRow,
  PaymentRow,
  PaymentWritePayload,
} from './api';

/**
 * Routes contributed by the Finance module. Paths are relative to the shell
 * route ("/"), so the router owner only has to spread this array.
 */
export const financeRoutes: RouteObject[] = [
  { path: 'payments', element: <PaymentsPage /> },
  { path: 'income', element: <IncomePage /> },
  { path: 'expenses', element: <ExpensesPage /> },
  { path: 'payroll', element: <PayrollPage /> },
];
