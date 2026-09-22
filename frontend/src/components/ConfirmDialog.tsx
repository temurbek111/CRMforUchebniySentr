import { useState, type ReactNode } from 'react';
import { errorMessages } from '../types';
import { Button } from './Button';
import { Modal } from './Modal';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' for destructive actions, 'primary' for safe ones. */
  tone?: 'danger' | 'primary';
  /** Runs on confirm; the dialog stays open and shows the error if it throws. */
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Confirmation prompt for destructive or irreversible actions. Any error from
 * `onConfirm` is displayed inline (using the API error body) instead of
 * closing the dialog and losing context.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string[]>([]);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    setError([]);
    try {
      await onConfirm();
    } catch (cause) {
      setError(errorMessages(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      closeOnBackdrop={!busy}
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={busy}
            onClick={() => {
              void confirm();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="u-stack">
        {error.length > 0 ? (
          <div className="alert alert--error" role="alert">
            <div className="alert__content">
              {error.length === 1 ? (
                <span>{error[0]}</span>
              ) : (
                <ul className="alert__list">
                  {error.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
        <div>{message}</div>
      </div>
    </Modal>
  );
}

export default ConfirmDialog;
