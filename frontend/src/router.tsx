import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { ComingSoon } from './components/ComingSoon';
import { AppLayout } from './layout/AppLayout';
import { ROUTE_STUBS, SHELL_ROUTES } from './navigation/routeManifest';
import { DashboardPage } from './pages/dashboard';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SearchResultsPage } from './pages/search/SearchResultsPage';
import { attendanceRoutes } from './pages/attendance';
import { crmRoutes } from './pages/crm';
import { examRoutes } from './pages/exams';
import { financeRoutes } from './pages/finance';
import { groupRoutes } from './pages/groups';
import { scheduleRoutes } from './pages/schedule';
import { studentRoutes } from './pages/students';
import { teacherRoutes } from './pages/teachers';

/**
 * Routes backed by a real page module. Each entry is relative to the shell.
 * Detail routes (e.g. exams/:id) have no navigation entry of their own.
 */
const realRoutes: RouteObject[] = [
  ...attendanceRoutes,
  ...crmRoutes,
  ...examRoutes,
  ...financeRoutes,
  ...groupRoutes,
  ...scheduleRoutes,
  ...studentRoutes,
  ...teacherRoutes,
];

/**
 * Navigation paths whose page module is not written yet. They still resolve —
 * to a clearly-labelled placeholder that names the module and the permission
 * behind it — so the navigation never lies about what exists and a missing page
 * is never mistaken for a broken one.
 */
const COMING_SOON_PATHS = new Set<string>([
  // NOTE: '/leads' is NOT here - the CRM module now supplies it via crmRoutes.
  // '/trials' and '/admissions' remain placeholders: they are status views over
  // the same /api/leads rows (see pages/crm/api.ts ADMISSIONS_QUEUE_STATUSES)
  // and are still awaiting their page modules.
  '/trials',
  '/admissions',
  '/reports',
  '/settings/users',
  '/settings/roles',
  '/settings/courses',
  '/settings/rooms',
  '/settings/system',
  '/audit',
]);

const moduleRoutes: RouteObject[] = ROUTE_STUBS
  .filter((stub) => stub.path !== '/' && COMING_SOON_PATHS.has(stub.path))
  .map((stub) => ({
    // Absolute paths become relative because these mount under the shell route.
    path: stub.path.replace(/^\//, ''),
    element: <ComingSoon module={stub.module} title={stub.label} path={stub.path} />,
  }));

export const routes: RouteObject[] = [
  {
    path: SHELL_ROUTES.login,
    element: <LoginPage />,
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      // Reached from the topbar search box; not a sidebar destination.
      { path: 'search', element: <SearchResultsPage /> },
      ...realRoutes,
      ...moduleRoutes,
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);

export default router;
