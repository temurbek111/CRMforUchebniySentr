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

export { AuditPage } from './AuditPage';

/** The append-only audit trail. Read-only; requires audit.view. */
export const auditRoutes: RouteObject[] = [{ path: 'audit', element: <AuditPage /> }];
