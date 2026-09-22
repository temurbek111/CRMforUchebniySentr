/**
 * Display helpers for the exams module.
 *
 * Only presentation lives here: the trend, grade and severity *values* are
 * always the server's, this file just maps them onto words and badge tones.
 */

import type { BadgeTone } from '../../components';
import { humanise } from '../../utils/format';

/** Server display string when present, otherwise a readable form of the code. */
export function examTypeLabel(value: string, display?: string): string {
  if (display !== undefined && display.trim() !== '') return display;
  return humanise(value);
}

/** Student/group momentum from exams.services._trend(). */
export function trendLabel(trend: string | null | undefined): string {
  switch (trend) {
    case 'improving':
      return 'Improving';
    case 'declining':
      return 'Declining';
    case 'stable':
      return 'Stable';
    case 'insufficient_data':
      return 'Not enough data';
    default:
      return 'Unknown';
  }
}

export function trendTone(trend: string | null | undefined): BadgeTone {
  switch (trend) {
    case 'improving':
      return 'success';
    case 'declining':
      return 'danger';
    case 'stable':
      return 'info';
    default:
      return 'neutral';
  }
}

export function trendIcon(trend: string | null | undefined): string {
  switch (trend) {
    case 'improving':
      return 'arrowUp';
    case 'declining':
      return 'arrowDown';
    case 'stable':
      return 'check';
    default:
      return 'dot';
  }
}

/** Letter grades come from exams.services.GRADE_THRESHOLDS. */
export function gradeTone(grade: string | null | undefined): BadgeTone {
  switch ((grade ?? '').toUpperCase()) {
    case 'A':
    case 'B':
      return 'success';
    case 'C':
      return 'info';
    case 'D':
      return 'warning';
    case 'F':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** At-risk severity from reporting.services.at_risk_students(). */
export function severityTone(severity: string): BadgeTone {
  switch (severity) {
    case 'critical':
      return 'danger';
    case 'warning':
      return 'warning';
    case 'info':
      return 'info';
    default:
      return 'neutral';
  }
}
