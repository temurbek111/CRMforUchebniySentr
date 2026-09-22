/**
 * Admissions - the conversion queue.
 *
 * A lead that has finished a trial or shown interest is ready to become a
 * student. The backend cannot express that with a single `status` parameter, so
 * this view uses `?status_in=` (apps/crm/filters.LeadFilter) driven by the one
 * declared source of truth for the queue's membership,
 * `ADMISSIONS_QUEUE_STATUSES`.
 *
 * Converting happens on the lead's own page, which is where the real work
 * (group, start date, duplicate-person check) happens - this screen only
 * surfaces who is waiting.
 */

import { ADMISSIONS_QUEUE_STATUSES } from './api';
import { LeadsListPage } from './LeadsListPage';

export function AdmissionsPage() {
  return (
    <LeadsListPage
      title="Admissions"
      baseParams={{ status_in: ADMISSIONS_QUEUE_STATUSES.join(',') }}
      emptyTitle="Nobody is awaiting admission"
      emptyMessage="Leads who complete a trial or show interest land here, ready to be enrolled."
    />
  );
}

export default AdmissionsPage;
