/**
 * Settings & Audit module — typed admin loaders and writers.
 *
 * Everything here is a thin, typed facade over endpoints that already exist.
 * Nothing invents a path, a payload field or a second copy of a shape:
 *
 *   users / roles / permissions / audit  -> src/api/endpoints.ts (same paths the
 *                                           backend router actually serves)
 *   rooms                                -> src/pages/schedule/api.ts + types.ts
 *   courses                              -> canonical `Course` from
 *                                           src/pages/students/api.ts
 *
 * Read from the backend, not from memory (see backend/apps/accounts/views.py,
 * backend/apps/core/views.py + filters.py, backend/apps/academics/views.py):
 *
 *   GET    /api/users/            users.view    paginated; ?search, ?role, ?is_active
 *   POST   /api/users/            users.manage  username + password (+ role) required
 *   PATCH  /api/users/{id}/       users.manage  partial
 *   DELETE /api/users/{id}/       users.manage  DEACTIVATES, never deletes
 *   POST   /api/users/{id}/toggle-active/       flips is_active (no delete)
 *   POST   /api/users/{id}/reset-password/      admin reset
 *   GET    /api/roles/            roles.manage  paginated (RoleSerializer)
 *   PATCH  /api/roles/{id}/       roles.manage  {permissions: [ids]} — audited
 *   POST   /api/roles/{id}/reset-to-default/    restore the canonical matrix
 *   GET    /api/permissions/      roles.manage  unpaginated catalogue (43 codes)
 *   GET    /api/courses/          courses.view  paginated; ?search, ?status, ?level
 *   POST   /api/courses/          courses.manage
 *   PATCH  /api/courses/{id}/     courses.manage  (status "archived" = archive)
 *   GET    /api/rooms/            rooms.view    paginated; ?search, ?status
 *   POST   /api/rooms/            rooms.manage
 *   PATCH  /api/rooms/{id}/       rooms.manage  (status "archived" = archive)
 *   GET    /api/audit/            audit.view    paginated, READ-ONLY
 *   GET    /api/audit/filter-options/  audit.view
 *
 * Filter names below are the real ones from AuditLogFilter: `entity`, `action`,
 * `actor` (a user id), `search`, `date_from`, `date_to`.
 */

import { api, endpoints, list, listAll, API_PATH } from '../../api';
import type {
  AuditEntry,
  AuditFilterOptions,
  ListQueryParams,
  Paginated,
  Permission,
  QueryParams,
  Role,
  User,
} from '../../types';
// Canonical course shape (apps/academics/serializers.py CourseSerializer).
import type { Course } from '../students/api';
import { toNumber } from '../students/api';
// The schedule module already owns the room layer; reuse it verbatim.
import { roomOptions as scheduleRoomOptions, rooms as scheduleRooms } from '../schedule/api';
import type { Room } from '../schedule/types';

/** Re-exported so module pages import their helpers from one place. */
export { toNumber };
export type { Course, Course as CourseRecord, Room };

const COURSES = '/api/courses/';
const ROOMS = '/api/rooms/';

// --------------------------------------------------------------------------- //
// Status vocabularies (apps/academics/models.py CourseStatus, used by Room too)
// --------------------------------------------------------------------------- //

/** `Course.status` and `Room.status` share one TextChoices set. */
export const RECORD_STATUSES = ['active', 'inactive', 'archived'] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

export const RECORD_STATUS_OPTIONS: ReadonlyArray<{ value: RecordStatus; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'archived', label: 'Archived' },
];

/** The two states of a staff account (`User.is_active`). */
export const ACCOUNT_STATUS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Deactivated' },
];

// --------------------------------------------------------------------------- //
// Users
// --------------------------------------------------------------------------- //

/** Query parameters GET /api/users/ understands (filterset_fields + search). */
export interface UsersQuery extends ListQueryParams {
  /** Role id, not code (`filterset_fields = ["role", "is_active"]`). */
  role?: number;
  is_active?: boolean;
}

export type { UserWritePayload, UserQueryParams } from '../../api';

/** POST /api/users/ and PATCH /api/users/{id}/ (UserWriteSerializer). */
export type UserWriteBody = {
  username?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  role?: number | null;
  is_active?: boolean;
  extra_permissions?: number[];
  password?: string;
};

export const usersApi = {
  list: (params?: UsersQuery): Promise<Paginated<User>> => list<User>(API_PATH.users, params),

  /** Every staff account, for the role filter and the audit actor dropdown. */
  all: (): Promise<User[]> => listAll<User>(API_PATH.users, { page_size: 200 }, 20),

  get: (id: number): Promise<User> => endpoints.users.get(id),

  create: (payload: UserWriteBody): Promise<User> => api.post<User>(API_PATH.users, payload),

  update: (id: number, payload: UserWriteBody): Promise<User> =>
    api.patch<User>(`${API_PATH.users}${id}/`, payload),

  /**
   * DELETE /api/users/{id}/ — the server deactivates the account, it never
   * removes the row: history, audit entries and payroll keep pointing at it.
   */
  deactivate: (id: number): Promise<void> => endpoints.users.deactivate(id),

  /** POST /api/users/{id}/toggle-active/ — the only way back to active. */
  setActive: (id: number): Promise<User> => endpoints.users.toggleActive(id),

  resetPassword: (id: number, newPassword: string): Promise<{ detail: string }> =>
    endpoints.users.resetPassword(id, newPassword),
};

// --------------------------------------------------------------------------- //
// Roles and the permission catalogue
// --------------------------------------------------------------------------- //

/** PATCH /api/roles/{id}/ (RoleSerializer). */
export interface RoleWriteBody {
  name?: string;
  description?: string;
  /** Permission ids — the whole replace-set, not a delta. */
  permissions?: number[];
}

export const rolesApi = {
  /** The 5 roles with their permission sets and user counts. */
  list: (): Promise<Role[]> => listAll<Role>(API_PATH.roles, {}, 5),

  update: (id: number, payload: RoleWriteBody): Promise<Role> =>
    endpoints.roles.update(id, payload),

  /** POST /api/roles/{id}/reset-to-default/ — canonical matrix for that code. */
  resetToDefault: (id: number): Promise<Role> => endpoints.roles.resetToDefault(id),
};

export const permissionsApi = {
  /** Unpaginated catalogue (`PermissionViewSet.pagination_class = None`). */
  list: (): Promise<Permission[]> => endpoints.permissions.list(),
};

/**
 * Codes whose grant is a security decision rather than a convenience: they
 * unlock administration, money or the trail itself. Used to flag the matrix,
 * never to block a save — the server is the authority.
 */
export const SECURITY_SENSITIVE_CODES: ReadonlySet<string> = new Set([
  'audit.view',
  'users.view',
  'users.manage',
  'roles.manage',
  'settings.manage',
  'finance.manage',
  'invoices.manage',
  'payments.manage',
  'income.manage',
  'expenses.manage',
  'payroll.manage',
  'payroll.approve',
  'groups.override_capacity',
]);

export function isSecuritySensitive(code: string): boolean {
  return SECURITY_SENSITIVE_CODES.has(code);
}

/** Canonical module order for the catalogue, mirroring rbac.py's grouping. */
const MODULE_ORDER: ReadonlyArray<string> = [
  'Dashboard',
  'CRM',
  'Students',
  'Academic',
  'Schedule',
  'Teachers',
  'Finance',
  'Payroll',
  'Reports',
  'Settings',
  'System',
  'Audit',
];

export function moduleRank(module: string): number {
  const index = MODULE_ORDER.indexOf(module);
  return index === -1 ? MODULE_ORDER.length : index;
}

export interface PermissionGroup {
  module: string;
  permissions: Permission[];
}

/** Group the catalogue by its own `module` field, in canonical order. */
export function groupPermissionsByModule(catalogue: ReadonlyArray<Permission>): PermissionGroup[] {
  const buckets = new Map<string, Permission[]>();
  for (const permission of catalogue) {
    const module = permission.module.trim() === '' ? 'Other' : permission.module;
    const bucket = buckets.get(module);
    if (bucket === undefined) buckets.set(module, [permission]);
    else bucket.push(permission);
  }
  return [...buckets.entries()]
    .map(([module, permissions]) => ({
      module,
      permissions: [...permissions].sort((a, b) => a.code.localeCompare(b.code)),
    }))
    .sort((a, b) => moduleRank(a.module) - moduleRank(b.module) || a.module.localeCompare(b.module));
}

// --------------------------------------------------------------------------- //
// Courses
// --------------------------------------------------------------------------- //

/** POST/PATCH /api/courses/ (CourseSerializer). Money is a decimal string. */
export interface CourseWriteBody {
  code?: string;
  name?: string;
  description?: string;
  /** Free text: the model field is a plain CharField, not a choice list. */
  level?: string;
  default_monthly_fee?: string | null;
  duration_months?: number;
  status?: RecordStatus;
}

export const coursesApi = {
  list: (params?: ListQueryParams): Promise<Paginated<Course>> => list<Course>(COURSES, params),

  all: (): Promise<Course[]> => listAll<Course>(COURSES, { page_size: 200 }, 20),

  create: (payload: CourseWriteBody): Promise<Course> => api.post<Course>(COURSES, payload),

  update: (id: number, payload: CourseWriteBody): Promise<Course> =>
    api.patch<Course>(`${COURSES}${id}/`, payload),

  /**
   * Courses are archived, never deleted: groups, memberships, invoices and the
   * audit trail all reference them. PATCH the status instead.
   */
  setStatus: (id: number, status: RecordStatus): Promise<Course> =>
    api.patch<Course>(`${COURSES}${id}/`, { status }),
};

// --------------------------------------------------------------------------- //
// Rooms (schedule module owns the read layer — reused, not rebuilt)
// --------------------------------------------------------------------------- //

/** POST/PATCH /api/rooms/ (RoomSerializer). */
export interface RoomWriteBody {
  name?: string;
  capacity?: number;
  location?: string;
  equipment?: string;
  status?: RecordStatus;
}

export const roomsCrudApi = {
  /** Reuse of schedule/api.ts `rooms()` — the read-only Rooms page's loader. */
  list: scheduleRooms,

  /** Reuse of schedule/api.ts `roomOptions()`. */
  options: scheduleRoomOptions,

  all: (): Promise<Room[]> => listAll<Room>(ROOMS, { page_size: 200 }, 20),

  create: (payload: RoomWriteBody): Promise<Room> => api.post<Room>(ROOMS, payload),

  update: (id: number, payload: RoomWriteBody): Promise<Room> =>
    api.patch<Room>(`${ROOMS}${id}/`, payload),

  /** Rooms are archived (status), never deleted: slots and groups point at them. */
  setStatus: (id: number, status: RecordStatus): Promise<Room> =>
    api.patch<Room>(`${ROOMS}${id}/`, { status }),
};

// --------------------------------------------------------------------------- //
// Audit trail (read-only, append-only)
// --------------------------------------------------------------------------- //

/** The real filter names from apps/core/filters.py AuditLogFilter. */
export interface AuditQuery extends ListQueryParams {
  entity?: string;
  action?: string;
  /** User id (`filters.NumberFilter(field_name="actor_id")`). */
  actor?: number;
  date_from?: string;
  date_to?: string;
}

export const auditApi = {
  list: (params?: AuditQuery): Promise<Paginated<AuditEntry>> =>
    list<AuditEntry>(API_PATH.audit, params),

  /** Distinct entity/action values so the dropdowns are data-driven. */
  filterOptions: (): Promise<AuditFilterOptions> => endpoints.audit.filterOptions(),

  get: (id: number): Promise<AuditEntry> => endpoints.audit.get(id),
};

/** One field of a before/after comparison. */
export interface DiffRow {
  field: string;
  before: string;
  after: string;
  changed: boolean;
}

const EMPTY_MARK = '—';

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Readable scalar for a JSON diff cell (never "[object Object]"). */
export function formatDiffValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return EMPTY_MARK;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return EMPTY_MARK;
    if (value.every((item) => typeof item === 'string' || typeof item === 'number')) {
      return value.join(', ');
    }
    return JSON.stringify(value);
  }
  return JSON.stringify(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || left === undefined || right === null || right === undefined) {
    // null and undefined both render as the same em dash; treat them as equal.
    return (left ?? null) === (right ?? null);
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => sameValue(item, right[index]));
  }
  if (isPlain(left) && isPlain(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => sameValue(left[key], right[key]));
  }
  return false;
}

/**
 * Turn the two JSON blobs of an audit entry into a field-by-field comparison.
 * Changed fields come first so the eye lands on what actually moved; fields
 * present on only one side are reported as an add/remove.
 */
export function diffFields(
  before: unknown,
  after: unknown,
): DiffRow[] {
  const beforeRecord = isPlain(before) ? before : {};
  const afterRecord = isPlain(after) ? after : {};
  const fields = [
    ...Object.keys(beforeRecord),
    ...Object.keys(afterRecord).filter((key) => !(key in beforeRecord)),
  ];

  return fields
    .map((field) => {
      const from = beforeRecord[field];
      const to = afterRecord[field];
      return {
        field,
        before: formatDiffValue(from),
        after: formatDiffValue(to),
        changed: !sameValue(from, to),
      };
    })
    .sort((a, b) => Number(b.changed) - Number(a.changed));
}

/** True when the entry carries anything worth expanding. */
export function hasDiff(entry: AuditEntry): boolean {
  const before = isPlain(entry.old_value) ? entry.old_value : {};
  const after = isPlain(entry.new_value) ? entry.new_value : {};
  return Object.keys(before).length > 0 || Object.keys(after).length > 0;
}
