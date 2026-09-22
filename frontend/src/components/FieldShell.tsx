import type { ReactNode } from 'react';

export interface FieldShellProps {
  /** The control's id; the label points at it with htmlFor. */
  htmlFor: string;
  label?: ReactNode;
  required?: boolean;
  /** Hides the label visually but keeps it for screen readers. */
  labelHidden?: boolean;
  hint?: ReactNode;
  error?: string | string[] | undefined;
  /** id of the element holding hints/errors, for aria-describedby. */
  describedBy?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Layout + labelling wrapper shared by every form control, so labels,
 * required markers, hints and error text are always wired up the same way.
 */
export function FieldShell({
  htmlFor,
  label,
  required = false,
  labelHidden = false,
  hint,
  error,
  describedBy,
  className,
  children,
}: FieldShellProps) {
  const errorList = error === undefined ? [] : Array.isArray(error) ? error : [error];

  return (
    <div className={['field', className ?? ''].filter(Boolean).join(' ')}>
      {label !== undefined ? (
        <label
          className={['field__label', labelHidden ? 'visually-hidden' : ''].filter(Boolean).join(' ')}
          htmlFor={htmlFor}
        >
          {label}
          {required ? (
            <span className="field__required" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {children}
      {hint !== undefined && errorList.length === 0 ? (
        <p className="field__hint" id={describedBy === undefined ? undefined : `${describedBy}-hint`}>
          {hint}
        </p>
      ) : null}
      {errorList.length > 0 ? (
        <p className="field__error" id={describedBy === undefined ? undefined : `${describedBy}-error`}>
          {errorList.join(' ')}
        </p>
      ) : null}
    </div>
  );
}

/** Build the aria-describedby value for a control with an optional hint/error. */
export function describedByIds(
  id: string,
  hint: ReactNode,
  error: string | string[] | undefined,
): string | undefined {
  const hasError = error !== undefined && (Array.isArray(error) ? error.length > 0 : true);
  const ids: string[] = [];
  if (hasError) ids.push(`${id}-error`);
  else if (hint !== undefined) ids.push(`${id}-hint`);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

export default FieldShell;
