export interface LoadingStateProps {
  label?: string;
  /** 'spinner' (default) or 'skeleton' table placeholder. */
  variant?: 'spinner' | 'skeleton';
  /** Skeleton rows to draw when variant is 'skeleton'. */
  rows?: number;
  /** Lays the spinner out on one line, for toolbars. */
  inline?: boolean;
  className?: string;
}

/** Consistent busy indicator. Always announces itself politely. */
export function LoadingState({
  label = 'Loading…',
  variant = 'spinner',
  rows = 6,
  inline = false,
  className,
}: LoadingStateProps) {
  if (variant === 'skeleton') {
    return (
      <div
        className={['skeleton-table', className ?? ''].filter(Boolean).join(' ')}
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <span className="visually-hidden">{label}</span>
        {Array.from({ length: rows }, (_, index) => (
          <div className="skeleton-row" key={index}>
            <span className="skeleton skeleton--line" />
            <span className="skeleton skeleton--line" />
            <span className="skeleton skeleton--line" />
            <span className="skeleton skeleton--line" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      className={['loading-state', inline ? 'loading-state--inline' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className={inline ? 'spinner' : 'spinner spinner--lg'} />
      <span>{label}</span>
    </div>
  );
}

export default LoadingState;
