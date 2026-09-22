/**
 * Reports module entry point.
 */

import type { RouteObject } from 'react-router-dom';
import { ReportsPage } from './ReportsPage';

export { ReportsPage } from './ReportsPage';
export { reportsApi, REPORTS, reportsVisibleTo } from './api';

/** Routes contributed by the Reports module; paths are relative to the shell. */
export const reportRoutes: RouteObject[] = [{ path: 'reports', element: <ReportsPage /> }];
