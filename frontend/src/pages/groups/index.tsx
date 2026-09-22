/**
 * Groups module entry point.
 *
 * Exports the pages (for direct imports) and the relative route objects the
 * shell router mounts under its parent route, matching the convention used by
 * the attendance, exams, finance, schedule, students and teachers modules.
 */

import type { RouteObject } from 'react-router-dom';
import { GroupDetailPage } from './GroupDetailPage';
import { GroupsListPage } from './GroupsListPage';

export { GroupDetailPage } from './GroupDetailPage';
export { GroupsListPage } from './GroupsListPage';

export const groupRoutes: RouteObject[] = [
  { path: 'groups', element: <GroupsListPage /> },
  { path: 'groups/:id', element: <GroupDetailPage /> },
];
