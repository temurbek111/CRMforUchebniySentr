import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { TextField } from '../../components/TextField';
import { Icon } from '../../components/Icon';
import { fieldErrorsOf, messageLines, useMutation } from './shared';

export interface ReasonDialogProps {
  open: boolean;
  title: string;
  /** Explains exactly what will happen; shown above the reason field. */
  message: ReactNode;
  confirmLabel: string;
  reasonLabel?: string;
  placeholder?: string;
  onCancel: () => void;
  /** Called with the trimmed reason; the dialog closes only on success. */
  onConfirm: (reason: string) => Promise<void>;
}

/**
 * Confirmation prompt for the irreversible money actions this app has
 * (voiding a payment/income/expense, waiving or cancelling an invoice).
 *
 * The backend refuses any of these without a reason, so the reason field is
 * mandatory and the server's validation messages are shown inline.
 */
export function ReasonDialog({
  open,
  title,
  message,
  confirmLabel,
  reasonLabel = 'Reason',
  placeholder = 'Why is this being reversed?',
  onCancel,
  onConfirm,
}: ReasonDialogProps) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const { busy, error, reset, run } = useMutation();

  // Every opening starts from a clean slate - never resubmit a stale reason.
  useEffect(() => {
    if (!open) return;
    setReason('');
    setTouched(false);
    reset();
  }, [open, reset]);

  const reasonErrors = fieldErrorsOf(error);
  const emptyError = touched && reason.trim() === '' ? 'A reason is required.' : undefined;
  const generalErrors = messageLines(error).filter((line) => !reasonErrors.reason?.includes(line));

  const submit = async (): Promise<void> => {
    setTouched(true);
    if (reason.trim() === '') return;
    await run(async () => {
      await onConfirm(reason.trim());
      onCancel();
    });
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onCancel}
      title={title}
      size="sm"
      closeOnBackdrop={!busy}
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={() => {
              void submit();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="u-stack">
        {generalErrors.length > 0 ? (
          <div className="alert alert--error" role="alert">
            <span className="alert__icon" aria-hidden="true">
              <Icon name="alertCircle" size={16} />
            </span>
            <div className="alert__content">
              {generalErrors.length === 1 ? (
                <span>{generalErrors[0]}</span>
              ) : (
                <ul className="alert__list">
                  {generalErrors.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}

        <div>{message}</div>

        <TextField
          label={reasonLabel}
          value={reason}
          onChange={setReason}
          placeholder={placeholder}
          required
          error={emptyError ?? reasonErrors.reason}
          hint="Stored on the record for the audit trail."
        />
      </div>
    </Modal>
  );
}

export default ReasonDialog;
