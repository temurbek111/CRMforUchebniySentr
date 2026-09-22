/**
 * Typed endpoint functions.
 *
 * Paths follow the backend URL configuration exactly (trailing slashes matter:
 * DefaultRouter generates them for viewset routes, while explicit `path()`
 * entries in urls_auth.py / core/urls.py have none).
 *
 *   backend/apps/accounts/urls_auth.py  -> /api/auth/...
 *   backend/apps/accounts/urls.py       -> /api/users/, /api/roles/, /api/permissions/
 *   backend/apps/core/urls.py           -> /api/health, /api/settings, /api/notifications/, /api/audit/
 */

import { api, fetchList } from './client';
import type {
  AuditEntry,
  AuditFilterOptions,
  HealthStatus,
  ListQueryParams,
  LoginCredentials,
  Me,
  NavigationItem,
  Notification,
  Paginated,
  PasswordChangePayload,
  Permission,
  ProfileUpdate,
  QueryParams,
  Role,
  SimpleMessage,
  SystemSettings,
  SystemSettingsUpdate,
  User,
} from '../types';

/** Shared path constants - module pages reuse these instead of typing strings. */
export const API_PATH = {
  health: '/api/health',
  settings: '/api/settings',

  auth: {
    csrf: '/api/auth/csrf',
    login: '/api/auth/login',
    logout: '/api/auth/logout',
    me: '/api/auth/me',
    navigation: '/api/auth/navigation',
    password: '/api/auth/password',
  },

  users: '/api/users/',
  roles: '/api/roles/',
  permissions: '/api/permissions/',

  notifications: '/api/notifications/',
  audit: '/api/audit/',
} as const;

/**
 * Generic paginated list helper: `list<Student>('/api/students/', {search})`.
 * Empty parameter values are dropped by the client's query builder.
 */
export function list<T>(path: string, params?: QueryParams): Promise<Paginated<T>> {
  return fetchList<T>(path, params);
}

/** Fetch every page of a list endpoint (use sparingly: capped at `maxPages`). */
export async function listAll<T>(
  path: string,
  params: QueryParams = {},
  maxPages = 20,
): Promise<T[]> {
  const collected: T[] = [];
  let page = 1;
  while (page <= maxPages) {
    const response = await list<T>(path, { ...params, page });
    collected.push(...response.results);
    if (!response.next) break;
    page += 1;
  }
  return collected;
}

// --------------------------------------------------------------------------- //
// Authentication
// --------------------------------------------------------------------------- //
export const auth = {
  /** GET /api/auth/csrf - also sets the csrftoken cookie. */
  csrf: (): Promise<{ csrfToken: string }> => api.get(API_PATH.auth.csrf),

  /** POST /api/auth/login - returns the full `/me` payload on success. */
  login: (credentials: LoginCredentials): Promise<Me> =>
    api.post<Me>(API_PATH.auth.login, credentials),

  logout: (): Promise<SimpleMessage> => api.post<SimpleMessage>(API_PATH.auth.logout),

  me: (): Promise<Me> => api.get<Me>(API_PATH.auth.me),

  /** PATCH /api/auth/me - only first_name, last_name, email and phone. */
  updateProfile: (payload: ProfileUpdate): Promise<Me> =>
    api.patch<Me>(API_PATH.auth.me, payload),

  changePassword: (payload: PasswordChangePayload): Promise<SimpleMessage> =>
    api.post<SimpleMessage>(API_PATH.auth.password, payload),

  navigation: (): Promise<{ navigation: NavigationItem[] }> =>
    api.get<{ navigation: NavigationItem[] }>(API_PATH.auth.navigation),
};

// --------------------------------------------------------------------------- //
// Health (unauthenticated)
// --------------------------------------------------------------------------- //
export const health = {
  get: (): Promise<HealthStatus> => api.get<HealthStatus>(API_PATH.health),
};

// --------------------------------------------------------------------------- //
// System settings
// --------------------------------------------------------------------------- //
export const settings = {
  get: (): Promise<SystemSettings> => api.get<SystemSettings>(API_PATH.settings),

  /** PATCH /api/settings - requires settings.manage on the server side. */
  update: (payload: SystemSettingsUpdate): Promise<SystemSettings> =>
    api.patch<SystemSettings>(API_PATH.settings, payload),
};

// --------------------------------------------------------------------------- //
// Notifications (the caller's own feed)
// --------------------------------------------------------------------------- //
export const notifications = {
  list: (params?: QueryParams): Promise<Paginated<Notification>> =>
    list<Notification>(API_PATH.notifications, params),

  get: (id: number): Promise<Notification> => api.get<Notification>(`${API_PATH.notifications}${id}/`),

  markRead: (id: number): Promise<Notification> =>
    api.post<Notification>(`${API_PATH.notifications}${id}/read/`),

  markAllRead: (): Promise<{ marked_read: number }> =>
    api.post<{ marked_read: number }>(`${API_PATH.notifications}read-all/`),

  unreadCount: (): Promise<{ unread: number }> =>
    api.get<{ unread: number }>(`${API_PATH.notifications}unread-count/`),

  /** Convenience wrapper used by the bell menu. */
  unread: (pageSize = 10): Promise<Paginated<Notification>> =>
    list<Notification>(API_PATH.notifications, { unread: true, page_size: pageSize }),
};

// --------------------------------------------------------------------------- //
// Audit log (read-only)
// --------------------------------------------------------------------------- //
export interface AuditQueryParams extends ListQueryParams {
  entity?: string;
  action?: string;
  actor?: number;
  date_from?: string;
  date_to?: string;
}

export const audit = {
  list: (params?: AuditQueryParams): Promise<Paginated<AuditEntry>> =>
    list<AuditEntry>(API_PATH.audit, params),

  get: (id: number): Promise<AuditEntry> => api.get<AuditEntry>(`${API_PATH.audit}${id}/`),

  /** Distinct entity/action values for filter dropdowns. */
  filterOptions: (): Promise<AuditFilterOptions> =>
    api.get<AuditFilterOptions>(`${API_PATH.audit}filter-options/`),
};

// --------------------------------------------------------------------------- //
// Users, roles and the permission catalogue (administration screens)
// --------------------------------------------------------------------------- //
export interface UserQueryParams extends ListQueryParams {
  role?: number;
  is_active?: boolean;
}

/** What POST/PATCH /api/users/ accepts (UserWriteSerializer). */
export interface UserWritePayload {
  username?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  role?: number | null;
  is_active?: boolean;
  extra_permissions?: number[];
  password?: string;
}

export const users = {
  list: (params?: UserQueryParams): Promise<Paginated<User>> => list<User>(API_PATH.users, params),

  get: (id: number): Promise<User> => api.get<User>(`${API_PATH.users}${id}/`),

  create: (payload: UserWritePayload): Promise<User> => api.post<User>(API_PATH.users, payload),

  update: (id: number, payload: UserWritePayload): Promise<User> =>
    api.patch<User>(`${API_PATH.users}${id}/`, payload),

  /** DELETE deactivates the account server-side (history is preserved). */
  deactivate: (id: number): Promise<void> => api.delete<void>(`${API_PATH.users}${id}/`),

  resetPassword: (id: number, newPassword: string): Promise<SimpleMessage> =>
    api.post<SimpleMessage>(`${API_PATH.users}${id}/reset-password/`, { new_password: newPassword }),

  toggleActive: (id: number): Promise<User> => api.post<User>(`${API_PATH.users}${id}/toggle-active/`),
};

export interface RoleWritePayload {
  code?: string;
  name?: string;
  description?: string;
  permissions?: number[];
}

export const roles = {
  list: (params?: ListQueryParams): Promise<Paginated<Role>> => list<Role>(API_PATH.roles, params),

  get: (id: number): Promise<Role> => api.get<Role>(`${API_PATH.roles}${id}/`),

  create: (payload: RoleWritePayload): Promise<Role> => api.post<Role>(API_PATH.roles, payload),

  update: (id: number, payload: RoleWritePayload): Promise<Role> =>
    api.patch<Role>(`${API_PATH.roles}${id}/`, payload),

  remove: (id: number): Promise<void> => api.delete<void>(`${API_PATH.roles}${id}/`),

  resetToDefault: (id: number): Promise<Role> =>
    api.post<Role>(`${API_PATH.roles}${id}/reset-to-default/`),
};

export const permissions = {
  /** Unpaginated catalogue (PermissionViewSet sets `pagination_class = None`). */
  list: (params?: QueryParams): Promise<Permission[]> =>
    api.get<Permission[]>(API_PATH.permissions, { params }),
};

/** One object with every endpoint group, handy for page modules. */
export const endpoints = {
  auth,
  health,
  settings,
  notifications,
  audit,
  users,
  roles,
  permissions,
  list,
  listAll,
};

export default endpoints;
