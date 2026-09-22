/**
 * Settings / administration module entry point.
 *
 * Two route groups live here because they share one data layer
 * (`./api.ts` - usersApi, rolesApi, permissionsApi, coursesApi, roomsCrudApi,
 * auditApi) and one audience: administrators.
 *
 *   auditRoutes    -> /audit                (read-only trail)
 *   settingsRoutes -> /settings/*           (users, roles, courses, rooms, system)
 *
 * They are exported separately because they are separate destinations in the
 * navigation (apps/accounts/rbac.py NAVIGATION), even though the application
 * shell mounts them from one module.
 */

import type { RouteObject } from 'react-router-dom';
import { AuditPage } from './AuditPage';
import { CoursesPage } from './CoursesPage';
import { RolesPage } from './RolesPage';
import { RoomsPage } from './RoomsPage';
import { SystemSettingsPage } from './SystemSettingsPage';
import { UsersPage } from './UsersPage';

export { AuditPage } from './AuditPage';
export { CoursesPage } from './CoursesPage';
export { RolesPage } from './RolesPage';
export { RoomsPage } from './RoomsPage';
export { SystemSettingsPage } from './SystemSettingsPage';
export { UsersPage } from './UsersPage';

/** The append-only audit trail. Read-only; requires audit.view. */
export const auditRoutes: RouteObject[] = [{ path: 'audit', element: <AuditPage /> }];

/** The five administration screens under /settings. */
export const settingsRoutes: RouteObject[] = [
  { path: 'settings/users', element: <UsersPage /> },
  { path: 'settings/roles', element: <RolesPage /> },
  { path: 'settings/courses', element: <CoursesPage /> },
  { path: 'settings/rooms', element: <RoomsPage /> },
  { path: 'settings/system', element: <SystemSettingsPage /> },
];
