import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Badge, StatusBadge } from '../../components/Badge';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { LineChart, type ChartPoint } from '../../components/charts';
import { LoadingState } from '../../components/LoadingState';
import { StatCard } from '../../components/StatCard';
import { Table, type TableColumn } from '../../components/Table';
import { useSettings } from '../../settings/SettingsContext';
import { PERMISSIONS } from '../../types';
import { toIsoDate } from '../../utils/format';
import { teacherApi, type EarningsItemRow, type PolicySnapshotRow, type TeacherGroupRow } from './api';
import {
  EMPLOYMENT_TYPES,
  formatMoneyValue,
  formatPercentValue,
  formatPeriodRange,
  isZeroMoney,
  labelFor,
  toChartNumber,
  useQueryData,
} from '../finance/shared';

/**
 * Teacher profile: contact details, the groups they teach, and their full
 * compensation history (versioned salary policies plus every payroll line).
 */
export function TeacherDetailPage() {
  const params = useParams<{ id: string }>();
  const teacherId = Number(params.id);
  const validId = Number.isInteger(teacherId) && teacherId > 0;

  const { hasPerm } = useAuth();
  const { currency, date, dateTime } = useSettings();
  const canViewPayroll = hasPerm(PERMISSIONS.PAYROLL_VIEW);
  const today = toIsoDate();

  const teacher = useQueryData(
    (signal) => teacherApi.teachers.get(teacherId, signal),
    [teacherId],
    validId,
  );
  const groups = useQueryData(
    (signal) => teacherApi.teachers.groups(teacherId, signal),
    [teacherId],
    validId,
  );
  const earnings = useQueryData(
    (signal) => teacherApi.teachers.earnings(teacherId, signal),
    [teacherId],
    validId && canViewPayroll,
  );

  const money = (value: string | number | null | undefined): string => formatMoneyValue(value, currency);

  const policies = earnings.data?.policies ?? [];
  const items = earnings.data?.items ?? [];

  const currentPolicy = useMemo<PolicySnapshotRow | undefined>(() => {
    return policies.find(
      (policy) =>
        policy.effective_from <= today &&
        (policy.effective_to === null || policy.effective_to >= today),
    );
  }, [policies, today]);

  // The API returns items newest first; the chart reads left to right oldest first.
  const chartPoints: ChartPoint[] = useMemo(
    () =>
      [...items]
        .reverse()
        .map((item) => ({ label: item.run_label, value: toChartNumber(item.net_amount) })),
    [items],
  );

  if (!validId) {
    return (
      <Card title="Teacher">
        <EmptyState
          icon="alertCircle"
          title="That teacher id is not valid"
          message="Open a teacher from the directory instead."
          action={
            <Link className="btn btn--secondary" to="/teachers">
              Back to teachers
            </Link>
          }
        />
      </Card>
    );
  }

  const detail = teacher.data;

  const groupColumns: ReadonlyArray<TableColumn<TeacherGroupRow>> = [
    { key: 'name', header: 'Group', render: (row) => row.name },
    { key: 'course', header: 'Course', render: (row) => row.course_name || '—' },
    { key: 'room', header: 'Room', render: (row) => row.room_name || '—' },
    {
      key: 'schedule',
      header: 'Schedule',
      render: (row) => row.schedule_summary || <span className="u-subtle">—</span>,
    },
    {
      key: 'students',
      header: 'Students',
      align: 'right',
      render: (row) => `${row.student_count} / ${row.capacity}`,
    },
    {
      key: 'fee',
      header: 'Monthly fee',
      align: 'right',
      render: (row) => money(row.monthly_fee),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge status={row.status} />,
    },
  ];

  const policyColumns: ReadonlyArray<TableColumn<PolicySnapshotRow>> = [
    {
      key: 'model',
      header: 'Model',
      render: (row) => (
        <div className="u-stack" style={{ gap: 0 }}>
          <span>{row.model_label || row.model}</span>
          {row.note !== '' ? <span className="u-subtle">{row.note}</span> : null}
        </div>
      ),
    },
    {
      key: 'base',
      header: 'Base',
      align: 'right',
      render: (row) =>
        isZeroMoney(row.base_amount) ? <span className="u-subtle">—</span> : money(row.base_amount),
    },
    {
      key: 'per_lesson',
      header: 'Per lesson',
      align: 'right',
      render: (row) =>
        isZeroMoney(row.per_lesson_rate) ? (
          <span className="u-subtle">—</span>
        ) : (
          money(row.per_lesson_rate)
        ),
    },
    {
      key: 'share',
      header: 'Revenue share',
      align: 'right',
      render: (row) =>
        isZeroMoney(row.revenue_share_pct) ? (
          <span className="u-subtle">—</span>
        ) : (
          formatPercentValue(row.revenue_share_pct)
        ),
    },
    {
      key: 'bonus',
      header: 'Lesson bonus',
      align: 'right',
      render: (row) =>
        isZeroMoney(row.lesson_bonus) ? (
          <span className="u-subtle">—</span>
        ) : (
          money(row.lesson_bonus)
        ),
    },
    {
      key: 'effective',
      header: 'Effective',
      render: (row) => (
        <div className="u-stack" style={{ gap: 0 }}>
          <span>{formatPeriodRange(row.effective_from, row.effective_to)}</span>
          {row.effective_to === null ? <Badge tone="success">Current</Badge> : null}
        </div>
      ),
    },
  ];

  const itemColumns: ReadonlyArray<TableColumn<EarningsItemRow>> = [
    { key: 'run', header: 'Payroll run', render: (row) => row.run_label },
    {
      key: 'status',
      header: 'Run status',
      render: (row) => <StatusBadge status={row.run_status} />,
    },
    {
      key: 'lessons',
      header: 'Lessons',
      align: 'right',
      render: (row) => String(row.lessons_count),
    },
    { key: 'gross', header: 'Gross', align: 'right', render: (row) => money(row.gross_amount) },
    {
      key: 'deductions',
      header: 'Deductions',
      align: 'right',
      render: (row) => money(row.deductions),
    },
    {
      key: 'net',
      header: 'Net',
      align: 'right',
      render: (row) => <strong>{money(row.net_amount)}</strong>,
    },
  ];

  return (
    <div className="u-stack" style={{ gap: 'var(--space-5)' }}>
      <header className="page-header">
        <div className="page-header__heading">
          <Link to="/teachers" className="u-muted">
            ← All teachers
          </Link>
          <h1 className="page-header__title">
            {detail === null ? 'Teacher' : detail.full_name}
          </h1>
          {detail !== null ? (
            <p className="page-header__subtitle u-row">
              <StatusBadge status={detail.status} />
              <span>{labelFor(EMPLOYMENT_TYPES, detail.employment_type)}</span>
              {detail.specialization !== '' ? <span>· {detail.specialization}</span> : null}
            </p>
          ) : null}
        </div>
        <div className="page-header__actions">
          {canViewPayroll ? (
            <Link className="btn btn--secondary" to="/salaries">
              Salary policies
            </Link>
          ) : null}
        </div>
      </header>

      <Card title="Profile">
        {teacher.loading && detail === null ? <LoadingState label="Loading the teacher…" /> : null}
        {teacher.error !== null ? <ErrorState error={teacher.error} onRetry={teacher.reload} /> : null}
        {detail !== null ? (
          <div className="form-grid">
            <ProfileRow label="Phone" value={detail.phone || '—'} />
            <ProfileRow label="Email" value={detail.email || '—'} />
            <ProfileRow label="Specialization" value={detail.specialization || '—'} />
            <ProfileRow
              label="Employment type"
              value={labelFor(EMPLOYMENT_TYPES, detail.employment_type)}
            />
            <ProfileRow label="Started" value={date(detail.start_date)} />
            <ProfileRow label="Ended" value={detail.end_date === null ? '—' : date(detail.end_date)} />
            <ProfileRow label="Groups" value={String(detail.groups_count)} />
            <ProfileRow
              label="Login account"
              value={detail.has_account ? 'Linked' : 'Not linked'}
            />
            <ProfileRow label="Added" value={dateTime(detail.created_at)} />
            {detail.notes !== '' ? <ProfileRow label="Notes" value={detail.notes} /> : null}
          </div>
        ) : null}
      </Card>

      <Card
        title="Groups taught"
        subtitle="Active and historic groups assigned to this teacher"
      >
        {groups.loading && groups.data === null ? <LoadingState label="Loading groups…" /> : null}
        {groups.error !== null ? <ErrorState error={groups.error} onRetry={groups.reload} /> : null}
        {groups.data !== null ? (
          <Table<TeacherGroupRow>
            paginated={false}
            dense
            rows={groups.data}
            rowKey={(row) => row.id}
            columns={groupColumns}
            caption="Groups"
            emptyIcon="students"
            emptyTitle="No groups assigned"
            emptyMessage="Assign a group to this teacher from the Groups module."
          />
        ) : null}
      </Card>

      <Card
        title="Compensation"
        subtitle="Salary policies are versioned by effective date; payroll lines keep their own frozen snapshot"
      >
        {!canViewPayroll ? (
          <div className="alert alert--info" role="status">
            <div className="alert__content">
              Compensation history needs the <code>payroll.view</code> permission.
            </div>
          </div>
        ) : (
          <>
            {earnings.loading && earnings.data === null ? (
              <LoadingState label="Loading compensation…" />
            ) : null}
            {earnings.error !== null ? (
              <ErrorState error={earnings.error} onRetry={earnings.reload} />
            ) : null}

            {earnings.data !== null ? (
              <div className="u-stack" style={{ gap: 'var(--space-5)' }}>
                <div className="kpi-grid">
                  <StatCard
                    label="Total earned"
                    icon="wallet"
                    value={money(earnings.data.total_earned)}
                    hint="Across every payroll run"
                  />
                  <StatCard
                    label="Payroll lines"
                    icon="clipboard"
                    value={String(earnings.data.payments_count)}
                  />
                  <StatCard
                    label="Current model"
                    icon="teachers"
                    value={currentPolicy === undefined ? 'No policy' : currentPolicy.model_label || currentPolicy.model}
                    hint={
                      currentPolicy === undefined
                        ? 'Set a policy on the Salaries page'
                        : `Effective from ${date(currentPolicy.effective_from)}`
                    }
                  />
                </div>

                <div>
                  <h3 className="card__title">Net pay per run</h3>
                  <LineChart
                    data={chartPoints}
                    fill
                    showPoints
                    valueLabel="Net pay"
                    yFormat={(value) => formatMoneyValue(value, currency)}
                    emptyTitle="No payroll history yet"
                    emptyHint="Net pay appears here once this teacher has been included in a payroll run."
                  />
                </div>

                <div>
                  <h3 className="card__title">Salary policy history</h3>
                  {policies.length === 0 ? (
                    <EmptyState
                      icon="finance"
                      title="No salary policy set"
                      message="Compensation is data: set a policy (fixed, per lesson, percentage or hybrid) on the Salaries page."
                    />
                  ) : (
                    <Table<PolicySnapshotRow>
                      paginated={false}
                      dense
                      rows={policies}
                      rowKey={(row) => row.id}
                      columns={policyColumns}
                      caption="Policy versions"
                    />
                  )}
                </div>

                <div>
                  <h3 className="card__title">Payroll items</h3>
                  {items.length === 0 ? (
                    <EmptyState
                      icon="clipboard"
                      title="No payroll items yet"
                      message="Calculating a payroll run that includes this teacher creates a frozen line here."
                    />
                  ) : (
                    <Table<EarningsItemRow>
                      paginated={false}
                      dense
                      stickyHeader
                      rows={items}
                      rowKey={(row) => row.id}
                      columns={itemColumns}
                      caption="Payroll items"
                    />
                  )}
                </div>
              </div>
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <span>{value}</span>
    </div>
  );
}

export default TeacherDetailPage;
