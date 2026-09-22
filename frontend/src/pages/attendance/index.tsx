/**
 * Attendance module entry point.
 *
 * Exports the page (for direct imports) and the relative route objects the
 * shell router mounts under its parent route.
 */

import type { RouteObject } from 'react-router-dom';
import { AttendancePage } from './AttendancePage';

export { AttendancePage } from './AttendancePage';

export const attendanceRoutes: RouteObject[] = [
  { path: 'attendance', element: <AttendancePage /> },
];
