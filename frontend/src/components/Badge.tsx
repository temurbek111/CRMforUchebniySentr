import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps {
  tone?: BadgeTone;
  /** Prefixes a small status dot in the current colour. */
  dot?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}

/** Small status pill. Colour is reserved for state, never decoration. */
export function Badge({ tone = 'neutral', dot = false, title, className, children }: BadgeProps) {
  const classes = [
    'badge',
    tone !== 'neutral' ? `badge--${tone}` : '',
    dot ? 'badge--dot' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes} title={title}>
      {children}
    </span>
  );
}

/**
 * Map a backend status string onto a badge tone so every module renders the
 * same word in the same colour (active/paid = success, overdue = danger, ...).
 */
const STATUS_TONES: Record<string, BadgeTone> = {
  active: 'success',
  paid: 'success',
  present: 'success',
  approved: 'success',
  completed: 'success',
  passed: 'success',
  enrolled: 'success',

  pending: 'warning',
  partial: 'warning',
  late: 'warning',
  paused: 'warning',
  trial: 'warning',
  draft: 'warning',
  'in progress': 'warning',
  'on hold': 'warning',

  overdue: 'danger',
  cancelled: 'danger',
  canceled: 'danger',
  failed: 'danger',
  absent: 'danger',
  rejected: 'danger',
  void: 'danger',
  inactive: 'danger',
  expelled: 'danger',

  excused: 'info',
  scheduled: 'info',
  planned: 'info',
  new: 'info',
  lead: 'info',

  archived: 'neutral',
  closed: 'neutral',
  graduated: 'neutral',
  upcoming: 'primary',
};

export function toneForStatus(status: string | null | undefined): BadgeTone {
  if (!status) return 'neutral';
  return STATUS_TONES[status.trim().toLowerCase()] ?? 'neutral';
}

/** Convenience wrapper: `<StatusBadge status="overdue" />`. */
export function StatusBadge({ status }: { status: string | null | undefined }) {
  const label = (status ?? '').trim();
  if (label === '') return <span className="u-subtle">{'\u2014'}</span>;
  return (
    <Badge tone={toneForStatus(label)} dot>
      {label.replace(/_/g, ' ')}
    </Badge>
  );
}

/** Notification severity -> badge tone (core.Notification.Severity). */
export function toneForSeverity(severity: string): BadgeTone {
  if (severity === 'critical') return 'danger';
  if (severity === 'warning') return 'warning';
  if (severity === 'info') return 'info';
  return 'neutral';
}

export default Badge;
