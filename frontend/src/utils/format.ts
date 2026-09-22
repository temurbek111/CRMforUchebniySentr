/**
 * Display formatters driven by the runtime SystemSettings row.
 *
 * Nothing here hardcodes a currency, a decimal count or a timezone: the
 * values always come from GET /api/settings (apps/core/models.py), so an
 * administrator changing the currency changes every screen.
 */

import type { Notification, SystemSettings } from '../types';

export type CurrencySettings = Pick<
  SystemSettings,
  'currency_symbol' | 'currency_code' | 'currency_decimals'
>;

const moneyFormatters = new Map<string, Intl.NumberFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function withTimezone(timezone: string | undefined): string | undefined {
  if (timezone === undefined || timezone.trim() === '') return undefined;
  try {
    // Throws (RangeError) for an unknown IANA name.
    new Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return timezone;
  } catch {
    return undefined;
  }
}

function moneyFormatter(decimals: number): Intl.NumberFormat {
  const key = String(decimals);
  const cached = moneyFormatters.get(key);
  if (cached !== undefined) return cached;
  const formatter = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  moneyFormatters.set(key, formatter);
  return formatter;
}

/** `1250000` with UZS settings -> "1 250 000 so'm". */
export function formatMoney(value: number | null | undefined, settings: CurrencySettings): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const decimals = Number.isFinite(settings.currency_decimals) ? settings.currency_decimals : 0;
  const symbol = settings.currency_symbol || settings.currency_code;
  const formatted = moneyFormatter(decimals).format(value);
  return symbol === '' ? formatted : `${formatted} ${symbol}`;
}

/** Money without the symbol, for table columns that carry a unit header. */
export function formatAmount(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return moneyFormatter(decimals).format(value);
}

export function formatNumber(
  value: number | null | undefined,
  decimals = 0,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return moneyFormatter(decimals).format(value);
}

/** Percentages arrive from the API already in percent units (75 -> "75%"). */
export function formatPercentage(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${moneyFormatter(decimals).format(value)}%`;
}

function dateFormatter(timezone: string | undefined): Intl.DateTimeFormat {
  const key = `date:${timezone ?? 'local'}`;
  const cached = dateFormatters.get(key);
  if (cached !== undefined) return cached;
  const formatter = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    timeZone: withTimezone(timezone),
  });
  dateFormatters.set(key, formatter);
  return formatter;
}

/**
 * Formatter for date-only values ("2026-03-12"), which are calendar dates
 * rather than instants.
 *
 * `new Date("2026-03-12")` is parsed as UTC midnight, so formatting it in a
 * negative-offset timezone (America/New_York, say) renders the *previous* day.
 * A due date, an exam date or an attendance date shown one day early is not a
 * cosmetic bug — it is a payment deadline. Date-only strings are therefore
 * pinned to UTC, which reproduces the exact calendar day the server sent in
 * every timezone.
 */
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function dateOnlyFormatter(): Intl.DateTimeFormat {
  const key = 'date:date-only-utc';
  const cached = dateFormatters.get(key);
  if (cached !== undefined) return cached;
  const formatter = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    timeZone: 'UTC',
  });
  dateFormatters.set(key, formatter);
  return formatter;
}

function dateTimeFormatter(timezone: string | undefined): Intl.DateTimeFormat {
  const key = `datetime:${timezone ?? 'local'}`;
  const cached = dateFormatters.get(key);
  if (cached !== undefined) return cached;
  const formatter = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: withTimezone(timezone),
  });
  dateFormatters.set(key, formatter);
  return formatter;
}

function parse(value: string | null | undefined): Date | null {
  if (value === null || value === undefined || value.trim() === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** ISO timestamp -> "12 Mar 2026" (or an em dash when empty/invalid). */
export function formatDate(value: string | null | undefined, timezone?: string): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (DATE_ONLY_PATTERN.test(trimmed)) {
      const [year, month, day] = trimmed.split('-').map(Number);
      const asUtc = new Date(Date.UTC(year, month - 1, day));
      if (!Number.isNaN(asUtc.getTime())) return dateOnlyFormatter().format(asUtc);
    }
  }
  const parsed = parse(value);
  if (parsed === null) return '—';
  return dateFormatter(timezone).format(parsed);
}

/** ISO timestamp -> "12 Mar 2026, 14:05". */
export function formatDateTime(value: string | null | undefined, timezone?: string): string {
  const parsed = parse(value);
  if (parsed === null) return '—';
  return dateTimeFormatter(timezone).format(parsed);
}

const RELATIVE_UNITS: Array<{ limit: number; divisor: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { limit: 60, divisor: 1, unit: 'second' },
  { limit: 3600, divisor: 60, unit: 'minute' },
  { limit: 86400, divisor: 3600, unit: 'hour' },
  { limit: 604800, divisor: 86400, unit: 'day' },
  { limit: 2629800, divisor: 604800, unit: 'week' },
  { limit: 31557600, divisor: 2629800, unit: 'month' },
];

const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** "3 hours ago" / "in 2 days" - used by the notification feed and audit log. */
export function formatRelativeTime(value: string | null | undefined): string {
  const parsed = parse(value);
  if (parsed === null) return '—';
  const seconds = (Date.now() - parsed.getTime()) / 1000;
  const magnitude = Math.abs(seconds);
  for (const entry of RELATIVE_UNITS) {
    if (magnitude < entry.limit) {
      return relativeFormatter.format(-Math.round(seconds / entry.divisor), entry.unit);
    }
  }
  return relativeFormatter.format(-Math.round(seconds / 31557600), 'year');
}

/** Title-case, snake_case and dash separated identifiers for display. */
export function humanise(value: string | null | undefined): string {
  if (value === null || value === undefined || value.trim() === '') return '';
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

/** "Ada Lovelace" -> "AL"; falls back to the username's first letters. */
export function initials(...parts: Array<string | null | undefined>): string {
  const words = parts
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .join(' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]?.charAt(0) ?? '';
  const second = words.length > 1 ? words[words.length - 1]?.charAt(0) ?? '' : '';
  return `${first}${second}`.toUpperCase();
}

/** Local date -> ISO `yyyy-mm-dd`, the format DateField and the API expect. */
export function toIsoDate(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** First day of the current month as ISO, for "this month" report defaults. */
export function startOfMonthIso(date: Date = new Date()): string {
  return toIsoDate(new Date(date.getFullYear(), date.getMonth(), 1));
}

/** Severity ordering helper for sorting notification lists. */
export function severityRank(notification: Notification): number {
  switch (notification.severity) {
    case 'critical':
      return 0;
    case 'warning':
      return 1;
    default:
      return 2;
  }
}
