/**
 * Dashboard - the landing page.
 *
 * Every figure on this screen comes from GET /api/dashboard, which aggregates
 * the whole centre server-side. Nothing here is computed in the browser and
 * nothing is hardcoded: the page formats what the server sent, and the only
 * arithmetic it performs is the trim of leading/trailing empty months on the
 * trend chart (the raw 12-month series is returned in full by the API).
 *
 * Sections that need a permission the caller does not hold are hidden, not
 * emptied - the server has already withheld the data. Hiding is cosmetic:
 * apps/accounts/rbac.py enforces every one of them.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge,
  BarChart,
  Button,
  Card,
  DonutChart,
  ErrorState,
  LineChart,
  LoadingState,
  StatCard,
  Table,
  type BadgeTone,
  type ChartPoint,
  type ChartSeries,
  type TableColumn,
} from '../../components';
import { useAuth } from '../../auth/AuthContext';
import { useSettings } from '../../settings/SettingsContext';
import { useAsyncResource } from '../students/hooks';
import {
  dashboardApi,
  toNumber,
  type AtRiskStudent,
  type Dashboard,
  type DashboardAlert,
  type LeadSourceRow,
  type PaymentStatusKey,
  type RecentPayment,
  type ScheduleRow,
} from './api';

/** Null while unknown (role without the permission, or the request failed). */
interface Headcounts {
  teachers: number | null;
  groups: number | null;
}

const PAYMENT_STATUS_LABELS: ReadonlyArray<{ key: PaymentStatusKey; label: string; tone: BadgeTone }> = [
  { key: 'paid', label: 'Paid', tone: 'success' },
  { key: 'partial', label: 'Partially paid', tone: 'warning' },
  { key: 'unpaid', label: 'Unpaid', tone: 'neutral' },
  { key: 'overdue', label: 'Overdue', tone: 'danger' },
  { key: 'waived', label: 'Waived', tone: 'info' },
];

function severityTone(severity: string): BadgeTone {
  if (severity === 'critical') return 'danger';
  if (severity === 'warning') return 'warning';
  if (severity === 'info') return 'info';
  return 'neutral';
}

function deltaDirection(pct: number | null): 'up' | 'down' | 'flat' {
  if (pct === null || pct === 0) return 'flat';
  return pct > 0 ? 'up' : 'down';
}

/**
 * Drop leading and trailing months whose income, expenses and net are all zero.
 *
 * The API returns a full 12-month series for the calendar year; a centre that
 * only has data from May would otherwise open on a flat line of four empty
 * months. Interior zeros are kept - only the empty edges are trimmed.
 */
function trimEmptyEdges(rows: Dashboard['widgets']['financial_series']) {
  const hasActivity = (row: { income: string; expenses: string; net: string }): boolean =>
    (toNumber(row.income) ?? 0) !== 0 || (toNumber(row.expenses) ?? 0) !== 0 || (toNumber(row.net) ?? 0) !== 0;
  const first = rows.findIndex(hasActivity);
  if (first === -1) return [];
  let last = rows.length - 1;
  while (last > first && !hasActivity(rows[last]!)) last -= 1;
  return rows.slice(first, last + 1);
}

export function DashboardPage() {
  const { money, percent, number: formatCount, date, dateTime } = useSettings();
  const { user } = useAuth();

  const dashboard = useAsyncResource<Dashboard>(useCallback(() => dashboardApi.get(), []), 'dashboard');
  const data = dashboard.data;

  const [headcounts, setHeadcounts] = useState<Headcounts>({ teachers: null, groups: null });

  // Two numbers the dashboard payload does not carry. Fetched tolerantly: a role
  // without teachers.view / groups.view sees a dash instead of an error, and a
  // failure here must never take the page down.
  const reloadHeadcounts = useCallback((): void => {
    void Promise.allSettled([dashboardApi.teacherCount(), dashboardApi.activeGroupCount()]).then(
      ([teachers, groups]) => {
        setHeadcounts({
          teachers: teachers.status === 'fulfilled' ? teachers.value : null,
          groups: groups.status === 'fulfilled' ? groups.value : null,
        });
      },
    );
  }, []);

  useEffect(() => {
    reloadHeadcounts();
  }, [reloadHeadcounts, data?.generated_at]);

  const financialSeries = useMemo<ChartSeries[]>(() => {
    const rows = trimEmptyEdges(data?.widgets.financial_series ?? []);
    if (rows.length === 0) return [];
    const series = (name: string, pick: (row: (typeof rows)[number]) => string): ChartSeries => ({
      name,
      points: rows.map((row): ChartPoint => ({ label: row.label, value: toNumber(pick(row)) ?? 0 })),
    });
    return [series('Income', (r) => r.income), series('Expenses', (r) => r.expenses), series('Net', (r) => r.net)];
  }, [data]);

  const sourceSeries = useMemo<ChartSeries[]>(() => {
    const rows: LeadSourceRow[] = data?.kpis.crm.by_source ?? [];
    if (rows.length === 0) return [];
    const series = (name: string, pick: (row: LeadSourceRow) => number): ChartSeries => ({
      name,
      points: rows.map((row): ChartPoint => ({ label: row.source, value: pick(row) })),
    });
    return [series('Leads', (r) => r.leads), series('Registered', (r) => r.registered)];
  }, [data]);

  if (dashboard.loading) {
    return (
      <div>
        <header className="page-header">
          <div className="page-header__heading">
            <h1 className="page-header__title">Dashboard</h1>
            <p className="page-header__subtitle">Loading the centre overview…</p>
          </div>
        </header>
        <LoadingState label="Loading dashboard…" variant="skeleton" rows={8} />
      </div>
    );
  }

  if (dashboard.error !== null || data === null) {
    return (
      <div>
        <header className="page-header">
          <div className="page-header__heading">
            <h1 className="page-header__title">Dashboard</h1>
          </div>
        </header>
        <ErrorState error={dashboard.error} title="Could not load the dashboard" onRetry={dashboard.reload} />
      </div>
    );
  }

  const { kpis, widgets, permissions } = data;
  const inactive = Math.max(0, kpis.students.total - kpis.students.active);
  const todayClasses = widgets.todays_schedule.length;
  const attendanceToday = widgets.attendance_today;
  const paymentPoints: ChartPoint[] = PAYMENT_STATUS_LABELS.filter((entry) => entry.key !== 'waived').map(
    (entry) => ({ label: entry.label, value: widgets.payment_status.counts[entry.key] }),
  );
  const netChange = toNumber(kpis.finance.net_change_pct);
  const newChange = toNumber(kpis.students.new_change_pct);

  const scheduleColumns: ReadonlyArray<TableColumn<ScheduleRow>> = [
    {
      key: 'time',
      header: 'Time',
      render: (row) => `${row.start_time}–${row.end_time}`,
      sortValue: (row) => row.start_time,
      width: '130px',
    },
    {
      key: 'group',
      header: 'Group',
      render: (row) => <Link to={`/groups/${row.group}`}>{row.group_name}</Link>,
      sortValue: (row) => row.group_name,
    },
    { key: 'teacher', header: 'Teacher', render: (row) => row.teacher, sortValue: (row) => row.teacher },
    { key: 'room', header: 'Room', render: (row) => row.room, sortValue: (row) => row.room },
    {
      key: 'students',
      header: 'Students',
      align: 'right',
      render: (row) => formatCount(row.students),
      sortValue: (row) => row.students,
    },
    {
      key: 'status',
      header: 'Attendance',
      render: (row) =>
        row.attendance_pending ? (
          <Badge tone="warning" dot>
            Not marked
          </Badge>
        ) : (
          <Badge tone="success" dot>
            Done
          </Badge>
        ),
    },
  ];

  const atRiskColumns: ReadonlyArray<TableColumn<AtRiskStudent>> = [
    {
      key: 'student',
      header: 'Student',
      render: (row) => (
        <>
          <Link to={row.link}>{row.student_name}</Link>
          <div className="u-muted">{row.student_code}</div>
        </>
      ),
      sortValue: (row) => row.student_name,
    },
    {
      key: 'attendance',
      header: 'Attendance',
      align: 'right',
      render: (row) => percent(toNumber(row.attendance_pct), 1),
      sortValue: (row) => toNumber(row.attendance_pct) ?? 0,
    },
    {
      key: 'overdue',
      header: 'Overdue',
      align: 'right',
      render: (row) => (row.overdue.days > 0 ? `${row.overdue.days}d · ${money(toNumber(row.overdue.amount))}` : '—'),
      sortValue: (row) => row.overdue.days,
    },
    {
      key: 'failed',
      header: 'Failed exams',
      align: 'right',
      render: (row) => formatCount(row.failed_exams),
      sortValue: (row) => row.failed_exams,
    },
    {
      key: 'reasons',
      header: 'Why flagged',
      render: (row) => (
        <ul className="u-stack" style={{ margin: 0, paddingLeft: 18 }}>
          {row.reasons.map((reason) => (
            <li key={reason.code}>{reason.label}</li>
          ))}
        </ul>
      ),
    },
    {
      key: 'severity',
      header: 'Severity',
      render: (row) => (
        <Badge tone={severityTone(row.severity)} dot>
          {row.severity}
        </Badge>
      ),
    },
  ];

  const paymentColumns: ReadonlyArray<TableColumn<RecentPayment>> = [
    { key: 'date', header: 'Date', render: (row) => date(row.date), sortValue: (row) => row.date },
    {
      key: 'student',
      header: 'Student',
      render: (row) => (
        <>
          <Link to={`/students/${row.student}`}>{row.student_name}</Link>
          <div className="u-muted">{row.student_code}</div>
        </>
      ),
      sortValue: (row) => row.student_name,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (row) => money(toNumber(row.amount)),
      sortValue: (row) => toNumber(row.amount) ?? 0,
    },
    { key: 'method', header: 'Method', render: (row) => row.method },
    { key: 'received_by', header: 'Received by', render: (row) => row.received_by },
  ];

  const greeting = user?.full_name !== undefined && user.full_name !== '' ? user.full_name : 'there';

  return (
    <div>
      <header className="page-header">
        <div className="page-header__heading">
          <h1 className="page-header__title">{data.centre.name}</h1>
          <p className="page-header__subtitle">
            Welcome back, {greeting}. Everything below is live as of {dateTime(data.generated_at)}.
          </p>
        </div>
        <div className="page-header__actions">
          <Button icon="refresh" onClick={dashboard.reload} loading={dashboard.loading}>
            Refresh
          </Button>
        </div>
      </header>

      <div className="u-stack" style={{ gap: 'var(--space-4)' }}>
        {/* ---------------------------------------------------------------- */}
        {/* Students & operations                                            */}
        {/* ---------------------------------------------------------------- */}
        <Card title="Students &amp; operations" subtitle={`${formatCount(inactive)} inactive of ${formatCount(kpis.students.total)} on the roll`}>
          <div className="kpi-grid">
            <StatCard
              label="Total students"
              value={formatCount(kpis.students.total)}
              icon="students"
              hint={`${formatCount(kpis.students.new_this_month)} joined this month`}
            />
            <StatCard
              label="Active students"
              value={formatCount(kpis.students.active)}
              icon="students"
              hint={`${formatCount(kpis.students.left_this_month)} left this month`}
            />
            <StatCard label="Inactive students" value={formatCount(inactive)} icon="students" />
            <StatCard
              label="Teachers"
              value={headcounts.teachers === null ? '—' : formatCount(headcounts.teachers)}
              icon="teachers"
              hint={headcounts.teachers === null ? 'Not available for your role' : undefined}
            />
            <StatCard
              label="Active groups"
              value={headcounts.groups === null ? '—' : formatCount(headcounts.groups)}
              icon="academic"
              hint={headcounts.groups === null ? 'Not available for your role' : undefined}
            />
            <StatCard
              label="New this month"
              value={formatCount(kpis.students.new_this_month)}
              delta={
                newChange === null
                  ? undefined
                  : { value: `${newChange.toFixed(1)}%`, direction: deltaDirection(newChange) }
              }
              hint={`vs ${formatCount(kpis.students.new_previous_month)} last month`}
            />
          </div>
        </Card>

        {/* ---------------------------------------------------------------- */}
        {/* Today                                                            */}
        {/* ---------------------------------------------------------------- */}
        <Card title="Today" subtitle={date(data.date)}>
          <div className="kpi-grid">
            <StatCard label="Today's classes" value={formatCount(todayClasses)} icon="schedule" />
            <StatCard
              label="Attendance marked today"
              value={formatCount(attendanceToday.marked)}
              icon="academic"
              hint={
                attendanceToday.marked === 0
                  ? 'No register submitted yet'
                  : `${percent(toNumber(attendanceToday.percentage), 1)} present · ${formatCount(
                      attendanceToday.absent,
                    )} absent`
              }
            />
            <StatCard
              label="Attendance this month"
              value={percent(toNumber(kpis.attendance.month.percentage), 1)}
              icon="academic"
              hint={`${formatCount(kpis.attendance.month.absent)} absences`}
            />
            <StatCard
              label="Payments collected today"
              value={money(toNumber(kpis.finance.collected_today))}
              icon="finance"
            />
          </div>
        </Card>

        {/* ---------------------------------------------------------------- */}
        {/* Finance (hidden entirely without finance.view)                   */}
        {/* ---------------------------------------------------------------- */}
        {permissions.finance ? (
          <Card title="Finance" subtitle={widgets.financial_month.label}>
            <div className="kpi-grid">
              <StatCard
                label="Monthly revenue"
                value={money(toNumber(kpis.finance.income_month))}
                icon="finance"
                hint={`Fees ${money(toNumber(kpis.finance.student_fees_month))}`}
              />
              <StatCard
                label="Monthly expenses"
                value={money(toNumber(kpis.finance.expenses_month))}
                icon="finance"
                hint={`Salaries ${money(toNumber(kpis.finance.payroll_month))}`}
              />
              <StatCard
                label="Net result"
                value={money(toNumber(kpis.finance.net_month))}
                icon="finance"
                delta={
                  netChange === null
                    ? undefined
                    : { value: `${netChange.toFixed(1)}%`, direction: deltaDirection(netChange) }
                }
                hint="vs last month"
              />
              <StatCard
                label="Teacher salaries"
                value={money(toNumber(kpis.finance.payroll_month))}
                icon="wallet"
                hint={permissions.payroll ? `Payable ${money(toNumber(kpis.finance.payroll_payable))}` : undefined}
              />
            </div>
          </Card>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {/* Receivables (hidden without invoicing/finance visibility)        */}
        {/* ---------------------------------------------------------------- */}
        {permissions.receivables ? (
          <Card
            title="Outstanding payments"
            subtitle={`Period starting ${date(widgets.payment_status.period_start)} · collection rate ${percent(
              toNumber(widgets.financial_month.collection_rate),
              1,
            )}`}
          >
            <div className="kpi-grid">
              <StatCard
                label="Outstanding"
                value={money(toNumber(kpis.finance.outstanding))}
                icon="alert"
                hint={`${formatCount(kpis.finance.overdue_count)} invoices past due`}
              />
              <StatCard
                label="Overdue invoices"
                value={formatCount(widgets.payment_status.counts.overdue)}
                icon="alert"
                hint={money(toNumber(widgets.payment_status.amounts.overdue))}
              />
              <StatCard label="Unpaid" value={formatCount(widgets.payment_status.counts.unpaid)} icon="clipboard" />
              <StatCard
                label="Partially paid"
                value={formatCount(widgets.payment_status.counts.partial)}
                icon="clipboard"
              />
              <StatCard label="Paid" value={formatCount(widgets.payment_status.counts.paid)} icon="check" />
            </div>
          </Card>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {/* Academic performance                                             */}
        {/* ---------------------------------------------------------------- */}
        <Card title="Student performance" subtitle={`${formatCount(kpis.academic.exams_this_month)} exams this month`}>
          <div className="kpi-grid">
            <StatCard
              label="Average score"
              value={percent(toNumber(kpis.academic.average_score), 1)}
              icon="academic"
              hint={`${formatCount(kpis.academic.results_recorded)} results recorded`}
            />
            <StatCard
              label="Pass rate"
              value={percent(toNumber(kpis.academic.pass_rate), 1)}
              icon="academic"
              hint={`${formatCount(kpis.academic.passed)} passed · ${formatCount(kpis.academic.failed)} failed`}
            />
            <StatCard
              label="Below passing"
              value={formatCount(kpis.academic.students_below_passing)}
              icon="alert"
              hint="students"
            />
            <StatCard
              label="Declining groups"
              value={formatCount(kpis.academic.declining_groups)}
              icon="reports"
              hint="average score fell"
            />
          </div>
        </Card>

        {/* ---------------------------------------------------------------- */}
        {/* Trends                                                           */}
        {/* ---------------------------------------------------------------- */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--space-4)' }}>
          {permissions.finance ? (
            <Card title="Income, expenses and net" subtitle="By month">
              <LineChart
                series={financialSeries}
                showGrid
                showPoints
                yFormat={(value) => money(value)}
                valueLabel="Money"
                emptyTitle="No financial activity yet"
                emptyHint="Income and expenses will appear here once recorded."
              />
            </Card>
          ) : null}

          {permissions.receivables ? (
            <Card title="Invoice status" subtitle={widgets.financial_month.label}>
              <DonutChart
                data={paymentPoints}
                centerLabel="Invoices"
                centerValue={formatCount(paymentPoints.reduce((total, point) => total + point.value, 0))}
                formatValue={(value) => formatCount(value)}
                emptyTitle="No invoices for this period"
              />
            </Card>
          ) : null}
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Admissions funnel                                                */}
        {/* ---------------------------------------------------------------- */}
        {permissions.crm ? (
          <Card
            title="Admissions funnel"
            subtitle={`${formatCount(kpis.crm.new_leads)} new leads · ${percent(kpis.crm.conversion_rate, 1)} conversion`}
          >
            <div className="kpi-grid" style={{ marginBottom: 'var(--space-4)' }}>
              <StatCard label="New leads" value={formatCount(kpis.crm.new_leads)} icon="crm" />
              <StatCard label="Trials" value={formatCount(kpis.crm.trials)} icon="crm" />
              <StatCard label="Registered" value={formatCount(kpis.crm.registered)} icon="crm" />
              <StatCard label="Lost" value={formatCount(kpis.crm.lost)} icon="crm" />
            </div>
            <BarChart
              series={sourceSeries}
              horizontal
              showGrid
              valueLabel="Leads"
              emptyTitle="No leads recorded yet"
            />
          </Card>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {/* Today's classes                                                  */}
        {/* ---------------------------------------------------------------- */}
        <Card
          title="Today's classes"
          subtitle={`${formatCount(todayClasses)} scheduled`}
          flush
          actions={
            <Link className="btn btn--secondary btn--sm" to="/timetable">
              Timetable
            </Link>
          }
        >
          <Table
            columns={scheduleColumns}
            rows={widgets.todays_schedule}
            rowKey={(row) => row.id}
            paginated={false}
            emptyTitle="No classes scheduled today"
            emptyMessage="Nothing is on the timetable for this date."
            emptyIcon="schedule"
          />
        </Card>

        {/* ---------------------------------------------------------------- */}
        {/* Alerts                                                          */}
        {/* ---------------------------------------------------------------- */}
        <Card title="Alerts" subtitle={`${formatCount(data.alerts.length)} open`}>
          {data.alerts.length === 0 ? (
            <p className="u-muted">Nothing needs your attention right now.</p>
          ) : (
            <div className="u-stack">
              {data.alerts.map((alert: DashboardAlert) => (
                <div className="u-row u-row--between alert" key={alert.key}>
                  <div className="alert__content">
                    <div className="u-row">
                      <Badge tone={severityTone(alert.severity)} dot>
                        {alert.severity}
                      </Badge>
                      <strong>{alert.title}</strong>
                    </div>
                    <p className="u-muted" style={{ margin: '4px 0 0' }}>
                      {alert.body}
                    </p>
                  </div>
                  <Link className="btn btn--secondary btn--sm" to={alert.link}>
                    Open
                  </Link>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ---------------------------------------------------------------- */}
        {/* At-risk students                                                 */}
        {/* ---------------------------------------------------------------- */}
        <Card
          title="At-risk students"
          subtitle={`${formatCount(data.at_risk.length)} flagged by the centre's rules`}
          flush
          actions={
            <Link className="btn btn--secondary btn--sm" to="/progress">
              Full list
            </Link>
          }
        >
          <Table
            columns={atRiskColumns}
            rows={data.at_risk}
            rowKey={(row) => row.student}
            emptyTitle="No students at risk"
            emptyMessage="Nobody currently breaches the attendance, payment or exam thresholds."
            emptyIcon="check"
          />
        </Card>

        {/* ---------------------------------------------------------------- */}
        {/* Recent payments                                                  */}
        {/* ---------------------------------------------------------------- */}
        {permissions.receivables ? (
          <Card
            title="Recent payments"
            subtitle="Latest receipts"
            flush
            actions={
              <Link className="btn btn--secondary btn--sm" to="/payments">
                All payments
              </Link>
            }
          >
            <Table
              columns={paymentColumns}
              rows={widgets.recent_payments}
              rowKey={(row) => row.id}
              initialPageSize={5}
              emptyTitle="No payments yet"
              emptyIcon="finance"
            />
          </Card>
        ) : null}
      </div>
    </div>
  );
}

export default DashboardPage;
