/**
 * Authentication, user and navigation types.
 *
 * Mirrors apps/accounts/serializers.py (UserSerializer / MeSerializer) and
 * apps/accounts/rbac.py (NAVIGATION).
 */

/** One entry of the server-described, role-filtered navigation tree. */
export interface NavigationItem {
  /** Stable key, e.g. "students" or "students-list". */
  key: string;
  label: string;
  /** Route path; absent on group nodes that only hold children. */
  path?: string;
  /** Icon name understood by src/components/Icon.tsx. */
  icon?: string;
  children?: NavigationItem[];
}

/** GET /api/auth/me - the shape used everywhere in the shell. */
export interface User {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  phone: string;
  role: number | null;
  role_code: string;
  role_name: string;
  is_active: boolean;
  is_superuser: boolean;
  extra_permissions: number[];
  extra_permission_codes: string[];
  /** Union of role permissions and per-user grants (backend: permission_codes). */
  permission_codes: string[];
  last_login: string | null;
  last_password_change: string | null;
  created_at: string;
}

/** The `/me` payload extends the user with the navigation tree. */
export interface Me extends User {
  navigation: NavigationItem[];
}

export interface LoginCredentials {
  username: string;
  password: string;
}

/** PATCH /api/auth/me - only these fields are accepted by the backend. */
export interface ProfileUpdate {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
}

export interface PasswordChangePayload {
  current_password: string;
  new_password: string;
}

export interface SimpleMessage {
  detail: string;
}

/** Permission codes granted by the backend (apps/accounts/rbac.py Perm). */
export const PERMISSIONS = {
  DASHBOARD_VIEW: 'dashboard.view',

  STUDENTS_VIEW: 'students.view',
  STUDENTS_MANAGE: 'students.manage',

  LEADS_VIEW: 'leads.view',
  LEADS_MANAGE: 'leads.manage',
  TRIALS_VIEW: 'trials.view',
  TRIALS_MANAGE: 'trials.manage',
  ADMISSIONS_MANAGE: 'admissions.manage',

  GROUPS_VIEW: 'groups.view',
  GROUPS_MANAGE: 'groups.manage',
  GROUPS_OVERRIDE_CAPACITY: 'groups.override_capacity',

  COURSES_VIEW: 'courses.view',
  COURSES_MANAGE: 'courses.manage',

  ROOMS_VIEW: 'rooms.view',
  ROOMS_MANAGE: 'rooms.manage',

  TEACHERS_VIEW: 'teachers.view',
  TEACHERS_MANAGE: 'teachers.manage',

  ATTENDANCE_VIEW: 'attendance.view',
  ATTENDANCE_MANAGE: 'attendance.manage',

  EXAMS_VIEW: 'exams.view',
  EXAMS_MANAGE: 'exams.manage',
  RESULTS_ENTER: 'results.enter',

  SCHEDULE_VIEW: 'schedule.view',
  SCHEDULE_MANAGE: 'schedule.manage',

  FINANCE_VIEW: 'finance.view',
  FINANCE_MANAGE: 'finance.manage',
  INVOICES_VIEW: 'invoices.view',
  INVOICES_MANAGE: 'invoices.manage',
  PAYMENTS_MANAGE: 'payments.manage',
  INCOME_MANAGE: 'income.manage',
  EXPENSES_MANAGE: 'expenses.manage',

  PAYROLL_VIEW: 'payroll.view',
  PAYROLL_MANAGE: 'payroll.manage',
  PAYROLL_APPROVE: 'payroll.approve',

  REPORTS_VIEW: 'reports.view',
  REPORTS_FINANCE: 'reports.finance',

  NOTIFICATIONS_VIEW: 'notifications.view',

  SETTINGS_VIEW: 'settings.view',
  SETTINGS_MANAGE: 'settings.manage',

  USERS_VIEW: 'users.view',
  USERS_MANAGE: 'users.manage',
  ROLES_MANAGE: 'roles.manage',

  AUDIT_VIEW: 'audit.view',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Role codes defined in apps/accounts/rbac.py. */
export const ROLE_CODES = {
  SUPER_ADMIN: 'super_admin',
  MANAGER: 'manager',
  ACCOUNTANT: 'accountant',
  RECEPTIONIST: 'receptionist',
  TEACHER: 'teacher',
} as const;

export type RoleCode = (typeof ROLE_CODES)[keyof typeof ROLE_CODES];

/** Role rows as returned by /api/roles/ (RoleSerializer). */
export interface Role {
  id: number;
  code: string;
  name: string;
  description: string;
  is_system: boolean;
  permissions: number[];
  permission_codes: string[];
  user_count: number;
}

/** Catalog rows as returned by /api/permissions/ (PermissionSerializer). */
export interface Permission {
  id: number;
  code: string;
  name: string;
  module: string;
  description: string;
}
