import { ApiError, errorMessages } from '../types';
import { Button } from './Button';
import { Icon } from './Icon';

export interface ErrorStateProps {
  /** Anything thrown: an ApiError, an Error or a plain message. */
  error: unknown;
  title?: string;
  onRetry?: () => void;
  className?: string;
}

/**
 * Renders a failed request. Validation messages coming from the backend
 * (`{detail, errors}`) are listed individually so nothing is hidden.
 */
export function ErrorState({ error, title, onRetry, className }: ErrorStateProps) {
  const messages = errorMessages(error);
  const heading =
    title ??
    (error instanceof ApiError && error.isAuthError
      ? 'Your session has expired'
      : 'Something went wrong');

  return (
    <div className={['error-state', className ?? ''].filter(Boolean).join(' ')} role="alert">
      <span className="empty-state__icon" aria-hidden="true">
        <Icon name="alert" size={20} />
      </span>
      <p className="empty-state__title">{heading}</p>
      <div className="alert alert--error" style={{ textAlign: 'left' }}>
        <span className="alert__icon" aria-hidden="true">
          <Icon name="alertCircle" size={16} />
        </span>
        <div className="alert__content">
          {messages.length === 1 ? (
            <span>{messages[0]}</span>
          ) : (
            <ul className="alert__list">
              {messages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {onRetry !== undefined ? (
        <div className="empty-state__action">
          <Button icon="refresh" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export default ErrorState;
