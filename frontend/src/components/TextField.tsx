import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { FieldShell, describedByIds } from './FieldShell';

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'id'> {
  label?: string;
  value: string;
  /** Receives the raw string value (numbers are converted by the caller). */
  onChange: (value: string) => void;
  hint?: string;
  /** Single message or the API's `errors[field]` array. */
  error?: string | string[];
  required?: boolean;
  labelHidden?: boolean;
  /** Small control variant, used inside table toolbars and filters. */
  small?: boolean;
  id?: string;
}

/** Single-line text input with a real <label> and inline validation. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  {
    label,
    value,
    onChange,
    hint,
    error,
    required = false,
    labelHidden = false,
    small = false,
    id,
    className,
    type = 'text',
    ...rest
  },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? `text-${generatedId}`;
  const hasError = error !== undefined && (Array.isArray(error) ? error.length > 0 : true);

  return (
    <FieldShell
      htmlFor={inputId}
      label={label}
      required={required}
      labelHidden={labelHidden}
      hint={hint}
      error={error}
      describedBy={inputId}
    >
      <input
        {...rest}
        ref={ref}
        id={inputId}
        type={type}
        className={['input', small ? 'input--sm' : '', className ?? ''].filter(Boolean).join(' ')}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required || undefined}
        aria-invalid={hasError || undefined}
        aria-describedby={describedByIds(inputId, hint, error)}
      />
    </FieldShell>
  );
});

export default TextField;
