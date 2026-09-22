/**
 * Finance + payroll API access for the page modules.
 *
 * Paths mirror backend/apps/finance/urls.py and backend/apps/payroll/urls.py
 * exactly. Money is typed as a decimal STRING everywhere: the API serialises
 * DecimalField with COERCE_DECIMAL_TO_STRING, and the pages must never turn
 * those values into floats.
 *
 * The shared API client (src/api/client.ts) is owned by another workstream and
 * is used as-is; only these module-local wrappers are defined here.
 */

import { api } from '../../api/client';
import type { Paginated, QueryParams } from '../../types';
import type { DecimalString } from './shared';

// --------------------------------------------------------------------------- //
// Invoices & payments
// --------------------------------------------------------------------------- //

/** GET /api/invoices/ row (finance.serializers.InvoiceSerializer). */
export interface InvoiceRow {
  id: number;
  student: number;
  student_name: string;
  student_code: string;
  group: number | null;
  group_name: string;
  /** BillingPeriod primary key. */
  period: number | null;
  period_label: string;
  period_start: string;
  period_end: string;
  amount_due: DecimalString;
  amount_paid: DecimalString;
  remaining: DecimalString;
  credit: DecimalString;
  /** Stored status: unpaid | partial | paid | overdue | waived | cancelled. */
  status: string;
  /** Status including the derived 'overdue' state. */
  display_status: string;
  /** Payment deadline set when the billing period was generated. */
  due_date: string | null;
  days_overdue: number;
  waived_reason: string;
  notes: string;
  created_at: string;
}

/** POST/PATCH /api/invoices/ body (InvoiceWriteSerializer). */
export interface InvoiceWritePayload {
  student: number;
  group?: number | null;
  period_start: string;
  period_end: string;
  amount_due: DecimalString;
  due_date: string;
  notes?: string;
}

/** GET /api/payments/ row (PaymentSerializer). Payments are append-only. */
export interface PaymentRow {
  id: number;
  /** "PAY-000123" - the receipt the centre hands to the student. */
  receipt: string;
  student: number;
  student_name: string;
  student_code: string;
  invoice: number | null;
  period_label: string;
  amount: DecimalString;
  paid_at: string;
  method: string;
  method_label: string;
  received_by: number | null;
  received_by_name: string;
  reference: string;
  notes: string;
  is_void: boolean;
  void_reason: string;
  voided_at: string | null;
  created_at: string;
}

/** POST /api/payments/ body (PaymentWriteSerializer). */
export interface PaymentWritePayload {
  student: number;
  amount: DecimalString;
  invoice?: number | null;
  method: string;
  paid_at?: string | null;
  reference?: string;
  notes?: string;
  /** Explicit override needed for prepayment / paying a settled invoice. */
  allow_overpayment?: boolean;
}

/** POST /api/billing-periods/generate/ result (idempotent billing run). */
export interface GenerateInvoicesResult {
  period: string;
  period_start: string;
  created: number;
  skipped_existing: number;
  skipped_no_fee: number;
  invoices: InvoiceSummaryRow[];
}

/** GET /api/billing-periods/ row (BillingPeriodSerializer). */
export interface BillingPeriodRow {
  id: number;
  label: string;
  period_start: string;
  period_end: string;
  due_date: string;
  is_closed: boolean;
  invoices_count: number;
}

/** Shape returned by finance.services.invoice_summary (summaries + generate). */
export interface InvoiceSummaryRow {
  id: number;
  student: number;
  student_name: string;
  student_code: string;
  group: number | null;
  group_name: string;
  /** NOTE: a LABEL here (the serializer's `period` is the FK id). */
  period: string;
  period_start: string;
  period_end: string;
  amount_due: DecimalString;
  amount_paid: DecimalString;
  remaining: DecimalString;
  credit: DecimalString;
  status: string;
  status_label: string;
  due_date: string;
  days_overdue: number;
  notes: string;
  /** Present on /finance/summary/outstanding/ rows only. */
  remaining_amount?: DecimalString;
}

// --------------------------------------------------------------------------- //
// Income & expenses
// --------------------------------------------------------------------------- //

export interface LedgerRow {
  id: number;
  category: string;
  category_label: string;
  /** Human label the API resolves (free-text override or the enum label). */
  category_label_display: string;
  amount: DecimalString;
  date: string;
  description: string;
  method: string;
  method_label: string;
  reference: string;
  created_by_name: string;
  is_void: boolean;
  void_reason: string;
  created_at: string;
}

/** Income rows additionally carry the optional student link. */
export interface IncomeRow extends LedgerRow {
  student: number | null;
  student_name: string;
}

export type ExpenseRow = LedgerRow;

/** POST/PATCH body for /api/income/ and /api/expenses/. */
export interface LedgerWritePayload {
  category: string;
  category_label?: string;
  amount: DecimalString;
  date: string;
  description?: string;
  method?: string;
  reference?: string;
}

// --------------------------------------------------------------------------- //
// Summaries
// --------------------------------------------------------------------------- //

/** GET /api/finance/summary (finance.services.finance_summary). */
export interface FinanceSummary {
  from: string;
  to: string;
  student_fees: DecimalString;
  other_income: DecimalString;
  gross_income: DecimalString;
  payroll: DecimalString;
  other_expenses: DecimalString;
  total_expenses: DecimalString;
  net_result: DecimalString;
  outstanding: DecimalString;
  overdue_count: number;
  collection_rate: DecimalString;
}

/** GET /api/finance/summary/outstanding/. */
export interface OutstandingSummary {
  as_of: string;
  count: number;
  amount: DecimalString;
  overdue_count: number;
  overdue_amount: DecimalString;
  buckets: Record<string, { count: number; amount: DecimalString }>;
  invoices: InvoiceSummaryRow[];
  overdue_invoices: InvoiceSummaryRow[];
}

export interface BreakdownIncomeRow {
  category: string;
  amount: DecimalString;
}

export interface BreakdownExpenseRow {
  category: string;
  category_code: string;
  amount: DecimalString;
  count: number;
}

/** GET /api/finance/summary/breakdown/. */
export interface FinanceBreakdown {
  from: string;
  to: string;
  income: BreakdownIncomeRow[];
  expenses: BreakdownExpenseRow[];
}

export interface FinanceSeriesPoint {
  label: string;
  month: number;
  income: DecimalString;
  expenses: DecimalString;
  net: DecimalString;
}

/** GET /api/finance/summary/series/?year=. */
export interface FinanceSeries {
  year: number;
  series: FinanceSeriesPoint[];
}

/** GET /api/finance/summary/revenue-by-course/. */
export interface RevenueByCourse {
  from: string;
  to: string;
  results: Array<{ course: string; amount: DecimalString; payments: number }>;
}

// --------------------------------------------------------------------------- //
// Payroll
// --------------------------------------------------------------------------- //

/** One frozen teacher line of a payroll run (payroll.services.item_summary). */
export interface PayrollItemRow {
  id: number;
  run: number;
  teacher: number;
  teacher_name: string;
  lessons_count: number;
  base_amount: DecimalString;
  per_lesson_amount: DecimalString;
  revenue_share_amount: DecimalString;
  revenue_base: DecimalString;
  bonuses: DecimalString;
  deductions: DecimalString;
  gross_amount: DecimalString;
  net_amount: DecimalString;
  /** Frozen SalaryPolicy copy: model, model_label, rates, effective range. */
  policy_snapshot: Record<string, unknown>;
  /** Calculation trace, e.g. {"per_lesson": "50000 x 12 lessons"}. */
  breakdown: Record<string, string>;
  note: string;
}

/** GET /api/payroll/ row (PayrollRunSerializer). */
export interface PayrollRunRow {
  id: number;
  label: string;
  period_start: string;
  period_end: string;
  status: string;
  status_label: string;
  is_locked: boolean;
  total_gross: DecimalString;
  total_deductions: DecimalString;
  total_net: DecimalString;
  teachers_count: number;
  calculated_at: string | null;
  approved_by: number | null;
  approved_by_name?: string;
  approved_at: string | null;
  paid_at: string | null;
  expense: number | null;
  notes: string;
  created_at?: string;
}

/**
 * GET /api/payroll/{id}/ (payroll.services.run_summary).
 * Slight shape difference from the list serializer: `approved_by` is already
 * the approver's display name here.
 */
export interface PayrollRunDetail {
  id: number;
  label: string;
  period_start: string;
  period_end: string;
  status: string;
  status_label: string;
  is_locked: boolean;
  total_gross: DecimalString;
  total_deductions: DecimalString;
  total_net: DecimalString;
  teachers_count: number;
  calculated_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  paid_at: string | null;
  expense: number | null;
  notes: string;
  items: PayrollItemRow[];
}

/** POST /api/payroll/calculate/ body (CalculatePayrollSerializer). */
export interface PayrollCalculatePayload {
  period_start: string;
  period_end: string;
  /** Restrict the run to these teachers; omit for every active teacher. */
  teacher_ids?: number[];
  /** {teacherId: "amount"} decimal strings, never floats. */
  deductions?: Record<string, DecimalString>;
  label?: string;
}

/** POST /api/payroll/{id}/pay/ body (PayPayrollSerializer). */
export interface PayrollPayPayload {
  method: string;
  paid_date?: string | null;
  reference?: string;
}

/** GET /api/payroll/payable/. */
export interface PayrollPayable {
  payroll_payable: DecimalString;
  pending_runs: PayrollRunRow[];
}

export const FINANCE_PATH = {
  invoices: '/api/invoices/',
  payments: '/api/payments/',
  income: '/api/income/',
  expenses: '/api/expenses/',
  billingPeriods: '/api/billing-periods/',
  summary: '/api/finance/summary',
  summaryBreakdown: '/api/finance/summary/breakdown',
  summarySeries: '/api/finance/summary/series',
  summaryOutstanding: '/api/finance/summary/outstanding',
  summaryRevenueByCourse: '/api/finance/summary/revenue-by-course',
  payroll: '/api/payroll/',
  payrollCalculate: '/api/payroll/calculate/',
  payrollPayable: '/api/payroll/payable/',
  /** No trailing slash for the teacher sub-resources (explicit path entries). */
  teacherGroups: (id: number): string => `/api/teachers/${id}/groups/`,
} as const;

function getList<T>(
  path: string,
  params?: QueryParams,
  signal?: AbortSignal,
): Promise<Paginated<T>> {
  return api.get<Paginated<T>>(path, { params, signal });
}

/**
 * Walk every page of a list endpoint.
 *
 * The income/expense list APIs filter by EXACT date only, so the ledger pages
 * load their (server-filtered) rows and narrow them to a date range in the UI.
 * The loop is capped: callers surface the cap instead of pretending the list
 * is complete.
 */
export async function loadAllPages<T>(
  fetchPage: (page: number, signal?: AbortSignal) => Promise<Paginated<T>>,
  signal?: AbortSignal,
  maxPages = 10,
): Promise<T[]> {
  const collected: T[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await fetchPage(page, signal);
    collected.push(...response.results);
    if (response.next === null || response.results.length === 0) break;
  }
  return collected;
}

export const financeApi = {
  invoices: {
    list: (params: QueryParams, signal?: AbortSignal): Promise<Paginated<InvoiceRow>> =>
      getList<InvoiceRow>(FINANCE_PATH.invoices, params, signal),
    create: (payload: InvoiceWritePayload): Promise<InvoiceRow> =>
      api.post<InvoiceRow>(FINANCE_PATH.invoices, payload),
    update: (id: number, payload: Partial<InvoiceWritePayload>): Promise<InvoiceRow> =>
      api.patch<InvoiceRow>(`${FINANCE_PATH.invoices}${id}/`, payload),
    waive: (id: number, reason: string): Promise<InvoiceRow> =>
      api.post<InvoiceRow>(`${FINANCE_PATH.invoices}${id}/waive/`, { reason }),
    cancel: (id: number, reason: string): Promise<InvoiceRow> =>
      api.post<InvoiceRow>(`${FINANCE_PATH.invoices}${id}/cancel/`, { reason }),
  },

  payments: {
    list: (params: QueryParams, signal?: AbortSignal): Promise<Paginated<PaymentRow>> =>
      getList<PaymentRow>(FINANCE_PATH.payments, params, signal),
    create: (payload: PaymentWritePayload): Promise<PaymentRow> =>
      api.post<PaymentRow>(FINANCE_PATH.payments, payload),
    /** Payments are never edited or deleted - only voided with a reason. */
    void: (id: number, reason: string): Promise<PaymentRow> =>
      api.post<PaymentRow>(`${FINANCE_PATH.payments}${id}/void/`, { reason }),
  },

  billingPeriods: {
    list: (params: QueryParams, signal?: AbortSignal): Promise<Paginated<BillingPeriodRow>> =>
      getList<BillingPeriodRow>(FINANCE_PATH.billingPeriods, params, signal),
    generate: (payload: {
      year: number;
      month: number;
      due_date?: string;
      group?: number;
    }): Promise<GenerateInvoicesResult> =>
      api.post<GenerateInvoicesResult>(`${FINANCE_PATH.billingPeriods}generate/`, payload),
  },

  income: {
    list: (params: QueryParams, signal?: AbortSignal): Promise<Paginated<IncomeRow>> =>
      getList<IncomeRow>(FINANCE_PATH.income, params, signal),
    create: (payload: LedgerWritePayload): Promise<IncomeRow> =>
      api.post<IncomeRow>(FINANCE_PATH.income, payload),
    update: (id: number, payload: Partial<LedgerWritePayload>): Promise<IncomeRow> =>
      api.patch<IncomeRow>(`${FINANCE_PATH.income}${id}/`, payload),
    void: (id: number, reason: string): Promise<IncomeRow> =>
      api.post<IncomeRow>(`${FINANCE_PATH.income}${id}/void/`, { reason }),
  },

  expenses: {
    list: (params: QueryParams, signal?: AbortSignal): Promise<Paginated<ExpenseRow>> =>
      getList<ExpenseRow>(FINANCE_PATH.expenses, params, signal),
    create: (payload: LedgerWritePayload): Promise<ExpenseRow> =>
      api.post<ExpenseRow>(FINANCE_PATH.expenses, payload),
    update: (id: number, payload: Partial<LedgerWritePayload>): Promise<ExpenseRow> =>
      api.patch<ExpenseRow>(`${FINANCE_PATH.expenses}${id}/`, payload),
    void: (id: number, reason: string): Promise<ExpenseRow> =>
      api.post<ExpenseRow>(`${FINANCE_PATH.expenses}${id}/void/`, { reason }),
  },

  summary: {
    get: (params: QueryParams, signal?: AbortSignal): Promise<FinanceSummary> =>
      api.get<FinanceSummary>(FINANCE_PATH.summary, { params, signal }),
    breakdown: (params: QueryParams, signal?: AbortSignal): Promise<FinanceBreakdown> =>
      api.get<FinanceBreakdown>(FINANCE_PATH.summaryBreakdown, { params, signal }),
    series: (params: QueryParams, signal?: AbortSignal): Promise<FinanceSeries> =>
      api.get<FinanceSeries>(FINANCE_PATH.summarySeries, { params, signal }),
    outstanding: (signal?: AbortSignal): Promise<OutstandingSummary> =>
      api.get<OutstandingSummary>(FINANCE_PATH.summaryOutstanding, { signal }),
    revenueByCourse: (params: QueryParams, signal?: AbortSignal): Promise<RevenueByCourse> =>
      api.get<RevenueByCourse>(FINANCE_PATH.summaryRevenueByCourse, { params, signal }),
  },

  payroll: {
    list: (params: QueryParams, signal?: AbortSignal): Promise<Paginated<PayrollRunRow>> =>
      getList<PayrollRunRow>(FINANCE_PATH.payroll, params, signal),
    get: (id: number, signal?: AbortSignal): Promise<PayrollRunDetail> =>
      api.get<PayrollRunDetail>(`${FINANCE_PATH.payroll}${id}/`, { signal }),
    calculate: (payload: PayrollCalculatePayload): Promise<PayrollRunDetail> =>
      api.post<PayrollRunDetail>(FINANCE_PATH.payrollCalculate, payload),
    approve: (id: number): Promise<PayrollRunDetail> =>
      api.post<PayrollRunDetail>(`${FINANCE_PATH.payroll}${id}/approve/`),
    pay: (id: number, payload: PayrollPayPayload): Promise<PayrollRunDetail> =>
      api.post<PayrollRunDetail>(`${FINANCE_PATH.payroll}${id}/pay/`, payload),
    payable: (signal?: AbortSignal): Promise<PayrollPayable> =>
      api.get<PayrollPayable>(FINANCE_PATH.payrollPayable, { signal }),
  },
};

export default financeApi;
