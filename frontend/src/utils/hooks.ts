/**
 * Small shared hooks used by the shell (and useful to module pages).
 */

import { useCallback, useEffect, useState, type RefObject } from 'react';

/**
 * Call `handler` when a pointer press lands outside `ref`.
 * Used to dismiss the topbar dropdown menus.
 */
export function useOutsideClick(
  ref: RefObject<HTMLElement | null>,
  handler: () => void,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const listener = (event: MouseEvent): void => {
      const element = ref.current;
      if (element === null) return;
      if (event.target instanceof Node && !element.contains(event.target)) handler();
    };
    document.addEventListener('mousedown', listener);
    return () => document.removeEventListener('mousedown', listener);
  }, [ref, handler, enabled]);
}

/** Call `handler` when Escape is pressed. */
export function useEscapeKey(handler: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const listener = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') handler();
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [handler, enabled]);
}

/**
 * State mirrored into localStorage (sidebar collapse, table density, ...).
 * Storage failures (private mode, quota) degrade to in-memory state.
 */
export function useLocalStorageState<T>(
  key: string,
  initialValue: T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return initialValue;
      return JSON.parse(raw) as T;
    } catch {
      return initialValue;
    }
  });

  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Ignore: the UI keeps working with in-memory state.
      }
    },
    [key],
  );

  return [value, set];
}
