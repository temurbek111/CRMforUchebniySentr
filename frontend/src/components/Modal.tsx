import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ModalProps {
  open: boolean;
  /** Called on Escape, backdrop click and the close button. */
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  size?: ModalSize;
  /** Usually a set of <Button>s. */
  footer?: ReactNode;
  children: ReactNode;
  /** Set false for destructive flows that must be dismissed explicitly. */
  closeOnBackdrop?: boolean;
  /** Hides the header close button (rarely useful). */
  hideClose?: boolean;
  /** Extra class on the dialog element. */
  className?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible dialog: portalled to <body>, Escape to dismiss, focus moved into
 * the dialog on open and restored on close, background scroll locked.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  size = 'md',
  footer,
  children,
  closeOnBackdrop = true,
  hideClose = false,
  className,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const generatedId = useId();
  const titleId = `modal-title-${generatedId}`;
  const subtitleId = `modal-subtitle-${generatedId}`;

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        handleClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (dialog === null) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null,
      );
      if (focusable.length === 0) return;
      const first: HTMLElement | undefined = focusable[0];
      const last: HTMLElement | undefined = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTarget = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    focusTarget?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus();
    };
  }, [open, handleClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) handleClose();
      }}
    >
      <div
        className={['modal', size !== 'md' ? `modal--${size}` : '', className ?? '']
          .filter(Boolean)
          .join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle !== undefined ? subtitleId : undefined}
        ref={dialogRef}
      >
        <header className="modal__header">
          <div>
            <h2 className="modal__title" id={titleId}>
              {title}
            </h2>
            {subtitle !== undefined ? (
              <p className="modal__subtitle" id={subtitleId}>
                {subtitle}
              </p>
            ) : null}
          </div>
          {!hideClose ? (
            <button type="button" className="modal__close" onClick={handleClose} aria-label="Close dialog">
              <Icon name="close" size={16} />
            </button>
          ) : null}
        </header>

        <div className="modal__body">{children}</div>

        {footer !== undefined ? <footer className="modal__footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

export default Modal;
