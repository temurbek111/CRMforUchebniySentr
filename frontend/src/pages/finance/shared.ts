/**
 * Helpers shared by the Finance and Teachers page modules.
 *
 * Money rules enforced here:
 *  - every amount the API returns is a DECIMAL STRING ("1250000.00");
 *  - it is formatted exactly as a string (no float rounding) and only then
 *    decorated with the currency symbol configured in GET /api/settings;
 *  - nothing in these pages adds, subtracts or averages money in the browser:
 *    totals always come from the server summaries (/api/finance/summary...).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, errorMessages } from '../../types';
import type { FieldErrors } from '../../types';
import { formatDate, formatDateTime, formatMoney, type CurrencySettings } from '../../utils/format';

/** A decimal money string, exactly as the API sends it. */
export type DecimalString = string;

const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;
const DECIMAL_INPUT_PATTERN = /^\d+(\.\d{1,2})?$/;

const integerFormatter = new Intl.NumberFormat(undefined, {
  useGrouping: true,
  maximumFractionDigits: 0,
});

/** Locale-aware grouping of an integer digit string, without float maths. */
function groupInteger(digits: string): string {
  const trimmed = digits.replace(/^0+(?=\d)/, '');
  const normalised = trimmed === '' ? '0' : trimmed;
  try {
    return integerFormatter.format(BigInt(normalised));
  } catch {
    return normalised;
  }
}

function splitDecimal(value: string): { negative: boolean; integer: string; fraction: string } | null {
  const text = value.trim();
  if (text === '' || !DECIMAL_PATTERN.test(text.replace(/^-/, '')) ) return null;
  const negative = text.startsWith('-');
  const [integer = '0', fraction = ''] = text.replace(/^-/, '').split('.');
  return { negative, integer, fraction };
}

/**
 * Format a decimal string (or number) as money using the configured currency.
 * The digits are never parsed into a float: `"1234567.50"` with UZS settings
 * renders as `"1 234 567.50 so'm"` exactly as the server sent them.
 */
export function formatMoneyValue(
  value: string | number | null | undefined,
  currency: CurrencySettings,
): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return formatMoney(value, currency);
  const parts = splitDecimal(value);
  if (parts === null) return '—';
  const decimals = Number.isFinite(currency.currency_decimals)
    ? Math.max(0, Math.trunc(currency.currency_decimals))
    : 0;
  const fraction =
    decimals > 0 ? `.${`${parts.fraction}${'0'.repeat(decimals)}`.slice(0, decimals)}` : '';
  const grouped = groupInteger(parts.integer);
  const sign = parts.negative && grouped !== '0' ? '-' : '';
  const symbol = currency.currency_symbol || currency.currency_code;
  const body = `${sign}${grouped}${fraction}`;
  return symbol === '' ? body : `${body} ${symbol}`;
}

/** Same as {@link formatMoneyValue} but with a short currency code suffix. */
export function formatAmountValue(
  value: string | number | null | undefined,
  currency: CurrencySettings,
): string {
  const text = formatMoneyValue(value, currency);
  if (text === '—') return text;
  const symbol = currency.currency_symbol || currency.currency_code;
  return symbol === '' ? text : text.slice(0, text.length - symbol.length).trimEnd();
}

/** Percentages arrive as decimal strings in percent units ("87.50" -> "88%"). */
export function formatPercentValue(
  value: string | number | null | undefined,
  decimals = 0,
): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') {
    const safe = Number.isFinite(value) ? value.toFixed(Math.max(0, decimals)) : '0';
    const [integer = '0', fraction = ''] = safe.split('.');
    const fractionText = decimals > 0 ? `.${fraction.padEnd(decimals, '0').slice(0, decimals)}` : '';
    return `${groupInteger(integer)}${fractionText}%`;
  }
  const parts = splitDecimal(value);
  if (parts === null) return '—';
  const fractionText =
    decimals > 0 ? `.${`${parts.fraction}${'0'.repeat(decimals)}`.slice(0, decimals)}` : '';
  const sign = parts.negative && parts.integer !== '0' ? '-' : '';
  return `${sign}${groupInteger(parts.integer)}${fractionText}%`;
}

/**
 * Charts need numbers for pixel geometry. This conversion is display-only and
 * never feeds a money calculation back into the page.
 */
export function toChartNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** True when a form input holds a valid money amount (max two decimals). */
export function isDecimalInput(value: string): boolean {
  return DECIMAL_INPUT_PATTERN.test(value.trim());
}

/** True when a money string is exactly zero ("0", "0.00"), without parsing it. */
export function isZeroMoney(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const parts = splitDecimal(value);
  if (parts === null) return false;
  return parts.integer.replace(/^0+/, '') === '' && parts.fraction.replace(/0/g, '') === '';
}

// --------------------------------------------------------------------------- //
// Request state
// --------------------------------------------------------------------------- //

export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: unknown;
  reload: () => void;
}

/**
 * Loads one API resource and exposes loading/error state plus a `reload`.
 * Aborts the in-flight request when the inputs change or the page unmounts.
 */
export function useQueryData<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: ReadonlyArray<unknown>,
  enabled = true,
): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    loaderRef
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
    // The caller owns the dependency list (primitive filter values).
  }, [...deps, nonce, enabled]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { data, loading, error, reload };
}

export interface MutationState {
  busy: boolean;
  /** Anything thrown by the last attempt (ApiError carries field errors). */
  error: unknown;
  reset: () => void;
  /** Runs the action, capturing errors instead of throwing them. */
  run: (action: () => Promise<void>) => Promise<void>;
}

/** Small helper for write flows: busy flag, captured error, no try/catch noise. */
export function useMutation(): MutationState {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const run = useCallback(async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }, []);

  const reset = useCallback(() => setError(null), []);
  return { busy, error, reset, run };
}

/** Per-field validation messages from an ApiError. */
export function fieldErrorsOf(error: unknown): FieldErrors {
  return error instanceof ApiError ? error.errors : {};
}

/** Human readable lines for an unknown failure (detail first). */
export function messageLines(error: unknown): string[] {
  return errorMessages(error);
}

// --------------------------------------------------------------------------- //
// Domain enumerations (mirror the backend choices exactly)
// --------------------------------------------------------------------------- //

export interface Option {
  value: string;
  label: string;
}

/** Payment.Method (apps/finance/models.py). */
export const PAYMENT_METHODS: ReadonlyArray<Option> = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'card', label: 'Card' },
  { value: 'online', label: 'Online' },
  { value: 'other', label: 'Other' },
];

/** Income.Category - codes validated by the API; labels match its choices. */
export const INCOME_CATEGORIES: ReadonlyArray<Option> = [
  { value: 'student_fees', label: 'Student Fees' },
  { value: 'registration_fees', label: 'Registration Fees' },
  { value: 'exam_fees', label: 'Exam Fees' },
  { value: 'other', label: 'Other' },
];

/** Expense.Category - codes validated by the API; labels match its choices. */
export const EXPENSE_CATEGORIES: ReadonlyArray<Option> = [
  { value: 'teacher_salaries', label: 'Teacher Salaries' },
  { value: 'rent', label: 'Rent' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'internet', label: 'Internet' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'office_supplies', label: 'Office Supplies' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'software', label: 'Software' },
  { value: 'other', label: 'Other' },
];

/** SalaryModel (apps/payroll/models.py). */
export const SALARY_MODELS: ReadonlyArray<Option> = [
  { value: 'fixed', label: 'Fixed monthly' },
  { value: 'per_class', label: 'Per lesson' },
  { value: 'percentage', label: 'Percentage of group revenue' },
  { value: 'hybrid', label: 'Base + per lesson' },
];

/** PayrollStatus (apps/payroll/models.py). */
export const PAYROLL_STATUSES: ReadonlyArray<Option> = [
  { value: 'draft', label: 'Draft' },
  { value: 'calculated', label: 'Calculated' },
  { value: 'approved', label: 'Approved' },
  { value: 'paid', label: 'Paid' },
];

/** InvoiceStatus (apps/finance/models.py). */
export const INVOICE_STATUSES: ReadonlyArray<Option> = [
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partial', label: 'Partial' },
  { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'waived', label: 'Waived' },
  { value: 'cancelled', label: 'Cancelled' },
];

/** Teacher.Status (apps/academics/models.py). */
export const TEACHER_STATUSES: ReadonlyArray<Option> = [
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'graduated', label: 'Graduated' },
  { value: 'dropped', label: 'Dropped' },
  { value: 'archived', label: 'Archived' },
];

/** Teacher.EmploymentType (apps/academics/models.py). */
export const EMPLOYMENT_TYPES: ReadonlyArray<Option> = [
  { value: 'full_time', label: 'Full Time' },
  { value: 'part_time', label: 'Part Time' },
  { value: 'contract', label: 'Contract' },
  { value: 'freelance', label: 'Freelance' },
];

/** Label for a code, falling back to a humanised version of the code. */
export function labelFor(options: ReadonlyArray<Option>, code: string | null | undefined): string {
  if (code === null || code === undefined || code === '') return '—';
  const match = options.find((option) => option.value === code);
  if (match !== undefined) return match.label;
  return code.replace(/_/g, ' ');
}

/** Option list built from a shared map, plus any unknown codes from the data. */
export function optionsWithObserved(
  options: ReadonlyArray<Option>,
  observed: ReadonlyArray<string>,
): Option[] {
  const out: Option[] = [...options];
  for (const code of observed) {
    if (code !== '' && code !== null && !out.some((option) => option.value === code)) {
      out.push({ value: code, label: code.replace(/_/g, ' ') });
    }
  }
  return out;
}

// --------------------------------------------------------------------------- //
// Small display helpers
// --------------------------------------------------------------------------- //

export interface DateRange {
  from: string;
  to: string;
}

/** Current calendar month as an ISO range, the default for every money list. */
export function currentMonthRange(today: string): DateRange {
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

export function formatDateValue(value: string | null | undefined, timezone?: string): string {
  return formatDate(value, timezone);
}

export function formatDateTimeValue(value: string | null | undefined, timezone?: string): string {
  return formatDateTime(value, timezone);
}

/** "2026-09-01" + "2026-09-30" -> "Sep 01, 2026 – Sep 30, 2026". */
export function formatPeriodRange(
  start: string | null | undefined,
  end: string | null | undefined,
  timezone?: string,
): string {
  if (start === null || start === undefined || start === '') return '—';
  const left = formatDate(start, timezone);
  if (end === null || end === undefined || end === '') return left;
  return `${left} – ${formatDate(end, timezone)}`;
}

/** Renders a `breakdown` / `policy_snapshot` JSON value as a readable string. */
export function describeJsonValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((entry) => describeJsonValue(entry)).join(', ');
  return Object.entries(value as Record<string, unknown>)
    .map(([key, entry]) => `${key}: ${describeJsonValue(entry)}`)
    .join(' · ');
}

/**
 * Read one key out of an untyped JSON payload (policy_snapshot, breakdown)
 * without resorting to `any`.
 */
export function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}
