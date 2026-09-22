/**
 * Trials - prospects who have a trial booked, or who have sat one.
 *
 * There is no trials endpoint, by design: apps/crm/filters.py documents
 * `?has_trial=true` as "the trials listing (no separate trials endpoint)". This
 * screen is that filter applied to the shared pipeline page, so the table,
 * search, paging and side panel stay identical to /leads.
 */

import { LeadsListPage } from './LeadsListPage';

export function TrialsPage() {
  return (
    <LeadsListPage
      title="Trials"
      baseParams={{ has_trial: true }}
      emptyTitle="No trials booked"
      emptyMessage="Book a trial from a lead's page and that prospect will appear here."
    />
  );
}

export default TrialsPage;
