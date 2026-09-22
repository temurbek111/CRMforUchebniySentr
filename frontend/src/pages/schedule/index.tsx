/**
 * Schedule module entry point (timetable, calendar, rooms).
 *
 * Exports the pages (for direct imports) and the relative route objects the
 * shell router mounts under its parent route.
 */

import type { RouteObject } from 'react-router-dom';
import { CalendarPage } from './CalendarPage';
import { RoomsPage } from './RoomsPage';
import { TimetablePage } from './TimetablePage';

export { CalendarPage } from './CalendarPage';
export { RoomsPage } from './RoomsPage';
export { TimetablePage } from './TimetablePage';

export const scheduleRoutes: RouteObject[] = [
  { path: 'timetable', element: <TimetablePage /> },
  { path: 'calendar', element: <CalendarPage /> },
  { path: 'rooms', element: <RoomsPage /> },
];
