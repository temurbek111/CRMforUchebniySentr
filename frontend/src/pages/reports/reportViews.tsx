/**
 * The seven report views.
 *
 * Each one renders exactly the payload its endpoint returns - no reshaping and
 * no client-side totals: every figure on screen was computed by
 * apps/reporting/services.py. Keeping them in one module makes the differences
 * between reports visible at a glance, which is the point of a report picker.
 */

import {
  BarChart,
  Card,
  DonutChart,
  EmptyState,
  LineChart,
  StatCard,
  Table,
  type ChartPoint,
  type ChartSeries,
  type TableColumn,
} from '../../components';
import { Link } from 'react-router-dom';
import { useSettings } from '../../settings/SettingsContext';
import {
  toNumber,
  type AcademicReport,
  type AtRiskReport,
  type AttendanceReport,
  type BelowPassingRow,
  type DecliningGroupRow,
  type FinanceReport,
  type GroupReportRow,
  type GroupsReport,
  type ManagementReport,
  type NameCount,
  type StudentsReport,
} from './api';

/** Trim all-zero months off the ends of a 12-month series (keeps interior zeros). */
function trimSeries(rows: FinanceReport['monthly_series']): FinanceReport['monthly_series'] {
  const active = (row: { income: string; expenses: string; net: string }): boolean =>
    (toNumber(row.income) ?? 0) !== 0 || (toNumber(row.expenses) ?? 0) !== 0 || (toNumber(row.net) ?? 0) !== 0;
  const first = rows.findIndex(active);
  if (first === -1) return [];
  let last = rows.length - 1;
  while (last > first && !active(rows[last]!)) last -= 1;
  return rows.slice(first, last + 1);
}

// --------------------------------------------------------------------------- //
// Students
// --------------------------------------------------------------------------- //

export function StudentsReportView({ data }: { data: StudentsReport }) {
  const { number: num } = useSettings();

  const byCourse: ChartPoint[] = data.by_course.map((row) => ({
    label: row.course ?? '—',
    value: row.students,
  }));

  const groupColumns: ReadonlyArray<TableColumn<NameCount>> = [
    { key: 'group', header: 'Group', render: (row) => row.group ?? '—', sortValue: (row) => row.group },
    {
      key: 'students',
      header: 'Students',
      align: 'right',
      render: (row) => num(row.students),
      sortValue: (row) => row.students,
    },
  ];

  return (
    <>
      <Card title="Enrolment">
        <div className="kpi-grid">
          <StatCard label="On the roll" value={num(data.total_tracked)} icon="students" />
          <StatCard label="Active" value={num(data.active)} icon="students" />
          <StatCard label="New in range" value={num(data.new)} icon="plus" />
          <StatCard label="Paused" value={num(data.paused)} icon="info" />
          <StatCard label="Dropped" value={num(data.dropped)} icon="alert" />
          <StatCard label="Graduated" value={num(data.graduated)} icon="check" />
        </div>
      </Card>

      <Card title="Students by course" subtitle={`${data.by_course.length} course(s)`}>
        <BarChart
          data={byCourse}
          horizontal
          showGrid
          valueLabel="Students"
          emptyTitle="No enrolments in this range"
        />
      </Card>

      <Card title="Students by group" subtitle={`${data.by_group.length} group(s)`} flush>
        <Table<NameCount>
          columns={groupColumns}
          rows={data.by_group}
          rowKey={(row) => row.group ?? '—'}
          dense
          initialPageSize={10}
          emptyTitle="No groups"
        />
      </Card>
    </>
  );
}

// --------------------------------------------------------------------------- //
// Attendance
// --------------------------------------------------------------------------- //

export function AttendanceReportView({ data }: { data: AttendanceReport }) {
  const { percent, number: num, date } = useSettings();

  const dailySeries: ChartSeries[] = [
    {
      name: 'Present',
      points: data.daily.map((row): ChartPoint => ({ label: row.date.slice(5), value: row.present })),
    },
    {
      name: 'Absent',
      points: data.daily.map((row): ChartPoint => ({ label: row.date.slice(5), value: row.absent })),
    },
    {
      name: 'Late',
      points: data.daily.map((row): ChartPoint => ({ label: row.date.slice(5), value: row.late })),
    },
  ];

  const groupColumns: ReadonlyArray<TableColumn<AttendanceReport['by_group'][number]>> = [
    { key: 'group', header: 'Group', render: (row) => row.group, sortValue: (row) => row.group },
    { key: 'present', header: 'Present', align: 'right', render: (row) => num(row.present), sortValue: (row) => row.present },
    { key: 'absent', header: 'Absent', align: 'right', render: (row) => num(row.absent), sortValue: (row) => row.absent },
    { key: 'late', header: 'Late', align: 'right', render: (row) => num(row.late), sortValue: (row) => row.late },
  ];

  const studentColumns: ReadonlyArray<TableColumn<AttendanceReport['students'][number]>> = [
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
      key: 'percentage',
      header: 'Attendance',
      align: 'right',
      render: (row) => percent(toNumber(row.percentage), 1),
      sortValue: (row) => toNumber(row.percentage) ?? 0,
    },
    { key: 'present', header: 'Present', align: 'right', render: (row) => num(row.present), sortValue: (row) => row.present },
    { key: 'absent', header: 'Absent', align: 'right', render: (row) => num(row.absent), sortValue: (row) => row.absent },
    { key: 'late', header: 'Late', align: 'right', render: (row) => num(row.late), sortValue: (row) => row.late },
    { key: 'excused', header: 'Excused', align: 'right', render: (row) => num(row.excused), sortValue: (row) => row.excused },
  ];

  const repeatedColumns: ReadonlyArray<TableColumn<AttendanceReport['repeated_absences'][number]>> = [
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
    { key: 'absences', header: 'Absences', align: 'right', render: (row) => num(row.absences), sortValue: (row) => row.absences },
    { key: 'streak', header: 'Streak', align: 'right', render: (row) => num(row.streak), sortValue: (row) => row.streak },
    { key: 'reason', header: 'Flagged by', render: (row) => row.reason },
  ];

  return (
    <>
      <Card title="Attendance" subtitle={`${date(data.summary.from)} → ${date(data.summary.to)}`}>
        <div className="kpi-grid">
          <StatCard label="Attendance rate" value={percent(toNumber(data.summary.percentage), 2)} icon="academic" />
          <StatCard label="Present" value={num(data.summary.present)} icon="check" />
          <StatCard label="Absent" value={num(data.summary.absent)} icon="alert" />
          <StatCard label="Late" value={num(data.summary.late)} icon="info" />
          <StatCard label="Excused" value={num(data.summary.excused)} icon="info" />
        </div>
      </Card>

      <Card title="Day by day" subtitle={`${data.daily.length} session day(s)`}>
        <LineChart
          series={dailySeries}
          showGrid
          valueLabel="Students"
          emptyTitle="No attendance in this range"
        />
      </Card>

      {data.repeated_absences.length > 0 ? (
        <Card
          title="Repeated absences"
          subtitle={`${data.repeated_absences.length} student(s) flagged`}
          flush
        >
          <Table
            columns={repeatedColumns}
            rows={data.repeated_absences}
            rowKey={(row) => row.student}
            dense
            paginated={false}
          />
        </Card>
      ) : null}

      <Card title="By group" flush>
        <Table
          columns={groupColumns}
          rows={data.by_group}
          rowKey={(row) => row.group}
          dense
          initialPageSize={10}
          emptyTitle="No groups"
        />
      </Card>

      <Card title="By student" subtitle={`${data.students.length} student(s)`} flush>
        <Table
          columns={studentColumns}
          rows={data.students}
          rowKey={(row) => row.student}
          dense
          initialPageSize={10}
          emptyTitle="No attendance recorded"
        />
      </Card>
    </>
  );
}

// --------------------------------------------------------------------------- //
// Academic
// --------------------------------------------------------------------------- //

export function AcademicReportView({ data }: { data: AcademicReport }) {
  const { percent, number: num, date } = useSettings();

  const belowColumns: ReadonlyArray<TableColumn<BelowPassingRow>> = [
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
    { key: 'exam', header: 'Exam', render: (row) => row.exam_name, sortValue: (row) => row.exam_name },
    { key: 'date', header: 'Date', render: (row) => date(row.date), sortValue: (row) => row.date },
    {
      key: 'percentage',
      header: 'Score',
      align: 'right',
      render: (row) => percent(toNumber(row.percentage), 2),
      sortValue: (row) => toNumber(row.percentage) ?? 0,
    },
    {
      key: 'passing',
      header: 'Pass mark',
      align: 'right',
      render: (row) => percent(toNumber(row.passing_percentage), 2),
      sortValue: (row) => toNumber(row.passing_percentage) ?? 0,
    },
  ];

  const decliningColumns: ReadonlyArray<TableColumn<DecliningGroupRow>> = [
    {
      key: 'group',
      header: 'Group',
      render: (row) => <Link to={row.link}>{row.group_name}</Link>,
      sortValue: (row) => row.group_name,
    },
    {
      key: 'first',
      header: 'First average',
      align: 'right',
      render: (row) => percent(toNumber(row.first_average), 2),
      sortValue: (row) => toNumber(row.first_average) ?? 0,
    },
    {
      key: 'last',
      header: 'Latest average',
      align: 'right',
      render: (row) => percent(toNumber(row.last_average), 2),
      sortValue: (row) => toNumber(row.last_average) ?? 0,
    },
    {
      key: 'delta',
      header: 'Change',
      align: 'right',
      render: (row) => percent(toNumber(row.delta), 2),
      sortValue: (row) => toNumber(row.delta) ?? 0,
    },
  ];

  return (
    <>
      <Card title="Exams">
        <div className="kpi-grid">
          <StatCard label="Exams this month" value={num(data.summary.exams_this_month)} icon="academic" />
          <StatCard
            label="Average score"
            value={percent(toNumber(data.summary.average_score), 2)}
            icon="academic"
          />
          <StatCard
            label="Pass rate"
            value={percent(toNumber(data.summary.pass_rate), 2)}
            hint={`${num(data.summary.passed)} passed · ${num(data.summary.failed)} failed`}
            icon="check"
          />
          <StatCard label="Results recorded" value={num(data.summary.results_recorded)} icon="clipboard" />
          <StatCard label="Below passing" value={num(data.summary.students_below_passing)} icon="alert" />
          <StatCard label="Declining groups" value={num(data.summary.declining_groups)} icon="reports" />
        </div>
      </Card>

      <Card
        title="Below passing"
        subtitle={`${data.below_passing.length} result(s) under the pass mark`}
        flush
      >
        <Table
          columns={belowColumns}
          rows={data.below_passing}
          rowKey={(row) => `${row.student}-${row.exam}`}
          dense
          initialPageSize={10}
          emptyTitle="Nobody is below passing"
          emptyIcon="check"
        />
      </Card>

      <Card
        title="Declining groups"
        subtitle={`${data.declining_groups.length} group(s) whose average fell`}
        flush
      >
        <Table
          columns={decliningColumns}
          rows={data.declining_groups}
          rowKey={(row) => row.group}
          dense
          paginated={false}
          emptyTitle="No declining groups"
          emptyIcon="check"
        />
      </Card>
    </>
  );
}

// --------------------------------------------------------------------------- //
// Finance
// --------------------------------------------------------------------------- //

export function FinanceReportView({ data }: { data: FinanceReport }) {
  const { money, percent, number: num, date } = useSettings();
  const summary = data.summary;

  const series = trimSeries(data.monthly_series);
  const monthlySeries: ChartSeries[] = series.length === 0
    ? []
    : [
        { name: 'Income', points: series.map((r): ChartPoint => ({ label: r.label, value: toNumber(r.income) ?? 0 })) },
        { name: 'Expenses', points: series.map((r): ChartPoint => ({ label: r.label, value: toNumber(r.expenses) ?? 0 })) },
        { name: 'Net', points: series.map((r): ChartPoint => ({ label: r.label, value: toNumber(r.net) ?? 0 })) },
      ];

  const incomePoints: ChartPoint[] = data.income_breakdown.map((row) => ({
    label: row.category,
    value: toNumber(row.amount) ?? 0,
  }));

  const expenseColumns: ReadonlyArray<TableColumn<FinanceReport['expense_breakdown'][number]>> = [
    { key: 'category', header: 'Category', render: (row) => row.category, sortValue: (row) => row.category },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (row) => money(toNumber(row.amount)),
      sortValue: (row) => toNumber(row.amount) ?? 0,
    },
    {
      key: 'count',
      header: 'Entries',
      align: 'right',
      render: (row) => num(row.count ?? 0),
      sortValue: (row) => row.count ?? 0,
    },
  ];

  const courseColumns: ReadonlyArray<TableColumn<FinanceReport['revenue_by_course'][number]>> = [
    { key: 'course', header: 'Course', render: (row) => row.course, sortValue: (row) => row.course },
    {
      key: 'amount',
      header: 'Revenue',
      align: 'right',
      render: (row) => money(toNumber(row.amount)),
      sortValue: (row) => toNumber(row.amount) ?? 0,
    },
    {
      key: 'payments',
      header: 'Payments',
      align: 'right',
      render: (row) => num(row.payments ?? 0),
      sortValue: (row) => row.payments ?? 0,
    },
  ];

  const buckets = Object.entries(data.outstanding.buckets);

  return (
    <>
      <Card title="Position" subtitle={`${date(summary.from)} → ${date(summary.to)}`}>
        <div className="kpi-grid">
          <StatCard label="Gross income" value={money(toNumber(summary.gross_income))} icon="finance" />
          <StatCard label="Total expenses" value={money(toNumber(summary.total_expenses))} icon="finance" />
          <StatCard label="Net result" value={money(toNumber(summary.net_result))} icon="finance" />
          <StatCard
            label="Outstanding"
            value={money(toNumber(summary.outstanding))}
            hint={`${num(summary.overdue_count)} overdue`}
            icon="alert"
          />
          <StatCard
            label="Collection rate"
            value={percent(toNumber(summary.collection_rate), 2)}
            icon="reports"
          />
          <StatCard label="Teacher salaries" value={money(toNumber(summary.payroll))} icon="wallet" />
        </div>
      </Card>

      <Card title="Income, expenses and net" subtitle="By month">
        <LineChart
          series={monthlySeries}
          showGrid
          yFormat={(value) => money(value)}
          valueLabel="Money"
          emptyTitle="No financial activity in this range"
        />
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--space-4)' }}>
        <Card title="Income by category" subtitle={`${data.income_breakdown.length} source(s)`}>
          <DonutChart
            data={incomePoints}
            centerLabel="Income"
            centerValue={money(toNumber(summary.gross_income))}
            formatValue={(value) => money(value)}
            emptyTitle="No income in this range"
          />
        </Card>

        <Card title="Outstanding balances" subtitle={`As of ${date(data.outstanding.as_of)}`}>
          <div className="form-grid">
            <div>
              <div className="u-muted">Invoices</div>
              <strong>{num(data.outstanding.count)}</strong>
            </div>
            <div>
              <div className="u-muted">Total</div>
              <strong>{money(toNumber(data.outstanding.amount))}</strong>
            </div>
            {buckets.map(([label, bucket]) => (
              <div key={label}>
                <div className="u-muted">{label}</div>
                <strong>
                  {money(toNumber(bucket.amount))} <span className="u-muted">({num(bucket.count)})</span>
                </strong>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Expenses by category" subtitle={`${data.expense_breakdown.length} category(ies)`} flush>
        <Table
          columns={expenseColumns}
          rows={data.expense_breakdown}
          rowKey={(row) => row.category}
          dense
          paginated={false}
          emptyTitle="No expenses in this range"
        />
      </Card>

      <Card title="Revenue by course" subtitle={`${data.revenue_by_course.length} course(s)`} flush>
        <Table
          columns={courseColumns}
          rows={data.revenue_by_course}
          rowKey={(row) => row.course}
          dense
          paginated={false}
          emptyTitle="No revenue in this range"
        />
      </Card>
    </>
  );
}

// --------------------------------------------------------------------------- //
// Groups
// --------------------------------------------------------------------------- //

export function GroupsReportView({ data }: { data: GroupsReport }) {
  const { money, percent, number: num } = useSettings();

  const columns: ReadonlyArray<TableColumn<GroupReportRow>> = [
    {
      key: 'name',
      header: 'Group',
      render: (row) => <Link to={`/groups/${row.group}`}>{row.name}</Link>,
      sortValue: (row) => row.name,
    },
    { key: 'course', header: 'Course', render: (row) => row.course, sortValue: (row) => row.course },
    { key: 'teacher', header: 'Teacher', render: (row) => row.teacher, sortValue: (row) => row.teacher },
    { key: 'room', header: 'Room', render: (row) => row.room, sortValue: (row) => row.room },
    {
      key: 'utilisation',
      header: 'Enrolled / capacity',
      align: 'right',
      render: (row) => `${num(row.students)} / ${num(row.capacity)}`,
      sortValue: (row) => row.capacity === 0 ? 0 : row.students / row.capacity,
    },
    {
      key: 'utilisation_pct',
      header: 'Utilisation',
      align: 'right',
      render: (row) => percent(toNumber(row.utilisation_pct), 1),
      sortValue: (row) => toNumber(row.utilisation_pct) ?? 0,
    },
    {
      key: 'fee',
      header: 'Monthly fee',
      align: 'right',
      render: (row) => money(toNumber(row.monthly_fee)),
      sortValue: (row) => toNumber(row.monthly_fee) ?? 0,
    },
    { key: 'status', header: 'Status', render: (row) => row.status },
  ];

  return (
    <Card title="Groups" subtitle={`${data.groups.length} group(s)`} flush>
      <Table
        columns={columns}
        rows={data.groups}
        rowKey={(row) => row.group}
        dense
        initialPageSize={10}
        emptyTitle="No groups"
        emptyIcon="academic"
      />
    </Card>
  );
}

// --------------------------------------------------------------------------- //
// At-risk
// --------------------------------------------------------------------------- //

export function AtRiskReportView({ data }: { data: AtRiskReport }) {
  const { money, percent, number: num } = useSettings();

  const columns: ReadonlyArray<TableColumn<AtRiskReport['students'][number]>> = [
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
      key: 'severity',
      header: 'Severity',
      render: (row) => row.severity,
      sortValue: (row) => row.severity,
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
      render: (row) => num(row.failed_exams),
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
  ];

  return (
    <Card
      title="At-risk students"
      subtitle={`${data.students.length} student(s) breaching a threshold`}
      flush
    >
      <Table
        columns={columns}
        rows={data.students}
        rowKey={(row) => row.student}
        dense
        initialPageSize={10}
        emptyTitle="Nobody is currently at risk"
        emptyMessage="No student breaches the attendance, payment or exam thresholds."
        emptyIcon="check"
      />
    </Card>
  );
}

// --------------------------------------------------------------------------- //
// Management (a digest of all of the above)
// --------------------------------------------------------------------------- //

export function ManagementReportView({ data }: { data: ManagementReport }) {
  const { money, percent, number: num } = useSettings();

  const groupColumns: ReadonlyArray<TableColumn<GroupReportRow>> = [
    {
      key: 'name',
      header: 'Group',
      render: (row) => <Link to={`/groups/${row.group}`}>{row.name}</Link>,
      sortValue: (row) => row.name,
    },
    { key: 'teacher', header: 'Teacher', render: (row) => row.teacher, sortValue: (row) => row.teacher },
    {
      key: 'utilisation',
      header: 'Enrolled',
      align: 'right',
      render: (row) => `${num(row.students)} / ${num(row.capacity)}`,
      sortValue: (row) => row.students,
    },
    { key: 'status', header: 'Status', render: (row) => row.status },
  ];

  return (
    <>
      <Card title="Students & admissions" subtitle={data.label}>
        <div className="kpi-grid">
          <StatCard label="Active students" value={num(data.students.active)} icon="students" />
          <StatCard label="New in range" value={num(data.students.new)} icon="plus" />
          <StatCard label="Paused" value={num(data.students.paused)} icon="info" />
          <StatCard label="Graduated" value={num(data.students.graduated)} icon="check" />
          <StatCard label="New leads" value={num(data.leads.new_leads)} icon="crm" />
          <StatCard
            label="Conversion rate"
            value={percent(data.leads.conversion_rate, 1)}
            hint={`${num(data.leads.registered)} registered`}
            icon="crm"
          />
        </div>
      </Card>

      <Card title="Attendance & academic">
        <div className="kpi-grid">
          <StatCard label="Attendance rate" value={percent(toNumber(data.attendance.percentage), 2)} icon="academic" />
          <StatCard label="Absences" value={num(data.attendance.absent)} icon="alert" />
          <StatCard label="Average score" value={percent(toNumber(data.academic.average_score), 2)} icon="academic" />
          <StatCard label="Pass rate" value={percent(toNumber(data.academic.pass_rate), 2)} icon="check" />
          <StatCard label="Below passing" value={num(data.academic.students_below_passing)} icon="alert" />
          <StatCard label="Declining groups" value={num(data.academic.declining_groups)} icon="reports" />
        </div>
      </Card>

      <Card title="Finance">
        <div className="kpi-grid">
          <StatCard label="Gross income" value={money(toNumber(data.finance.gross_income))} icon="finance" />
          <StatCard label="Total expenses" value={money(toNumber(data.finance.total_expenses))} icon="finance" />
          <StatCard label="Net result" value={money(toNumber(data.finance.net_result))} icon="finance" />
          <StatCard
            label="Outstanding"
            value={money(toNumber(data.finance.outstanding))}
            hint={`${num(data.finance.overdue_count)} overdue`}
            icon="alert"
          />
          <StatCard label="Collection rate" value={percent(toNumber(data.finance.collection_rate), 2)} icon="reports" />
          <StatCard label="Teacher salaries" value={money(toNumber(data.finance.payroll))} icon="wallet" />
        </div>
      </Card>

      <Card title="Groups" subtitle={`${data.groups.length} group(s)`} flush>
        <Table
          columns={groupColumns}
          rows={data.groups}
          rowKey={(row) => row.group}
          dense
          initialPageSize={10}
          emptyTitle="No groups"
        />
      </Card>

      <Card title="Payroll">
        {Object.keys(data.payroll).length === 0 ? (
          <EmptyState icon="wallet" title="No payroll in this period" />
        ) : (
          <div className="form-grid">
            {Object.entries(data.payroll).map(([key, value]) => (
              <div key={key}>
                <div className="u-muted">{key.replace(/_/g, ' ')}</div>
                <strong>
                  {typeof value === 'number'
                    ? num(value)
                    : typeof value === 'string' && /^\d+\.\d{2}$/.test(value)
                      ? money(toNumber(value))
                      : String(value ?? '—')}
                </strong>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
