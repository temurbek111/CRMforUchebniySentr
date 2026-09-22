import { useId, type SelectHTMLAttributes } from 'react';
import { FieldShell, describedByIds } from './FieldShell';

export interface SelectOption<T extends string | number = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string | number = string>
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange' | 'id' | 'children'> {
  label?: string;
  options: ReadonlyArray<SelectOption<T>>;
  /** Current value, or '' when nothing is chosen. */
  value: T | '';
  onChange: (value: T | '') => void;
  /** Label for the empty option; omit to drop the empty option entirely. */
  placeholder?: string;
  hint?: string;
  error?: string | string[];
  required?: boolean;
  labelHidden?: boolean;
  small?: boolean;
  id?: string;
}

/**
 * Native select: keyboard accessible for free, styled with design tokens.
 * Generic over the value type so numeric ids stay numeric.
 */
export function Select<T extends string | number = string>({
  label,
  options,
  value,
  onChange,
  placeholder,
  hint,
  error,
  required = false,
  labelHidden = false,
  small = false,
  id,
  className,
  ...rest
}: SelectProps<T>) {
  const generatedId = useId();
  const selectId = id ?? `select-${generatedId}`;
  const hasError = error !== undefined && (Array.isArray(error) ? error.length > 0 : true);

  return (
    <FieldShell
      htmlFor={selectId}
      label={label}
      required={required}
      labelHidden={labelHidden}
      hint={hint}
      error={error}
      describedBy={selectId}
    >
      <select
        {...rest}
        id={selectId}
        className={['select', small ? 'select--sm' : '', className ?? ''].filter(Boolean).join(' ')}
        value={value === '' ? '' : String(value)}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === '') {
            onChange('');
            return;
          }
          const match = options.find((option) => String(option.value) === raw);
          onChange(match === undefined ? (raw as T) : match.value);
        }}
        required={required || undefined}
        aria-invalid={hasError || undefined}
        aria-describedby={describedByIds(selectId, hint, error)}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export default Select;
