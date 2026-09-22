/**
 * Teachers / Salaries module entry point.
 *
 * Exports the pages (for direct imports) and the relative route objects the
 * shell router mounts under its parent route, matching the convention used by
 * the attendance, exams, finance, students and groups modules.
 */

import type { RouteObject } from 'react-router-dom';
import { SalariesPage } from './SalariesPage';
import { TeacherDetailPage } from './TeacherDetailPage';
import { TeachersListPage } from './TeachersListPage';

export { SalariesPage } from './SalariesPage';
export { TeacherDetailPage } from './TeacherDetailPage';
export { TeachersListPage } from './TeachersListPage';

export const teacherRoutes: RouteObject[] = [
  { path: 'teachers', element: <TeachersListPage /> },
  { path: 'teachers/:id', element: <TeacherDetailPage /> },
  { path: 'salaries', element: <SalariesPage /> },
];
