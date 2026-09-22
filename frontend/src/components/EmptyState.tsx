import type { ReactNode } from 'react';
import { Icon } from './Icon';

export interface EmptyStateProps {
  title: string;
  message?: ReactNode;
  /** Icon name from components/Icon.tsx. */
  icon?: string;
  /** Usually a <Button>. */
  action?: ReactNode;
  className?: string;
}

/** Shown when a list or panel legitimately has no rows. */
export function EmptyState({
  title,
  message,
  icon = 'inbox',
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={['empty-state', className ?? ''].filter(Boolean).join(' ')} role="status">
      <span className="empty-state__icon" aria-hidden="true">
        <Icon name={icon} size={20} />
      </span>
      <p className="empty-state__title">{title}</p>
      {message !== undefined ? <p className="empty-state__message">{message}</p> : null}
      {action !== undefined ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}

export default EmptyState;
