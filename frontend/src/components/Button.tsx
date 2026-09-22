import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks interaction; implies `aria-busy`. */
  loading?: boolean;
  /** Full-width button. */
  block?: boolean;
  /** Icon name (see components/Icon.tsx) rendered before the label. */
  icon?: string;
  iconAfter?: string;
  type?: 'button' | 'submit' | 'reset';
  children?: ReactNode;
}

/**
 * The single button primitive for the app. Always renders a real <button> so
 * keyboard and screen-reader behaviour stays native.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    block = false,
    icon,
    iconAfter,
    type = 'button',
    className,
    disabled,
    children,
    ...rest
  },
  ref,
) {
  const classes = [
    'btn',
    `btn--${variant}`,
    size !== 'md' ? `btn--${size}` : '',
    block ? 'btn--block' : '',
    className ?? '',
  ]
    .filter((part) => part !== '')
    .join(' ');

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <span className="btn__spinner" aria-hidden="true" /> : null}
      {!loading && icon !== undefined ? <Icon name={icon} size={15} /> : null}
      {children}
      {!loading && iconAfter !== undefined ? <Icon name={iconAfter} size={15} /> : null}
    </button>
  );
});

export default Button;
