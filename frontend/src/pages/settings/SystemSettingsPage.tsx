/**
 * System settings — the centre's runtime configuration.
 *
 * Backed by the single row in apps/core/models.SystemSettings:
 *
 *   GET   /api/settings   any signed-in user   (apps/core/views.SettingsView)
 *   PATCH /api/settings   requires settings.manage
 *
 * The page never fetches the row itself. It renders `useSettings()` — the
 * app-wide context — and saves through the context's `update`, so currency
 * formatting, the active timezone and the centre name in the topbar all pick up
 * the new values the moment the request resolves.
 *
 * WHAT SAVE SENDS — a partial PATCH, deliberately
 * ----------------------------------------------
 * The form keeps the whole row in a local draft, but `Save changes` PATCHes only
 * the fields whose draft value differs from the stored row. The endpoint is
 * `partial=True` and `SystemSettingsSerializer` validates field by field, so a
 * partial body is exactly what it expects. Reasons for patching the delta only:
 *
 *   1. the backend writes an audit entry listing precisely the fields that
 *      moved (apps/core/views.SettingsView.patch), so resending the whole row
 *      would record noise instead of the real change;
 *   2. a field the administrator never touched can never be written back with a
 *      stale value if the row was changed elsewhere in the meantime.
 *
 * Fields that fail client-side checks are never put in the patch, so an invalid
 * number can never be sent as `NaN`. Every server-side validation error is
 * rendered inline under its own field, and the success banner appears only after
 * a request that actually succeeded.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Badge, Button, Card, DateField, ErrorState, LoadingState, TextField } from '../../components';
import { useAuth } from '../../auth/AuthContext';
import { ApiError, EMPTY_SETTINGS, PERMISSIONS, errorMessage } from '../../types';
import type { NotificationChannels, SystemSettings, SystemSettingsUpdate } from '../../types';
import { useSettings } from '../../settings/SettingsContext';
import { InlineNote } from '../students/ui';

const FORM_ID = 'system-settings-form';

// --------------------------------------------------------------------------- //
// Field groups (the authoritative list is types/core.ts SystemSettings)
// --------------------------------------------------------------------------- //

/** Plain string fields. Dates and numbers are handled separately below. */
type TextField2 =
  | 'centre_name'
  | 'logo_url'
  | 'currency_code'
  | 'currency_symbol'
  | 'timezone';

const NUMERIC_FIELDS = [
  'currency_decimals',
  'default_billing_day',
  'attendance_threshold_pct',
  'absence_alert_count',
  'absence_streak_alert_count',
  'failing_exam_alert_count',
  'default_passing_score_pct',
] as const;
type NumericField = (typeof NUMERIC_FIELDS)[number];

const LIST_FIELDS = [
  'payment_methods',
  'lead_sources',
  'income_categories',
  'expense_categories',
] as const;
type ListField = (typeof LIST_FIELDS)[number];

/** The channels the serializer's JSONField model writes by default. */
const CHANNEL_KEYS = ['internal', 'telegram', 'sms', 'email'] as const;
type ChannelKey = (typeof CHANNEL_KEYS)[number];

interface Draft {
  /** Every scalar is held as a string so an empty number input stays editable. */
  scalars: Record<TextField2 | NumericField | 'academic_year_start' | 'academic_year_end', string>;
  lists: Record<ListField, string[]>;
  channels: Record<ChannelKey, boolean>;
}

/** Constraints mirror the model validators (apps/core/models.SystemSettings). */
interface NumberSpec {
  label: string;
  min?: number;
  max?: number;
  integer?: boolean;
}

const NUMBER_SPECS: Record<NumericField, NumberSpec> = {
  currency_decimals: { label: 'Decimal places', min: 0, max: 6, integer: true },
  default_billing_day: { label: 'Billing day', min: 1, max: 28, integer: true },
  attendance_threshold_pct: { label: 'Attendance threshold', min: 0, max: 100 },
  absence_alert_count: { label: 'Absence alert count', min: 0, integer: true },
  absence_streak_alert_count: { label: 'Consecutive absence alert count', min: 0, integer: true },
  failing_exam_alert_count: { label: 'Failing result alert count', min: 0, integer: true },
  default_passing_score_pct: { label: 'Default passing score', min: 0, max: 100 },
};

const LIST_LABELS: Record<ListField, string> = {
  payment_methods: 'payment method',
  lead_sources: 'lead source',
  income_categories: 'income category',
  expense_categories: 'expense category',
};

const CHANNEL_FIELDS: ReadonlyArray<{ key: ChannelKey; label: string; hint: string }> = [
  {
    key: 'internal',
    label: 'In-app',
    hint: 'The CRM’s own notification centre (apps/core/models.Notification).',
  },
  {
    key: 'telegram',
    label: 'Telegram',
    hint: 'Recorded for the external provider that consumes this channel; the CRM writes the in-app feed itself.',
  },
  {
    key: 'sms',
    label: 'SMS',
    hint: 'Recorded for the external provider that consumes this channel.',
  },
  {
    key: 'email',
    label: 'Email',
    hint: 'Recorded for the external provider that consumes this channel.',
  },
];

// --------------------------------------------------------------------------- //
// Draft <-> row
// --------------------------------------------------------------------------- //

function toDraft(settings: SystemSettings): Draft {
  const channels = {} as Record<ChannelKey, boolean>;
  for (const key of CHANNEL_KEYS) channels[key] = settings.notification_channels[key] === true;

  return {
    scalars: {
      centre_name: settings.centre_name,
      logo_url: settings.logo_url,
      currency_code: settings.currency_code,
      currency_symbol: settings.currency_symbol,
      currency_decimals: String(settings.currency_decimals),
      timezone: settings.timezone,
      default_billing_day: String(settings.default_billing_day),
      attendance_threshold_pct: String(settings.attendance_threshold_pct),
      absence_alert_count: String(settings.absence_alert_count),
      absence_streak_alert_count: String(settings.absence_streak_alert_count),
      failing_exam_alert_count: String(settings.failing_exam_alert_count),
      default_passing_score_pct: String(settings.default_passing_score_pct),
      academic_year_start: settings.academic_year_start ?? '',
      academic_year_end: settings.academic_year_end ?? '',
    },
    lists: {
      payment_methods: [...settings.payment_methods],
      lead_sources: [...settings.lead_sources],
      income_categories: [...settings.income_categories],
      expense_categories: [...settings.expense_categories],
    },
    channels,
  };
}

interface DraftDiff {
  /** Only the changed fields — this is exactly what gets PATCHed. */
  patch: SystemSettingsUpdate;
  /** Client-side blockers, keyed by the same field names the API uses. */
  errors: Record<string, string>;
  changed: string[];
}

/** Trim, drop blanks and de-duplicate — the same cleaning the serializer applies. */
function cleanList(values: ReadonlyArray<string>): string[] {
  const out: string[] = [];
  for (const raw of values) {
    const name = raw.trim();
    if (name !== '' && !out.includes(name)) out.push(name);
  }
  return out;
}

function sameList(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function looksLikeUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function parseNumber(raw: string, spec: NumberSpec): { value?: number; error?: string } {
  const text = raw.trim();
  if (text === '') return { error: `Enter the ${spec.label.toLowerCase()}.` };
  const value = Number(text);
  if (!Number.isFinite(value)) return { error: `${spec.label} must be a number.` };
  if (spec.integer === true && !Number.isInteger(value)) {
    return { error: `${spec.label} must be a whole number.` };
  }
  if (
    (spec.min !== undefined && value < spec.min) ||
    (spec.max !== undefined && value > spec.max)
  ) {
    if (spec.min !== undefined && spec.max !== undefined) {
      return { error: `${spec.label} must be between ${spec.min} and ${spec.max}.` };
    }
    if (spec.min !== undefined) return { error: `${spec.label} must be at least ${spec.min}.` };
    return { error: `${spec.label} must be at most ${spec.max}.` };
  }
  return { value };
}

/** Compare the draft against the stored row; produce the delta and any blockers. */
function computeDiff(draft: Draft, settings: SystemSettings): DraftDiff {
  const patch: SystemSettingsUpdate = {};
  const errors: Record<string, string> = {};
  const changed: string[] = [];

  const text = (
    field: TextField2,
    seed: string,
    label: string,
    options: { required?: boolean; url?: boolean } = {},
  ): void => {
    const value = draft.scalars[field].trim();
    if (value === seed) return;
    if (options.required === true && value === '') {
      errors[field] = `Enter the ${label}.`;
      return;
    }
    if (options.url === true && value !== '' && !looksLikeUrl(value)) {
      errors[field] = `Enter a full URL for the ${label}, for example https://example.com/logo.png.`;
      return;
    }
    patch[field] = value;
    changed.push(field);
  };

  text('centre_name', settings.centre_name, 'centre name', { required: true });
  text('logo_url', settings.logo_url, 'logo URL', { url: true });
  text('currency_code', settings.currency_code, 'currency code', { required: true });
  text('currency_symbol', settings.currency_symbol, 'currency symbol', { required: true });
  text('timezone', settings.timezone, 'time zone', { required: true });

  const start = draft.scalars.academic_year_start;
  if (start !== (settings.academic_year_start ?? '')) {
    patch.academic_year_start = start === '' ? null : start;
    changed.push('academic_year_start');
  }
  const end = draft.scalars.academic_year_end;
  if (end !== (settings.academic_year_end ?? '')) {
    patch.academic_year_end = end === '' ? null : end;
    changed.push('academic_year_end');
  }

  for (const field of NUMERIC_FIELDS) {
    const raw = draft.scalars[field];
    if (raw.trim() === String(settings[field])) continue;
    const spec = NUMBER_SPECS[field];
    const parsed = parseNumber(raw, spec);
    if (parsed.value === undefined) {
      errors[field] = parsed.error ?? `${spec.label} is invalid.`;
      continue;
    }
    patch[field] = parsed.value;
    changed.push(field);
  }

  for (const field of LIST_FIELDS) {
    const cleaned = cleanList(draft.lists[field]);
    if (sameList(cleaned, settings[field])) continue;
    if (cleaned.length === 0) {
      errors[field] = `At least one ${LIST_LABELS[field]} is required.`;
      continue;
    }
    patch[field] = cleaned;
    changed.push(field);
  }

  const channelsChanged = CHANNEL_KEYS.some(
    (key) => (settings.notification_channels[key] === true) !== draft.channels[key],
  );
  if (channelsChanged) {
    // Spread the stored object first so a channel this build does not render
    // (the serializer's JSONField is open-ended) survives the write.
    const channels: NotificationChannels = {
      ...settings.notification_channels,
      ...draft.channels,
    };
    patch.notification_channels = channels;
    changed.push('notification_channels');
  }

  return { patch, errors, changed };
}

// --------------------------------------------------------------------------- //
// A repeatable list of names (payment methods, categories, lead sources)
// --------------------------------------------------------------------------- //

interface StringListEditorProps {
  label: string;
  hint: string;
  itemLabel: string;
  values: ReadonlyArray<string>;
  error: string[];
  disabled: boolean;
  onChange: (index: number, value: string) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
}

function StringListEditor({
  label,
  hint,
  itemLabel,
  values,
  error,
  disabled,
  onChange,
  onRemove,
  onAdd,
}: StringListEditorProps) {
  return (
    <div className="u-stack" style={{ gap: 'var(--space-2)' }}>
      <span className="data-field__label">{label}</span>
      <span className="u-subtle" style={{ fontSize: 'var(--text-sm)' }}>
        {hint}
      </span>

      {values.map((value, index) => (
        <div
          className="u-row"
          key={`${label}-${index}`}
          style={{ gap: 'var(--space-2)', alignItems: 'flex-start' }}
        >
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <TextField
              label={`${label} ${index + 1}`}
              labelHidden
              value={value}
              onChange={(next) => onChange(index, next)}
              disabled={disabled}
              error={index === 0 ? error : undefined}
              placeholder={`${itemLabel} name`}
            />
          </div>
          <Button
            size="sm"
            icon="trash"
            disabled={disabled || values.length <= 1}
            title={
              values.length <= 1
                ? `At least one ${itemLabel} is required, so the last one cannot be removed.`
                : `Remove this ${itemLabel}`
            }
            onClick={() => onRemove(index)}
          >
            Remove
          </Button>
        </div>
      ))}

      <div>
        <Button size="sm" icon="plus" disabled={disabled} onClick={onAdd}>
          Add {itemLabel}
        </Button>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Page
// --------------------------------------------------------------------------- //

export function SystemSettingsPage() {
  const { hasPerm } = useAuth();
  const canManage = hasPerm(PERMISSIONS.SETTINGS_MANAGE);
  const { settings, loaded, loading, error, refresh, update, dateTime } = useSettings();

  const [draft, setDraft] = useState<Draft>(() => toDraft(EMPTY_SETTINGS));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const seededFor = useRef<string | null>(null);

  // Re-seed the draft whenever the context row actually changes (first load, a
  // successful save, or a reload that found new values). The updated_at stamp
  // is the change key, so a refresh that returns the same row keeps edits.
  useEffect(() => {
    if (!loaded) return;
    if (seededFor.current === settings.updated_at) return;
    seededFor.current = settings.updated_at;
    setDraft(toDraft(settings));
    setSaveError(null);
    setSubmitAttempted(false);
  }, [loaded, settings]);

  const edit = useCallback((updater: (current: Draft) => Draft): void => {
    setDraft(updater);
    setNotice(null);
    setSubmitAttempted(false);
  }, []);

  const diff = useMemo(() => computeDiff(draft, settings), [draft, settings]);
  const dirty = diff.changed.length > 0;

  const setScalar = useCallback(
    (field: TextField2 | NumericField | 'academic_year_start' | 'academic_year_end', value: string): void => {
      edit((current) => ({ ...current, scalars: { ...current.scalars, [field]: value } }));
    },
    [edit],
  );

  const updateList = useCallback(
    (field: ListField, next: string[]): void => {
      edit((current) => {
        switch (field) {
          case 'payment_methods':
            return { ...current, lists: { ...current.lists, payment_methods: next } };
          case 'lead_sources':
            return { ...current, lists: { ...current.lists, lead_sources: next } };
          case 'income_categories':
            return { ...current, lists: { ...current.lists, income_categories: next } };
          case 'expense_categories':
            return { ...current, lists: { ...current.lists, expense_categories: next } };
        }
      });
    },
    [edit],
  );

  const setChannel = useCallback(
    (key: ChannelKey, value: boolean): void => {
      edit((current) => {
        const channels: Record<ChannelKey, boolean> = { ...current.channels };
        switch (key) {
          case 'internal':
            channels.internal = value;
            break;
          case 'telegram':
            channels.telegram = value;
            break;
          case 'sms':
            channels.sms = value;
            break;
          case 'email':
            channels.email = value;
            break;
        }
        return { ...current, channels };
      });
    },
    [edit],
  );

  /** Local blockers (once a save was attempted) plus whatever the server said. */
  const fieldError = useCallback(
    (field: string): string[] => {
      const messages: string[] = [];
      if (submitAttempted && diff.errors[field] !== undefined) messages.push(diff.errors[field]);
      if (saveError instanceof ApiError) messages.push(...saveError.fieldMessages(field));
      return messages;
    },
    [submitAttempted, diff, saveError],
  );

  const FIELD_NAMES: ReadonlyArray<string> = useMemo(
    () => [...NUMERIC_FIELDS, ...LIST_FIELDS, 'notification_channels', 'centre_name', 'logo_url', 'currency_code', 'currency_symbol', 'timezone', 'academic_year_start', 'academic_year_end'],
    [],
  );

  /** Everything the server said that is not tied to one field. */
  const generalMessages = useMemo<string[]>(() => {
    if (saveError === null) return [];
    if (!(saveError instanceof ApiError)) return [errorMessage(saveError)];
    const attributed = new Set<string>();
    for (const name of FIELD_NAMES) {
      for (const message of saveError.fieldMessages(name)) attributed.add(message);
    }
    return saveError.messages.filter((message) => !attributed.has(message));
  }, [saveError, FIELD_NAMES]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitAttempted(true);
    setNotice(null);
    if (!canManage) return;
    if (Object.keys(diff.errors).length > 0) return;
    if (diff.changed.length === 0) return;

    setSaving(true);
    setSaveError(null);
    try {
      // Through the context: this also refreshes the app-wide formatters.
      await update(diff.patch);
      setNotice(
        `Saved. ${diff.changed.length} ${
          diff.changed.length === 1 ? 'field was' : 'fields were'
        } updated.`,
      );
    } catch (cause) {
      // No success state on failure — the error is rendered below and inline.
      setSaveError(cause);
    } finally {
      setSaving(false);
    }
  };

  const header = (
    <header className="page-header">
      <div className="page-header__heading">
        <h1 className="page-header__title">System settings</h1>
        <p className="page-header__subtitle">
          {loaded
            ? `The stored configuration for the centre${
                settings.updated_at === '' ? '' : `, last saved ${dateTime(settings.updated_at)}`
              }.`
            : 'Loading the centre configuration…'}
        </p>
      </div>
      <div className="page-header__actions">
        {canManage ? null : <Badge tone="warning">Read-only</Badge>}
        <Button
          icon="refresh"
          loading={loaded && loading}
          disabled={!loaded}
          title={
            dirty
              ? 'Reloads the stored row. If it changed since this page opened, the reload replaces unsaved edits.'
              : 'Reload the stored row.'
          }
          onClick={() => {
            void refresh();
          }}
        >
          Reload
        </Button>
        {canManage ? (
          <Button
            variant="primary"
            type="submit"
            form={FORM_ID}
            icon="check"
            loading={saving}
            disabled={!loaded || saving || !dirty}
          >
            Save changes
          </Button>
        ) : null}
      </div>
    </header>
  );

  if (!loaded) {
    return (
      <div className="module-page">
        {header}
        <Card>
          {error !== null ? (
            <ErrorState
              error={error}
              onRetry={() => {
                void refresh();
              }}
            />
          ) : (
            <LoadingState label="Loading the centre configuration…" />
          )}
        </Card>
      </div>
    );
  }

  const academicYearInverted =
    draft.scalars.academic_year_start !== '' &&
    draft.scalars.academic_year_end !== '' &&
    draft.scalars.academic_year_start > draft.scalars.academic_year_end;

  const numberField = (field: NumericField, hint?: string): ReactNode => {
    const spec = NUMBER_SPECS[field];
    return (
      <TextField
        key={field}
        label={spec.label}
        type="number"
        inputMode="decimal"
        value={draft.scalars[field]}
        onChange={(value) => setScalar(field, value)}
        disabled={!canManage}
        min={spec.min}
        max={spec.max}
        step={spec.integer === true ? 1 : 'any'}
        hint={hint}
        error={fieldError(field)}
      />
    );
  };

  const listEditor = (field: ListField, label: string): ReactNode => (
    <StringListEditor
      key={field}
      label={label}
      itemLabel={LIST_LABELS[field]}
      hint={`At least one ${LIST_LABELS[field]} is required. Blank rows are ignored; duplicates are merged.`}
      values={draft.lists[field]}
      error={fieldError(field)}
      disabled={!canManage}
      onChange={(index, value) =>
        updateList(
          field,
          draft.lists[field].map((item, position) => (position === index ? value : item)),
        )
      }
      onRemove={(index) =>
        updateList(
          field,
          draft.lists[field].filter((_, position) => position !== index),
        )
      }
      onAdd={() => updateList(field, [...draft.lists[field], ''])}
    />
  );

  return (
    <div className="module-page">
      {header}

      {notice !== null ? (
        <div className="alert alert--success" role="status">
          <div className="alert__content">{notice}</div>
        </div>
      ) : null}

      {generalMessages.length > 0 ? (
        <div className="alert alert--error" role="alert">
          <div className="alert__content">
            {generalMessages.length === 1 ? (
              <span>{generalMessages[0]}</span>
            ) : (
              <ul className="alert__list">
                {generalMessages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {!canManage ? (
        <InlineNote tone="warning">
          Read-only: these settings can be viewed by any signed-in user, but saving them requires the{' '}
          <code>settings.manage</code> permission. The server refuses the write regardless of what this
          form does, so ask an administrator if a value needs to change.
        </InlineNote>
      ) : null}

      {loaded && error !== null ? (
        <InlineNote tone="warning">
          The last reload failed, so this form may not show the newest stored values: {errorMessage(error)}
        </InlineNote>
      ) : null}

      {submitAttempted && Object.keys(diff.errors).length > 0 ? (
        <InlineNote tone="error">
          Nothing was sent: {Object.keys(diff.errors).length}{' '}
          {Object.keys(diff.errors).length === 1 ? 'field needs' : 'fields need'} attention. The problems
          are marked next to the fields below.
        </InlineNote>
      ) : null}

      {academicYearInverted ? (
        <InlineNote tone="warning">
          The academic year ends before it starts. That is saved as entered — check the two dates if it was
          not intended.
        </InlineNote>
      ) : null}

      <form id={FORM_ID} className="u-stack" onSubmit={(event) => void submit(event)}>
        <Card
          title="Centre identity"
          subtitle="The name shown in the topbar and on documents, plus the optional logo."
        >
          <div className="form-grid">
            <TextField
              label="Centre name"
              value={draft.scalars.centre_name}
              onChange={(value) => setScalar('centre_name', value)}
              disabled={!canManage}
              error={fieldError('centre_name')}
            />
            <TextField
              label="Logo URL"
              type="url"
              value={draft.scalars.logo_url}
              onChange={(value) => setScalar('logo_url', value)}
              disabled={!canManage}
              placeholder="https://…"
              hint="Leave empty for no logo. A full URL, including the scheme."
              error={fieldError('logo_url')}
            />
          </div>
        </Card>

        <Card
          title="Currency and time zone"
          subtitle="Every amount and timestamp in the application is formatted with these values."
        >
          <div className="form-grid">
            <TextField
              label="Currency code"
              value={draft.scalars.currency_code}
              onChange={(value) => setScalar('currency_code', value)}
              disabled={!canManage}
              placeholder="UZS"
              hint="The ISO code used when a three-letter identifier is needed."
              error={fieldError('currency_code')}
            />
            <TextField
              label="Currency symbol"
              value={draft.scalars.currency_symbol}
              onChange={(value) => setScalar('currency_symbol', value)}
              disabled={!canManage}
              placeholder="so'm"
              hint="Printed in front of every amount."
              error={fieldError('currency_symbol')}
            />
            {numberField('currency_decimals', 'Digits shown after the decimal separator.')}
            <TextField
              label="Time zone"
              value={draft.scalars.timezone}
              onChange={(value) => setScalar('timezone', value)}
              disabled={!canManage}
              list="system-settings-timezones"
              placeholder="Asia/Tashkent"
              hint="An IANA time zone name. Choose a suggestion or type the exact name."
              error={fieldError('timezone')}
            />
          </div>
          <datalist id="system-settings-timezones">
            {[
              'Asia/Tashkent',
              'Asia/Almaty',
              'Asia/Bishkek',
              'Asia/Dushanbe',
              'Asia/Ashgabat',
              'Asia/Baku',
              'Asia/Tbilisi',
              'Asia/Yerevan',
              'Asia/Dubai',
              'Asia/Karachi',
              'Asia/Kolkata',
              'Asia/Istanbul',
              'Europe/Moscow',
              'Europe/Kyiv',
              'Europe/London',
              'Europe/Berlin',
              'UTC',
            ].map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        </Card>

        <Card
          title="Billing and academic year"
          subtitle="When invoices fall due, and the window the centre treats as the academic year."
        >
          <div className="form-grid">
            {numberField('default_billing_day', 'Day of the month (1–28) used as the default billing day.')}
            <DateField
              label="Academic year starts"
              value={draft.scalars.academic_year_start}
              onChange={(value) => setScalar('academic_year_start', value)}
              disabled={!canManage}
              max={draft.scalars.academic_year_end === '' ? undefined : draft.scalars.academic_year_end}
              error={fieldError('academic_year_start')}
            />
            <DateField
              label="Academic year ends"
              value={draft.scalars.academic_year_end}
              onChange={(value) => setScalar('academic_year_end', value)}
              disabled={!canManage}
              min={draft.scalars.academic_year_start === '' ? undefined : draft.scalars.academic_year_start}
              error={fieldError('academic_year_end')}
            />
          </div>
        </Card>

        <Card
          title="Thresholds and alerts"
          subtitle="The numbers the notification rules compare against. They are stored here, never hard-coded elsewhere."
        >
          <div className="form-grid">
            {numberField(
              'attendance_threshold_pct',
              'Percentage (0–100) used as the centre’s attendance threshold.',
            )}
            {numberField('absence_alert_count', 'Absences within a period that raise an alert.')}
            {numberField(
              'absence_streak_alert_count',
              'Consecutive absences that raise an alert.',
            )}
            {numberField('failing_exam_alert_count', 'Failing results that raise an alert.')}
            {numberField('default_passing_score_pct', 'Percentage (0–100) a result must reach to pass.')}
          </div>
        </Card>

        <Card
          title="Lists and categories"
          subtitle="The dropdown values used by finance, CRM and student forms. Each list needs at least one name."
        >
          <div className="u-stack" style={{ gap: 'var(--space-4)' }}>
            {listEditor('payment_methods', 'Payment methods')}
            {listEditor('lead_sources', 'Lead sources')}
            {listEditor('income_categories', 'Income categories')}
            {listEditor('expense_categories', 'Expense categories')}
          </div>
        </Card>

        <Card
          title="Notification channels"
          subtitle="Which delivery channels are switched on for this centre."
        >
          <div className="u-stack" style={{ gap: 'var(--space-3)' }}>
            {CHANNEL_FIELDS.map(({ key, label, hint }) => (
              <label className="checkbox-row" key={key}>
                <input
                  type="checkbox"
                  checked={draft.channels[key]}
                  disabled={!canManage}
                  onChange={(event) => setChannel(key, event.target.checked)}
                />
                <span className="u-stack" style={{ gap: 0 }}>
                  <span>{label}</span>
                  <span className="u-subtle" style={{ fontSize: 'var(--text-sm)' }}>
                    {hint}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {fieldError('notification_channels').length > 0 ? (
            <p className="field__error">{fieldError('notification_channels').join(' ')}</p>
          ) : null}
        </Card>
      </form>

      <Card title="Saving" subtitle="What the save button does, and what happens to the change.">
        <div className="u-stack" style={{ gap: 'var(--space-3)' }}>
          <p className="u-muted" style={{ margin: 0 }}>
            {dirty
              ? `Unsaved changes in ${diff.changed.length} ${
                  diff.changed.length === 1 ? 'field' : 'fields'
                }: ${diff.changed.join(', ')}.`
              : 'No unsaved changes — the form matches the stored row.'}
            {settings.updated_at === '' ? '' : ` Stored row last saved ${dateTime(settings.updated_at)}.`}
          </p>

          <p className="u-muted" style={{ margin: 0 }}>
            Saving sends a PATCH containing only the fields you changed, not the whole form. The server
            validates every field individually, requires <code>settings.manage</code>, and records the
            change (with the fields that moved) in the audit trail.
          </p>

          <div className="u-row" style={{ justifyContent: 'flex-end' }}>
            {canManage ? (
              <Button
                variant="primary"
                type="submit"
                form={FORM_ID}
                icon="check"
                loading={saving}
                disabled={saving || !dirty}
              >
                Save changes
              </Button>
            ) : (
              <Badge tone="warning">Read-only — settings.manage required to save</Badge>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

export default SystemSettingsPage;
