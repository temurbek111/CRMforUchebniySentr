import type { ReactNode } from 'react';
import { Icon } from './Icon';

export type StatDeltaDirection = 'up' | 'down' | 'flat';

export interface StatDelta {
  /** Pre-formatted change, e.g. "+12%" or "3 new". */
  value: string | number;
  direction?: StatDeltaDirection;
}

export interface StatCardProps {
  label: string;
  /** Pre-formatted by the caller (use the settings aware formatters). */
  value: ReactNode;
  delta?: StatDelta;
  /** Secondary line under the value, e.g. "vs last month". */
  hint?: ReactNode;
  /** Icon name from components/Icon.tsx. */
  icon?: string;
  className?: string;
  footer?: ReactNode;
  loading?: boolean;
}

/**
 * KPI tile. Purely presentational: every number comes from real API data
 * supplied by the calling page.
 */
export function StatCard({
  label,
  value,
  delta,
  hint,
  icon,
  className,
  footer,
  loading = false,
}: StatCardProps) {
  const direction: StatDeltaDirection = delta?.direction ?? 'flat';

  return (
    <article className={['kpi', className ?? ''].filter(Boolean).join(' ')}>
      <div className="kpi__top">
        <span className="kpi__label">{label}</span>
        {icon !== undefined ? (
          <span className="kpi__icon" aria-hidden="true">
            <Icon name={icon} size={16} />
          </span>
        ) : null}
      </div>

      {loading ? (
        <span className="skeleton skeleton--block" style={{ height: 30, width: '60%' }} />
      ) : (
        <div className="kpi__value">{value}</div>
      )}

      {delta !== undefined || hint !== undefined ? (
        <div className="kpi__meta">
          {delta !== undefined ? (
            <span className={`kpi__delta kpi__delta--${direction}`}>
              {direction === 'up' ? '▲ ' : null}
              {direction === 'down' ? '▼ ' : null}
              {delta.value}
            </span>
          ) : null}
          {hint !== undefined ? <span>{hint}</span> : null}
        </div>
      ) : null}

      {footer !== undefined ? <div className="kpi__meta">{footer}</div> : null}
    </article>
  );
}

export default StatCard;
