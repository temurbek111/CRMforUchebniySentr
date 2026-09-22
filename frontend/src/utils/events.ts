/**
 * Small cross-component event bus built on CustomEvents.
 *
 * The shell and the module pages are separate components, so the global search
 * box announces what the user typed instead of every page having to be wired
 * into a shared store. Module pages subscribe with `useGlobalSearch`.
 */

import { useEffect } from 'react';

/** Fired by the topbar search box when the user submits a query. */
export const GLOBAL_SEARCH_EVENT = 'lcrm:global-search';

export interface GlobalSearchDetail {
  query: string;
}

/** Announce a global search query. */
export function dispatchGlobalSearch(query: string): void {
  const trimmed = query.trim();
  if (trimmed === '') return;
  window.dispatchEvent(
    new CustomEvent<GlobalSearchDetail>(GLOBAL_SEARCH_EVENT, { detail: { query: trimmed } }),
  );
}

/**
 * Subscribe a page to global search queries.
 * The handler is called with the trimmed query string.
 */
export function useGlobalSearch(handler: (query: string) => void): void {
  useEffect(() => {
    const listener = (event: Event): void => {
      const detail = (event as CustomEvent<GlobalSearchDetail>).detail;
      if (detail === undefined) return;
      handler(detail.query);
    };
    window.addEventListener(GLOBAL_SEARCH_EVENT, listener);
    return () => window.removeEventListener(GLOBAL_SEARCH_EVENT, listener);
  }, [handler]);
}
