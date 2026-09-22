import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from './Icon';

export interface SearchInputProps {
  value: string;
  /** Called after `debounceMs` of inactivity (and immediately on Enter/clear). */
  onChange: (value: string) => void;
  placeholder?: string;
  /** Accessible label; hidden visually. Defaults to 'Search'. */
  label?: string;
  debounceMs?: number;
  small?: boolean;
  autoFocus?: boolean;
  className?: string;
  id?: string;
  /** Renders a clear (x) button when there is text. */
  clearable?: boolean;
}

/**
 * Debounced search box. Keeps its own draft state so typing stays responsive
 * while the parent only re-queries once the user pauses.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search',
  label = 'Search',
  debounceMs = 250,
  small = false,
  autoFocus = false,
  className,
  id,
  clearable = true,
}: SearchInputProps) {
  const generatedId = useId();
  const inputId = id ?? `search-${generatedId}`;
  const [draft, setDraft] = useState(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Keep in sync when the parent resets or replaces the value externally.
  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (draft === value) return undefined;
    if (debounceMs <= 0) {
      onChangeRef.current(draft);
      return undefined;
    }
    const timer = window.setTimeout(() => onChangeRef.current(draft), debounceMs);
    return () => window.clearTimeout(timer);
  }, [draft, value, debounceMs]);

  const flush = (next: string): void => {
    setDraft(next);
    onChangeRef.current(next);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      flush(draft);
    }
    if (event.key === 'Escape' && draft !== '') {
      flush('');
    }
  };

  return (
    <div className={['search-input', className ?? ''].filter(Boolean).join(' ')}>
      <span className="search-input__icon" aria-hidden="true">
        <Icon name="search" size={15} />
      </span>
      <input
        id={inputId}
        className={['input', small ? 'input--sm' : ''].filter(Boolean).join(' ')}
        type="search"
        role="searchbox"
        value={draft}
        placeholder={placeholder}
        aria-label={label}
        autoFocus={autoFocus}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {clearable && draft !== '' ? (
        <button
          type="button"
          className="search-input__clear"
          aria-label="Clear search"
          onClick={() => flush('')}
        >
          <Icon name="close" size={13} />
        </button>
      ) : null}
    </div>
  );
}

export default SearchInput;
