/**
 * Route manifest for the shell.
 *
 * This mirrors the backend NAVIGATION structure in
 * backend/apps/accounts/rbac.py - the same keys, labels and paths - so every
 * navigation entry the server can send out has a matching route. Group nodes
 * have no path of their own; their children do.
 *
 * The pages behind these paths are being implemented by other agents, so the
 * router mounts a clearly-labelled placeholder for each one.
 */

import type { NavigationItem } from '../types';

export interface RouteStub {
  /** Route path, identical to the backend navigation path. */
  path: string;
  label: string;
  /** Module the page belongs to, shown on the placeholder. */
  module: string;
  /** Permission the backend requires for the item (documentation only). */
  permission: string;
}

export const ROUTE_STUBS: ReadonlyArray<RouteStub> = [
  { path: '/', label: 'Dashboard', module: 'Dashboard', permission: 'dashboard.view' },

  { path: '/leads', label: 'Leads', module: 'CRM', permission: 'leads.view' },
  { path: '/trials', label: 'Trials', module: 'CRM', permission: 'trials.view' },
  { path: '/admissions', label: 'Admissions', module: 'CRM', permission: 'admissions.manage' },

  { path: '/students', label: 'Students', module: 'Students', permission: 'students.view' },
  { path: '/groups', label: 'Groups', module: 'Students', permission: 'groups.view' },

  { path: '/attendance', label: 'Attendance', module: 'Academic', permission: 'attendance.view' },
  { path: '/exams', label: 'Exams', module: 'Academic', permission: 'exams.view' },
  { path: '/results', label: 'Results', module: 'Academic', permission: 'exams.view' },
  { path: '/progress', label: 'Progress', module: 'Academic', permission: 'exams.view' },

  { path: '/timetable', label: 'Timetable', module: 'Schedule', permission: 'schedule.view' },
  { path: '/calendar', label: 'Calendar', module: 'Schedule', permission: 'schedule.view' },
  { path: '/rooms', label: 'Rooms', module: 'Schedule', permission: 'rooms.view' },

  { path: '/payments', label: 'Payments', module: 'Finance', permission: 'invoices.view' },
  { path: '/income', label: 'Income', module: 'Finance', permission: 'finance.view' },
  { path: '/expenses', label: 'Expenses', module: 'Finance', permission: 'finance.view' },
  { path: '/payroll', label: 'Payroll', module: 'Finance', permission: 'payroll.view' },

  { path: '/teachers', label: 'Teachers', module: 'Teachers', permission: 'teachers.view' },
  { path: '/salaries', label: 'Salaries', module: 'Teachers', permission: 'payroll.view' },

  { path: '/reports', label: 'Reports', module: 'Reports', permission: 'reports.view' },

  { path: '/settings/users', label: 'Users', module: 'Settings', permission: 'users.view' },
  { path: '/settings/roles', label: 'Roles', module: 'Settings', permission: 'roles.manage' },
  { path: '/settings/courses', label: 'Courses', module: 'Settings', permission: 'courses.view' },
  { path: '/settings/rooms', label: 'Rooms', module: 'Settings', permission: 'rooms.view' },
  {
    path: '/settings/system',
    label: 'System Settings',
    module: 'Settings',
    permission: 'settings.view',
  },

  { path: '/audit', label: 'Audit Log', module: 'Audit Log', permission: 'audit.view' },
];

/** Routes that are part of the shell rather than the navigation tree. */
export const SHELL_ROUTES = {
  login: '/login',
} as const;

/** Every path that exists in the router, for documentation and tests. */
export const ALL_ROUTE_PATHS: ReadonlyArray<string> = ROUTE_STUBS.map((stub) => stub.path);

export function findRouteStub(pathname: string): RouteStub | undefined {
  return ROUTE_STUBS.find((stub) => stub.path === pathname);
}

/** Depth-first list of navigable (path-bearing) items in the server tree. */
export function flattenNavigation(navigation: ReadonlyArray<NavigationItem>): NavigationItem[] {
  const out: NavigationItem[] = [];
  for (const item of navigation) {
    if (item.path !== undefined && item.path !== '') out.push(item);
    if (item.children !== undefined) out.push(...flattenNavigation(item.children));
  }
  return out;
}

/** True when `pathname` is the item's own route or a child route of it. */
export function matchesPath(pathname: string, path: string): boolean {
  if (path === '/') return pathname === '/';
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** The navigation item (leaf or group) that owns the current route. */
export function activeNavigationItem(
  navigation: ReadonlyArray<NavigationItem>,
  pathname: string,
): NavigationItem | undefined {
  for (const item of navigation) {
    if (item.path !== undefined && matchesPath(pathname, item.path)) return item;
    if (item.children !== undefined) {
      const child = activeNavigationItem(item.children, pathname);
      if (child !== undefined) return child;
    }
  }
  return undefined;
}

/** Keys of every group that contains the active route (for auto-expanding). */
export function expandedKeysForPath(
  navigation: ReadonlyArray<NavigationItem>,
  pathname: string,
): string[] {
  const keys: string[] = [];

  const walk = (items: ReadonlyArray<NavigationItem>, ancestors: string[]): boolean => {
    let anyActive = false;
    for (const item of items) {
      if (item.children !== undefined) {
        const childActive = walk(item.children, [...ancestors, item.key]);
        if (childActive) {
          keys.push(item.key);
          anyActive = true;
        }
      } else if (item.path !== undefined && matchesPath(pathname, item.path)) {
        keys.push(...ancestors);
        anyActive = true;
      }
    }
    return anyActive;
  };

  walk(navigation, []);
  return [...new Set(keys)];
}
