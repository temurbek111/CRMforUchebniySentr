import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { FieldShell, describedByIds } from './FieldShell';

export interface DateFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'id' | 'type'> {
  label?: string;
  /** ISO date string `yyyy-mm-dd`, or '' for an empty field. */
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  hint?: string;
  error?: string | string[];
  required?: boolean;
  labelHidden?: boolean;
  small?: boolean;
  id?: string;
}

/** Native date picker; the value is always an ISO `yyyy-mm-dd` string. */
export const DateField = forwardRef<HTMLInputElement, DateFieldProps>(function DateField(
  {
    label,
    value,
    onChange,
    min,
    max,
    hint,
    error,
    required = false,
    labelHidden = false,
    small = false,
    id,
    className,
    ...rest
  },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? `date-${generatedId}`;
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
        type="date"
        className={['input', small ? 'input--sm' : '', className ?? ''].filter(Boolean).join(' ')}
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
        required={required || undefined}
        aria-invalid={hasError || undefined}
        aria-describedby={describedByIds(inputId, hint, error)}
      />
    </FieldShell>
  );
});

export default DateField;
