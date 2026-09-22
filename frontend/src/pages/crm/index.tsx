/**
 * CRM module entry point.
 *
 * Exports the pages (for direct imports) and the relative route objects the
 * shell router mounts under its parent route, matching the convention used by
 * the attendance, exams, finance, groups, schedule, students and teachers
 * modules.
 *
 * Note the backend funnel terminology: a lead IS the trial and admission
 * record. Trials and admissions are not separate entities - they are status
 * views over the same rows (`ADMISSIONS_QUEUE_STATUSES` in ./api), which is why
 * this barrel contributes a single list route.
 */

import type { RouteObject } from 'react-router-dom';
import { LeadDetailPage } from './LeadDetailPage';
import { LeadsListPage } from './LeadsListPage';

export { LeadDetailPage } from './LeadDetailPage';
export { LeadsListPage } from './LeadsListPage';

export const crmRoutes: RouteObject[] = [
  { path: 'leads', element: <LeadsListPage /> },
  { path: 'leads/:id', element: <LeadDetailPage /> },
];
