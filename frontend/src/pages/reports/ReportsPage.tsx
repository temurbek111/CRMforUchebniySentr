/**
 * Reports - one screen, seven server-computed reports.
 *
 * The picker is built from `REPORTS`, which mirrors apps/reporting/services.
 * REPORTS exactly, filtered by what the caller may actually open:
 * reports.finance is required for 'finance' and 'management', reports.view for
 * the rest (apps/reporting/views.ReportView.get_permissions).
 *
 * Nothing is calculated here. Every total, rate and percentage on screen was
 * computed by the server; this page formats what came back. CSV is the server's
 * own export (`/api/reports/<name>/export.csv`), downloaded through a plain
 * anchor so the browser carries the session cookie.
 */

import { useCallback, useMemo, useState } from 'react';
import { Button, Card, DateField, EmptyState, ErrorState, LoadingState, Select } from '../../components';
import { useAuth } from '../../auth/AuthContext';
import { PERMISSIONS } from '../../types';
import { useAsyncResource } from '../students/hooks';
import { InlineNote } from '../students/ui';
import {
  reportsApi,
  reportsVisibleTo,
  type AcademicReport,
  type AtRiskReport,
  type AttendanceReport,
  type FinanceReport,
  type GroupsReport,
  type ManagementReport,
  type ReportPayload,
  type StudentsReport,
} from './api';
import {
  AcademicReportView,
  AtRiskReportView,
  AttendanceReportView,
  FinanceReportView,
  GroupsReportView,
  ManagementReportView,
  StudentsReportView,
} from './reportViews';

const DEFAULT_REPORT = 'students';

/**
 * A loaded payload carries the name that produced it.
 *
 * This is not decoration. Switching reports changes the requested name on the
 * very next render, but `useAsyncResource` only clears its data in an effect -
 * i.e. after that render. Without the name travelling with the payload, the
 * views would be dispatched against the *new* name while holding the *old*
 * data, and every report would crash on a field its shape does not have.
 */
interface LoadedReport {
  name: string;
  payload: ReportPayload;
}

export function ReportsPage() {
  const { hasPerm } = useAuth();

  const available = useMemo(
    () => reportsVisibleTo(hasPerm, PERMISSIONS.REPORTS_VIEW, PERMISSIONS.REPORTS_FINANCE),
    [hasPerm],
  );

  const [requested, setRequested] = useState<string>(DEFAULT_REPORT);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // A selection can become invalid if the user's permissions change; fall back
  // to the first report they may open rather than rendering a 403.
  const active = available.find((report) => report.name === requested) ?? available[0];

  const resource = useAsyncResource<LoadedReport | null>(
    useCallback(async (): Promise<LoadedReport | null> => {
      if (active === undefined) return null;
      const payload = await reportsApi.get<ReportPayload>(active.name, {
        from: from === '' ? undefined : from,
        to: to === '' ? undefined : to,
      });
      return { name: active.name, payload };
    }, [active, from, to]),
    `${active?.name ?? 'none'}|${from}|${to}`,
  );

  const header = (
    <header className="page-header">
      <div className="page-header__heading">
        <h1 className="page-header__title">Reports</h1>
        <p className="page-header__subtitle">
          {active === undefined ? 'No reports available to your role.' : active.description}
        </p>
      </div>
      <div className="page-header__actions">
        {active !== undefined ? (
          <a
            className="btn btn--secondary"
            href={reportsApi.exportUrl(active.name, {
              from: from === '' ? undefined : from,
              to: to === '' ? undefined : to,
            })}
          >
            Export CSV
          </a>
        ) : null}
        <Button icon="refresh" onClick={resource.reload} loading={resource.loading}>
          Refresh
        </Button>
      </div>
    </header>
  );

  if (available.length === 0) {
    return (
      <div className="module-page">
        {header}
        <Card>
          <EmptyState
            icon="lock"
            title="Reports need reports.view"
            message="Your role does not include report access. Financial reports additionally require reports.finance. Ask an administrator if you need either."
          />
        </Card>
      </div>
    );
  }

  const body = (): JSX.Element => {
    if (resource.loading) return <LoadingState label="Building the report…" variant="skeleton" rows={8} />;
    if (resource.error !== null) {
      return (
        <ErrorState error={resource.error} title="Could not build this report" onRetry={resource.reload} />
      );
    }

    const loaded = resource.data;

    // The data must belong to the report that is selected now. On the render
    // where the selection changes, the previous payload is still in hand:
    // showing it under the new report's heading would be a lie, and dispatching
    // the new name against the old shape would throw. So wait for the payload
    // that matches.
    if (loaded === null || active === undefined || loaded.name !== active.name) {
      return <LoadingState label="Building the report…" variant="skeleton" rows={8} />;
    }

    // Narrowed by the name the payload itself carries, never by the requested
    // name and never guessed from the data's shape.
    switch (loaded.name) {
      case 'students':
        return <StudentsReportView data={loaded.payload as StudentsReport} />;
      case 'attendance':
        return <AttendanceReportView data={loaded.payload as AttendanceReport} />;
      case 'academic':
        return <AcademicReportView data={loaded.payload as AcademicReport} />;
      case 'finance':
        return <FinanceReportView data={loaded.payload as FinanceReport} />;
      case 'management':
        return <ManagementReportView data={loaded.payload as ManagementReport} />;
      case 'groups':
        return <GroupsReportView data={loaded.payload as GroupsReport} />;
      case 'at-risk':
        return <AtRiskReportView data={loaded.payload as AtRiskReport} />;
      default:
        return (
          <EmptyState
            icon="alert"
            title="This report has no view yet"
            message={`The server returned data for '${loaded.name}', but this page does not know how to draw it.`}
          />
        );
    }
  };

  return (
    <div className="module-page">
      {header}

      <Card>
        <div className="toolbar-split">
          <div className="filter-bar__field" style={{ minWidth: 240 }}>
            <Select<string>
              label="Report"
              options={available.map((report) => ({ value: report.name, label: report.label }))}
              value={active?.name ?? ''}
              onChange={(value) => {
                if (value !== '') setRequested(value);
              }}
            />
          </div>

          <DateField
            label="From"
            small
            value={from}
            max={to === '' ? undefined : to}
            onChange={setFrom}
          />

          <DateField
            label="To"
            small
            value={to}
            min={from === '' ? undefined : from}
            onChange={setTo}
          />

          {from !== '' || to !== '' ? (
            <Button
              onClick={() => {
                setFrom('');
                setTo('');
              }}
            >
              Clear range
            </Button>
          ) : null}

          <span className="toolbar-split__spacer" />
        </div>
      </Card>

      {active !== undefined && !active.rangeAware ? (
        <InlineNote tone="warning">
          <strong>{active.label}</strong> always describes the present — the server builds it without a date
          range, so the From/To fields do not affect it. The CSV export ignores them too.
        </InlineNote>
      ) : null}

      <div className="u-stack" style={{ gap: 'var(--space-4)' }}>
        {body()}
      </div>
    </div>
  );
}

export default ReportsPage;
