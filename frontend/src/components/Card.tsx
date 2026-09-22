import type { ReactNode } from 'react';

export interface CardProps {
  /** Optional header title. */
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Buttons or links rendered on the right of the header. */
  actions?: ReactNode;
  footer?: ReactNode;
  /** Renders the body without padding (for tables that bleed to the edges). */
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

/**
 * Surface container with an optional title bar. Modules use it for filters,
 * tables, forms and chart panels so spacing stays consistent across the app.
 */
export function Card({
  title,
  subtitle,
  actions,
  footer,
  flush = false,
  className,
  bodyClassName,
  children,
}: CardProps) {
  const hasHeader = title !== undefined || subtitle !== undefined || actions !== undefined;

  return (
    <section className={['card', className ?? ''].filter(Boolean).join(' ')}>
      {hasHeader ? (
        <header className="card__header">
          <div className="card__heading">
            {title !== undefined ? <h2 className="card__title">{title}</h2> : null}
            {subtitle !== undefined ? <p className="card__subtitle">{subtitle}</p> : null}
          </div>
          {actions !== undefined ? <div className="card__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div
        className={['card__body', flush ? 'card__body--flush' : '', bodyClassName ?? '']
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </div>
      {footer !== undefined ? <footer className="card__footer">{footer}</footer> : null}
    </section>
  );
}

export default Card;
