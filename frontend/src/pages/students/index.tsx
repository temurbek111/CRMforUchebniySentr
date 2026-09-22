/**
 * Students module entry point.
 *
 * Exports the pages (for direct imports) and the relative route objects the
 * shell router mounts under its parent route, matching the convention used by
 * the attendance, exams, finance and teachers modules.
 */

import type { RouteObject } from 'react-router-dom';
import { StudentDetailPage } from './StudentDetailPage';
import { StudentsListPage } from './StudentsListPage';

export { StudentDetailPage } from './StudentDetailPage';
export { StudentsListPage } from './StudentsListPage';

export const studentRoutes: RouteObject[] = [
  { path: 'students', element: <StudentsListPage /> },
  { path: 'students/:id', element: <StudentDetailPage /> },
];
