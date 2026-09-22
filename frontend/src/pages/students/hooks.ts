/**
 * Data-loading hooks shared by every Students/Groups page.
 *
 * The shell has no query library, so each screen owns a tiny resource hook
 * that gives it the three states the brief demands: loading, error (with a
 * retry) and the resolved payload. Requests are cancelled on unmount and on
 * every dependency change, so a fast filter change can never render a stale
 * response.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../types';
import { loadReferenceData, type ReferenceData } from './api';

export interface AsyncResource<T> {
  data: T | null;
  loading: boolean;
  error: unknown;
  /** Re-runs the loader; used by every "Try again" button. */
  reload: () => void;
  /** Local mutation after a successful write, so no refetch is needed. */
  setData: (value: T | null) => void;
}

/**
 * Run `loader` whenever `key` changes (or `reload()` is called).
 *
 * Late responses from a superseded key are discarded, so flipping filters fast
 * can never paint a stale page.
 *
 * @param key a stable string describing the current query.
 */
export function useAsyncResource<T>(
  loader: () => Promise<T>,
  key: string,
): AsyncResource<T> {
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError(null);
    setData(null);

    loaderRef
      .current()
      .then((value) => {
        if (active) setData(value);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(cause);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [key, nonce]);

  const reload = useCallback(() => setNonce((current) => current + 1), []);

  return { data, loading, error, reload, setData };
}

/**
 * Courses / rooms / teachers for filter dropdowns and pickers.
 *
 * Unlike a page resource this one never fails loudly: the underlying loader
 * swallows permission errors per collection, because a user may legitimately
 * see students without seeing the course catalogue.
 */
export function useReferenceData(): AsyncResource<ReferenceData> {
  return useAsyncResource(loadReferenceData, 'reference');
}

/** Message list from any thrown value, for inline alert rendering. */
export function apiErrorMessages(error: unknown): string[] {
  if (error instanceof ApiError) return error.messages;
  if (error instanceof Error) return [error.message];
  if (typeof error === 'string') return [error];
  return [];
}

/**
 * Field-level messages from a DRF validation error: `errors[field]`.
 * Returns an empty array when the failure is not a field error.
 */
export function fieldErrors(error: unknown): Record<string, string[]> {
  if (error instanceof ApiError) return error.errors;
  return {};
}

/** The messages for one field, or undefined - ready for `<Select error>`. */
export function fieldError(error: unknown, field: string): string[] | undefined {
  const messages = fieldErrors(error)[field];
  return messages !== undefined && messages.length > 0 ? messages : undefined;
}

/**
 * Non-field messages only (`non_field_errors` plus the top-level `detail`),
 * for the alert at the top of a form. Field messages are rendered inline.
 */
export function generalErrorMessages(error: unknown): string[] {
  if (error === null || error === undefined) return [];
  const messages: string[] = [];
  const all = fieldErrors(error);
  if (Object.keys(all).length === 0) return apiErrorMessages(error);
  for (const message of all.non_field_errors ?? []) {
    if (!messages.includes(message)) messages.push(message);
  }
  if (messages.length === 0 && error instanceof ApiError) {
    messages.push(error.detail);
  }
  return messages;
}
