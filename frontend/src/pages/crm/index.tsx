/**
 * CRM module entry point.
 *
 * Exports the pages (for direct imports) and the relative route objects the
 * shell router mounts under its parent route, matching the convention used by
 * the attendance, exams, finance, groups, schedule, students and teachers
 * modules.
 *
 * All three screens are views over the same /api/leads rows - a lead IS the
 * trial and admission record - so they share one page implementation
 * (`LeadsListPage`) parameterised by a locked filter rather than three
 * near-identical tables. See TrialsPage and AdmissionsPage.
 */

import type { RouteObject } from 'react-router-dom';
import { AdmissionsPage } from './AdmissionsPage';
import { LeadDetailPage } from './LeadDetailPage';
import { LeadsListPage } from './LeadsListPage';
import { TrialsPage } from './TrialsPage';

export { AdmissionsPage } from './AdmissionsPage';
export { LeadDetailPage } from './LeadDetailPage';
export { LeadsListPage } from './LeadsListPage';
export { TrialsPage } from './TrialsPage';

export const crmRoutes: RouteObject[] = [
  { path: 'leads', element: <LeadsListPage /> },
  { path: 'leads/:id', element: <LeadDetailPage /> },
  { path: 'trials', element: <TrialsPage /> },
  { path: 'admissions', element: <AdmissionsPage /> },
];
