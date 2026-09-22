/**
 * Types for the core app: runtime settings, notifications and the audit trail.
 *
 * Mirrors apps/core/models.py, apps/core/serializers.py and apps/core/views.py.
 */

/** Notification severities (Notification.Severity). */
export type NotificationSeverity = 'info' | 'warning' | 'critical';

/** Notification kinds (Notification.Kind). */
export type NotificationKind =
  | 'payment_overdue'
  | 'attendance_warning'
  | 'exam_scheduled'
  | 'exam_result'
  | 'payroll_pending'
  | 'schedule_conflict'
  | 'attendance_incomplete'
  | 'system';

/** GET /api/notifications/ rows. */
export interface Notification {
  id: number;
  kind: NotificationKind | string;
  severity: NotificationSeverity | string;
  title: string;
  body: string;
  /** In-app route the alert points at, e.g. "/students". */
  link: string;
  payload: Record<string, unknown>;
  read_at: string | null;
  is_read: boolean;
  created_at: string;
}

/** Audit actions (AuditLog.Action). */
export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'login'
  | 'logout'
  | 'permission'
  | 'approve'
  | 'pay'
  | 'void';

/** GET /api/audit/ rows (read-only endpoint). */
export interface AuditEntry {
  id: number;
  actor: number | null;
  actor_name: string;
  action: AuditAction | string;
  entity: string;
  entity_id: string;
  summary: string;
  old_value: Record<string, unknown>;
  new_value: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
}

/** GET /api/audit/filter-options/ - data-driven filter dropdown values. */
export interface AuditFilterOptions {
  entities: string[];
  actions: string[];
}

/** Notification delivery channels (SystemSettings.notification_channels). */
export interface NotificationChannels {
  internal?: boolean;
  telegram?: boolean;
  sms?: boolean;
  email?: boolean;
  [channel: string]: boolean | undefined;
}

/**
 * GET /api/settings (SystemSettingsSerializer, `exclude = ("id",)`).
 *
 * Decimals arrive as JSON numbers (COERCE_DECIMAL_TO_STRING is False).
 */
export interface SystemSettings {
  centre_name: string;
  logo_url: string;
  currency_code: string;
  currency_symbol: string;
  currency_decimals: number;
  timezone: string;
  default_billing_day: number;
  attendance_threshold_pct: number;
  absence_alert_count: number;
  absence_streak_alert_count: number;
  failing_exam_alert_count: number;
  default_passing_score_pct: number;
  academic_year_start: string | null;
  academic_year_end: string | null;
  payment_methods: string[];
  lead_sources: string[];
  income_categories: string[];
  expense_categories: string[];
  notification_channels: NotificationChannels;
  updated_at: string;
}

/** PATCH /api/settings accepts any subset of the writable settings fields. */
export type SystemSettingsUpdate = Partial<Omit<SystemSettings, 'updated_at'>>;

/** A settings row that is only rendered after the request has resolved. */
export const EMPTY_SETTINGS: SystemSettings = {
  centre_name: '',
  logo_url: '',
  currency_code: '',
  currency_symbol: '',
  currency_decimals: 2,
  timezone: '',
  default_billing_day: 1,
  attendance_threshold_pct: 0,
  absence_alert_count: 0,
  absence_streak_alert_count: 0,
  failing_exam_alert_count: 0,
  default_passing_score_pct: 0,
  academic_year_start: null,
  academic_year_end: null,
  payment_methods: [],
  lead_sources: [],
  income_categories: [],
  expense_categories: [],
  notification_channels: {},
  updated_at: '',
};
