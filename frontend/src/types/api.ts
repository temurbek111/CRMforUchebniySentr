/**
 * Shared transport-level types.
 *
 * The API always answers errors with the same shape (apps/core/exceptions.py):
 *
 *   {"detail": "Human readable message", "errors": {"field": ["...", "..."]}}
 */

/** `{field: ["message", ...]}`; `non_field_errors` holds whole-object problems. */
export type FieldErrors = Record<string, string[]>;

/** Body of every failed API response. */
export interface ApiErrorBody {
  detail: string;
  errors: FieldErrors;
}

/** Thrown by the API client for any non-2xx response (and for network failures). */
export class ApiError extends Error implements ApiErrorBody {
  /** HTTP status code, or 0 when the request never reached the server. */
  readonly status: number;
  /** Human readable summary - always present. */
  readonly detail: string;
  /** Per-field validation messages keyed by field name. */
  readonly errors: FieldErrors;

  constructor(status: number, detail: string, errors: FieldErrors = {}) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.errors = errors;
    // Keeps `instanceof ApiError` working when the class is transpiled down.
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  /**
   * DRF with session authentication answers "not signed in" with 403 (no
   * WWW-Authenticate header) rather than 401, so both count as auth failures.
   */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }

  get isValidationError(): boolean {
    return this.status === 400 && Object.keys(this.errors).length > 0;
  }

  /** True when the browser never got a response (offline, server down, CORS). */
  get isNetworkError(): boolean {
    return this.status === 0;
  }

  /** Every message in the body, de-duplicated, with `detail` first. */
  get messages(): string[] {
    const out: string[] = [];
    const push = (value: string): void => {
      const text = value.trim();
      if (text && !out.includes(text)) out.push(text);
    };
    push(this.detail);
    for (const list of Object.values(this.errors)) {
      for (const message of list ?? []) push(message);
    }
    return out;
  }

  /** Messages belonging to one field, e.g. `fieldMessages('username')`. */
  fieldMessages(field: string): string[] {
    return this.errors[field] ?? [];
  }
}

/** Envelope used by every paginated list endpoint (apps/core/pagination.py). */
export interface Paginated<T> {
  count: number;
  page: number;
  page_size: number;
  total_pages: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/** Query string values accepted by the list helpers; empty ones are dropped. */
export type QueryParamValue = string | number | boolean | null | undefined;

/** `{search: 'ada', page: 2}` - arrays become repeated parameters. */
export type QueryParams = Record<string, QueryParamValue | QueryParamValue[]>;

/** Common list query parameters understood by the backend. */
export interface ListQueryParams {
  page?: number;
  page_size?: number;
  search?: string;
  ordering?: string;
  [key: string]: QueryParamValue;
}

/** Response of an unauthenticated liveness probe: GET /api/health */
export interface HealthStatus {
  status: string;
  time: string;
  centre: string;
}

/** Turn an unknown thrown value into a user-facing message list. */
export function errorMessages(error: unknown): string[] {
  if (error instanceof ApiError) return error.messages;
  if (error instanceof Error) return [error.message];
  if (typeof error === 'string') return [error];
  return ['An unexpected error occurred.'];
}

/** Turn an unknown thrown value into a single human-readable line. */
export function errorMessage(error: unknown): string {
  return errorMessages(error)[0] ?? 'An unexpected error occurred.';
}
