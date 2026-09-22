/**
 * Typed fetch wrapper for the Learning Centre CRM API.
 *
 * The backend authenticates with Django *sessions* (REST_FRAMEWORK ->
 * SessionAuthentication) and validates CSRF on every unsafe method, so:
 *
 *   - requests are always relative paths ("/api/..."), never absolute URLs;
 *   - `credentials: 'include'` keeps the sessionid cookie flowing;
 *   - the `csrftoken` cookie value is echoed in the `X-CSRFToken` header;
 *   - the Vite dev server proxies /api to Django so it all stays same-origin.
 *
 * Every failure is normalised into an `ApiError` carrying the backend's
 * uniform error body: `{detail, errors: {field: [messages]}}`.
 */

import {
  ApiError,
  type ApiErrorBody,
  type FieldErrors,
  type Paginated,
  type QueryParams,
  type QueryParamValue,
} from '../types';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Methods that carry no CSRF token (RFC 7231 "safe" methods). */
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

const CSRF_COOKIE_NAME = 'csrftoken';
const CSRF_HEADER_NAME = 'X-CSRFToken';
const CSRF_ENDPOINT = '/api/auth/csrf';

export interface RequestOptions {
  method?: HttpMethod;
  /** Serialised as JSON unless it is a FormData instance. */
  body?: unknown;
  params?: QueryParams;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/** Read a cookie by name from `document.cookie`. */
export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const target = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const entry = part.trim();
    if (entry.startsWith(target)) {
      return decodeURIComponent(entry.slice(target.length));
    }
  }
  return null;
}

/** Current CSRF token from the `csrftoken` cookie, or null before bootstrap. */
export function csrfToken(): string | null {
  return readCookie(CSRF_COOKIE_NAME);
}

/** Drop QueryParams entries that are empty, null or undefined. */
function normaliseParamValue(value: QueryParamValue): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const text = String(value).trim();
  return text === '' ? null : text;
}

/**
 * Build a query string from a params object, dropping empty values.
 * Arrays become repeated parameters (`?status=a&status=b`).
 * Returns '' when nothing survives - callers append it directly to the path.
 */
export function buildQueryString(params?: QueryParams): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, raw] of Object.entries(params)) {
    const values: QueryParamValue[] = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      const normalised = normaliseParamValue(value);
      if (normalised !== null) search.append(key, normalised);
    }
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

/** Append a query string to a path, preserving any query already present. */
export function withQuery(path: string, params?: QueryParams): string {
  const suffix = buildQueryString(params);
  if (!suffix) return path;
  return path.includes('?') ? `${path}&${suffix.slice(1)}` : `${path}${suffix}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normaliseFieldErrors(raw: unknown): FieldErrors {
  if (!isRecord(raw)) return {};
  const out: FieldErrors = {};
  for (const [field, value] of Object.entries(raw)) {
    if (Array.isArray(value)) {
      out[field] = value.map((item) => String(item));
    } else if (value === null || value === undefined) {
      out[field] = [];
    } else if (typeof value === 'object') {
      out[field] = Object.values(value as Record<string, unknown>).map((item) => String(item));
    } else {
      out[field] = [String(value)];
    }
  }
  return out;
}

function statusTextError(status: number, statusText: string): string {
  const reason = statusText.trim();
  return reason ? `Request failed (${status} ${reason}).` : `Request failed (${status}).`;
}

/** Normalise any failed response into an ApiError. */
function toApiError(status: number, statusText: string, payload: unknown): ApiError {
  if (isRecord(payload)) {
    const detailRaw = payload.detail;
    const detail = typeof detailRaw === 'string' && detailRaw.trim() !== ''
      ? detailRaw
      : statusTextError(status, statusText);
    return new ApiError(status, detail, normaliseFieldErrors(payload.errors));
  }
  if (typeof payload === 'string' && payload.trim() !== '') {
    return new ApiError(status, payload.trim());
  }
  return new ApiError(status, statusTextError(status, statusText));
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

let csrfBootstrap: Promise<void> | null = null;

/**
 * Make sure a CSRF cookie exists before the first unsafe request.
 *
 * GET /api/auth/csrf is unauthenticated and sets the cookie as a side effect,
 * so it also works on a cold browser profile.
 */
export async function ensureCsrfToken(): Promise<void> {
  if (csrfToken() !== null) return;
  if (csrfBootstrap === null) {
    csrfBootstrap = (async () => {
      try {
        const response = await fetch(CSRF_ENDPOINT, {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) return;
        const payload = await readPayload(response);
        // Some deployments only return the token in the body; mirror it into a
        // header-friendly value by re-reading the cookie the response set.
        if (csrfToken() === null && isRecord(payload) && typeof payload.csrfToken === 'string') {
          document.cookie = `${CSRF_COOKIE_NAME}=${encodeURIComponent(payload.csrfToken)}; path=/; SameSite=Lax`;
        }
      } catch {
        // A missing CSRF cookie is not fatal here: the real request will fail
        // with a normal ApiError and the caller can surface it.
      } finally {
        csrfBootstrap = null;
      }
    })();
  }
  await csrfBootstrap;
}

function isCsrfFailure(error: ApiError): boolean {
  if (error.status !== 403) return false;
  return /csrf/i.test(error.detail);
}

/**
 * Window event fired when the server says the caller is not signed in.
 * DRF answers that with 401, or 403 when it has no WWW-Authenticate header
 * (which is the case for session authentication). The auth context listens for
 * this so an expired session clears the UI once instead of every page
 * handling it separately.
 */
export const AUTH_REQUIRED_EVENT = 'lcrm:auth-required';

function notifyAuthRequired(error: ApiError): void {
  if (typeof window === 'undefined') return;
  const notSignedIn =
    error.status === 401 ||
    (error.status === 403 && /not authenticated|authentication credentials/i.test(error.detail));
  if (notSignedIn) {
    window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT, { detail: { status: error.status } }));
  }
}

async function perform<T>(path: string, options: RequestOptions): Promise<T> {
  const method: HttpMethod = options.method ?? 'GET';
  const url = withQuery(path, options.params);

  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };

  let body: BodyInit | undefined;
  if (options.body !== undefined && method !== 'GET') {
    if (options.body instanceof FormData) {
      // Let the browser set the multipart boundary.
      body = options.body;
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
  }

  if (!SAFE_METHODS.has(method)) {
    await ensureCsrfToken();
    const token = csrfToken();
    if (token) headers[CSRF_HEADER_NAME] = token;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      credentials: 'include',
      signal: options.signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw cause;
    }
    throw new ApiError(
      0,
      'Unable to reach the server. Check your connection and try again.',
    );
  }

  if (response.status === 204 || response.status === 205) {
    return undefined as unknown as T;
  }

  const payload = await readPayload(response);

  if (!response.ok) {
    throw toApiError(response.status, response.statusText, payload);
  }

  if (payload === undefined) {
    return undefined as unknown as T;
  }

  return payload as T;
}

/**
 * Perform an API request and decode the JSON envelope.
 *
 * @throws {ApiError} for every non-2xx response and for network failures.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await perform<T>(path, options);
  } catch (error) {
    // The session cookie can outlive the CSRF cookie (for example after a
    // server restart). Refresh the token once and replay the request.
    if (error instanceof ApiError && isCsrfFailure(error)) {
      await ensureCsrfToken();
      if (csrfToken() !== null) {
        try {
          return await perform<T>(path, options);
        } catch (retryError) {
          if (retryError instanceof ApiError) notifyAuthRequired(retryError);
          throw retryError;
        }
      }
    }
    if (error instanceof ApiError) notifyAuthRequired(error);
    throw error;
  }
}

type ReadOptions = Omit<RequestOptions, 'method' | 'body'>;
type WriteOptions = Omit<RequestOptions, 'method' | 'body'>;

/** Verb helpers; all paths are relative to the SPA origin. */
export const api = {
  get: <T>(path: string, options: ReadOptions = {}): Promise<T> =>
    request<T>(path, { ...options, method: 'GET' }),

  post: <T>(path: string, body?: unknown, options: WriteOptions = {}): Promise<T> =>
    request<T>(path, { ...options, method: 'POST', body }),

  put: <T>(path: string, body?: unknown, options: WriteOptions = {}): Promise<T> =>
    request<T>(path, { ...options, method: 'PUT', body }),

  patch: <T>(path: string, body?: unknown, options: WriteOptions = {}): Promise<T> =>
    request<T>(path, { ...options, method: 'PATCH', body }),

  delete: <T>(path: string, options: WriteOptions = {}): Promise<T> =>
    request<T>(path, { ...options, method: 'DELETE' }),
};

/** Fetch one page of a DRF list endpoint. */
export function fetchList<T>(path: string, params?: QueryParams): Promise<Paginated<T>> {
  return api.get<Paginated<T>>(path, { params });
}

/** Re-exported so callers only need one import for error handling. */
export type { ApiErrorBody, FieldErrors };
