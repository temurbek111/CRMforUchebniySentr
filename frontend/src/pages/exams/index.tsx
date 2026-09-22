/**
 * Exams / Results / Progress module entry point.
 *
 * Exports the pages (for direct imports) and the relative route objects the
 * shell router mounts under its parent route.
 */

import type { RouteObject } from 'react-router-dom';
import { ExamDetailPage } from './ExamDetailPage';
import { ExamsListPage } from './ExamsListPage';
import { ProgressPage } from './ProgressPage';
import { ResultsPage } from './ResultsPage';

export { ExamDetailPage } from './ExamDetailPage';
export { ExamsListPage } from './ExamsListPage';
export { ProgressPage } from './ProgressPage';
export { ResultsPage } from './ResultsPage';

export const examRoutes: RouteObject[] = [
  { path: 'exams', element: <ExamsListPage /> },
  { path: 'exams/:id', element: <ExamDetailPage /> },
  { path: 'results', element: <ResultsPage /> },
  { path: 'progress', element: <ProgressPage /> },
];
