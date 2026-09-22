import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge,
  BarChart,
  Button,
  Card,
  DonutChart,
  EmptyState,
  ErrorState,
  LineChart,
  LoadingState,
  Select,
  StatCard,
  Table,
  type ChartPoint,
  type ChartSeries,
  type TableColumn,
} from '../../components';
import { useAuth } from '../../auth/AuthContext';
import { useSettings } from '../../settings/SettingsContext';
import { errorMessage } from '../../types';
import {
  atRiskStudents,
  groupOptions,
  groupPerformance,
  studentExamHistory,
  studentOptions,
  toNumber,
  useApiQuery,
} from './api';
import { gradeTone, severityTone, trendIcon, trendLabel, trendTone } from './labels';
import type {
  AtRiskStudent,
  GroupPerformanceStudent,
  StudentExamResult,
  StudentOption,
} from './types';
import './exams.css';

function TrendBadge({ trend }: { trend: string | null | undefined }): ReactNode {
  return (
    <Badge tone={trendTone(trend)} dot title={trendLabel(trend)}>
      {trendLabel(trend)}
    </Badge>
  );
}

/** Objective at-risk list (needs reports.view) or a group-level fallback. */
function AtRiskPanel({ canSeeAtRisk }: { canSeeAtRisk: boolean }): ReactNode {
  const { percent } = useSettings();
  const query = useApiQuery(() => atRiskStudents(), [], canSeeAtRisk);
  const rows = query.data?.students ?? [];

  if (!canSeeAtRisk) return null;

  const columns: Array<TableColumn<AtRiskStudent>> = [
    {
      key: 'student',
      header: 'Student',
      sortValue: (row) => row.student_name,
      render: (row) => (
        <div className="ex-sheet__who">
          <span>{row.student_name}</span>
          <span className="att-row__code">{row.student_code}</span>
        </div>
      ),
    },
    {
      key: 'severity',
      header: 'Severity',
      sortValue: (row) => row.severity,
      render: (row) => <Badge tone={severityTone(row.severity)}>{row.severity}</Badge>,
    },
    {
      key: 'attendance',
      header: 'Attendance',
      align: 'right',
      sortValue: (row) => toNumber(row.attendance_pct) ?? -1,
      render: (row) => percent(toNumber(row.attendance_pct), 1),
    },
    {
      key: 'absences',
      header: 'Absences (month)',
      align: 'right',
      sortValue: (row) => row.absences_this_month,
      render: (row) => row.absences_this_month,
    },
    {
      key: 'failed',
      header: 'Failed exams',
      align: 'right',
      sortValue: (row) => row.failed_exams,
      render: (row) => row.failed_exams,
    },
    {
      key: 'trend',
      header: 'Trend',
      sortValue: (row) => row.trend ?? '',
      render: (row) => <TrendBadge trend={row.trend} />,
    },
    {
      key: 'reasons',
      header: 'Why flagged',
      render: (row) => (
        <div className="ex-reasons">
          {row.reasons.map((reason) => (
            <span className="ex-reasons__item" key={reason.code}>
              • {reason.label}
            </span>
          ))}
        </div>
      ),
    },
  ];

  return (
    <Card
      title="At-risk students"
      subtitle={`Flagged by the centre's rules — ${rows.length} student(s)`}
      actions={
        <Button size="sm" icon="refresh" onClick={query.reload} loading={query.loading}>
          Refresh
        </Button>
      }
      flush
    >
      <Table
        columns={columns}
        rows={rows}
        rowKey={(row) => row.student}
        loading={query.loading}
        error={query.error}
        onRetry={query.reload}
        emptyTitle="Nobody is flagged"
        emptyMessage="No active student currently crosses the attendance, absence, exam or payment thresholds."
        emptyIcon="checkCircle"
      />
    </Card>
  );
}

export function ProgressPage(): ReactNode {
  const { hasPerm } = useAuth();
  const { percent, amount, date: formatDate } = useSettings();
  const canSeeAtRisk = hasPerm('reports.view');

  const [group, setGroup] = useState<number | ''>('');
  const [student, setStudent] = useState<number | ''>('');

  const groupsQuery = useApiQuery(() => groupOptions(), []);
  const studentsQuery = useApiQuery(() => studentOptions(group), [group]);

  // A student picker that follows the chosen group.
  useEffect(() => {
    setStudent('');
  }, [group]);

  const groupQuery = useApiQuery(
    () => groupPerformance(group === '' ? 0 : group),
    [group],
    group !== '',
  );
  const studentQuery = useApiQuery(
    () => studentExamHistory(student === '' ? 0 : student),
    [student],
    student !== '',
  );

  const performance = groupQuery.data;
  const history = studentQuery.data;

  /** Exams that actually carry marks: the only points a chart may draw. */
  const examChartSeries = useMemo<ChartSeries[]>(() => {
    if (performance === null) return [];
    const scored = performance.exams.filter(
      (exam) => exam.average_percentage !== null && exam.pass_rate !== null,
    );
    const averagePoints: ChartPoint[] = scored.map((exam) => ({
      label: exam.exam_name,
      value: toNumber(exam.average_percentage) ?? 0,
    }));
    const passPoints: ChartPoint[] = scored.map((exam) => ({
      label: exam.exam_name,
      value: toNumber(exam.pass_rate) ?? 0,
    }));
    if (averagePoints.length === 0) return [];
    return [
      { name: 'Average %', points: averagePoints },
      { name: 'Pass rate %', points: passPoints },
    ];
  }, [performance]);

  const excludedExams = useMemo(() => {
    if (performance === null) return 0;
    return performance.exams.filter(
      (exam) => exam.average_percentage === null || exam.pass_rate === null,
    ).length;
  }, [performance]);

  /** Newest-last so the line reads left to right, as the server ordered history. */
  const studentTrendPoints = useMemo<ChartPoint[]>(() => {
    if (history === null) return [];
    return [...history.results].reverse().map((row) => ({
      label: row.component_name === '' ? row.exam_name : `${row.exam_name} · ${row.component_name}`,
      value: toNumber(row.percentage) ?? 0,
    }));
  }, [history]);

  const passFailData = useMemo<ChartPoint[]>(() => {
    if (history === null) return [];
    return [
      { label: 'Passed', value: history.summary.pass_count },
      { label: 'Failed', value: history.summary.fail_count },
    ];
  }, [history]);

  const groupColumns: Array<TableColumn<GroupPerformanceStudent>> = [
    {
      key: 'student',
      header: 'Student',
      sortValue: (row) => row.student_name,
      render: (row) => (
        <div className="ex-sheet__who">
          <span>{row.student_name}</span>
          <span className="att-row__code">{row.student_code}</span>
        </div>
      ),
    },
    {
      key: 'exams',
      header: 'Exams',
      align: 'right',
      sortValue: (row) => row.exams_taken,
      render: (row) => row.exams_taken,
    },
    {
      key: 'average',
      header: 'Average',
      align: 'right',
      sortValue: (row) => toNumber(row.average_percentage) ?? -1,
      render: (row) => percent(toNumber(row.average_percentage), 2),
    },
    {
      key: 'passed',
      header: 'Passed',
      align: 'right',
      sortValue: (row) => row.passed,
      render: (row) => row.passed,
    },
    {
      key: 'failed',
      header: 'Failed',
      align: 'right',
      sortValue: (row) => row.failed,
      render: (row) => row.failed,
    },
    {
      key: 'trend',
      header: 'Trend',
      sortValue: (row) => row.trend,
      render: (row) => <TrendBadge trend={row.trend} />,
    },
    {
      key: 'open',
      header: '',
      render: (row) => (
        <Button size="sm" onClick={() => setStudent(row.student)}>
          Trend
        </Button>
      ),
    },
  ];

  const resultColumns: Array<TableColumn<StudentExamResult>> = [
    {
      key: 'exam',
      header: 'Exam',
      render: (row) => <Link to={`/exams/${row.exam}`}>{row.exam_name}</Link>,
    },
    { key: 'date', header: 'Date', align: 'right', render: (row) => formatDate(row.date) },
    {
      key: 'component',
      header: 'Component',
      render: (row) => (row.component_name === '' ? 'Overall' : row.component_name),
    },
    {
      key: 'score',
      header: 'Score',
      align: 'right',
      render: (row) => (
        <span className="u-nowrap">
          {amount(toNumber(row.score), 2)}
          {row.max_score === null ? '' : ` / ${amount(toNumber(row.max_score), 2)}`}
        </span>
      ),
    },
    {
      key: 'percentage',
      header: 'Percentage',
      align: 'right',
      render: (row) => percent(toNumber(row.percentage), 2),
    },
    {
      key: 'grade',
      header: 'Grade',
      render: (row) => <Badge tone={gradeTone(row.grade)}>{row.grade}</Badge>,
    },
    {
      key: 'comment',
      header: 'Comment',
      render: (row) => (row.teacher_comment.trim() === '' ? '—' : row.teacher_comment),
    },
  ];

  return (
    <div>
      <header className="page-header">
        <div className="page-header__heading">
          <h1 className="page-header__title">Progress</h1>
          <p className="page-header__subtitle">
            Exam performance per group and per student. Averages, pass rates and improving /
            stable / declining badges are all computed by the server.
          </p>
        </div>
      </header>

      <div className="ex-filters">
        <div className="ex-filters__field">
          <Select
            label="Group"
            placeholder="Select a group"
            options={(groupsQuery.data ?? []).map((entry) => ({ value: entry.id, label: entry.name }))}
            value={group}
            onChange={setGroup}
          />
        </div>
        <div className="ex-filters__field">
          <Select
            label="Student"
            placeholder={group === '' ? 'Pick a group first' : 'Select a student'}
            options={(studentsQuery.data ?? []).map((entry: StudentOption) => ({
              value: entry.id,
              label: entry.full_name,
            }))}
            value={student}
            onChange={setStudent}
          />
        </div>
        {group !== '' ? (
          <Button icon="refresh" onClick={groupQuery.reload} loading={groupQuery.loading}>
            Refresh group
          </Button>
        ) : null}
      </div>

      {groupsQuery.error !== null ? (
        <div className="alert alert--error" role="alert">
          <div className="alert__content">
            <span>{errorMessage(groupsQuery.error)}</span>
          </div>
        </div>
      ) : null}

      <div className="u-stack">
        {canSeeAtRisk ? null : (
          <div className="alert alert--info">
            <div className="alert__content">
              <span>
                The centre-wide at-risk list needs the <code>reports.view</code> permission; the
                group table below shows the same evidence for the groups you can see.
              </span>
            </div>
          </div>
        )}

        <AtRiskPanel canSeeAtRisk={canSeeAtRisk} />

        {group === '' ? (
          <Card>
            <EmptyState
              icon="chartLine"
              title="Pick a group to see its performance"
              message="Group averages, pass rates and per-student trends come from the group performance endpoint."
            />
          </Card>
        ) : null}

        {group !== '' && groupQuery.loading && performance === null ? (
          <Card>
            <LoadingState label="Loading group performance…" variant="skeleton" rows={6} />
          </Card>
        ) : null}

        {group !== '' && groupQuery.error !== null && performance === null ? (
          <Card>
            <ErrorState error={groupQuery.error} onRetry={groupQuery.reload} />
          </Card>
        ) : null}

        {performance !== null ? (
          <Card
            title={`${performance.group_name} · group performance`}
            subtitle="Every exam the group has taken, with the group's own average and pass rate"
          >
            <div className="ex-progress__header">
              <div className="ex-progress__metrics">
                <div className="ex-metric">
                  <span className="ex-metric__label">Average</span>
                  <span className="ex-metric__value">
                    {percent(toNumber(performance.average_percentage), 2)}
                  </span>
                </div>
                <div className="ex-metric">
                  <span className="ex-metric__label">Pass rate</span>
                  <span className="ex-metric__value">
                    {percent(toNumber(performance.pass_rate), 2)}
                  </span>
                </div>
                <div className="ex-metric">
                  <span className="ex-metric__label">Exams</span>
                  <span className="ex-metric__value">{performance.exams.length}</span>
                </div>
                <div className="ex-metric">
                  <span className="ex-metric__label">Group trend</span>
                  <span className="ex-metric__value">
                    <TrendBadge trend={performance.trend} />
                  </span>
                </div>
              </div>
            </div>

            {examChartSeries.length > 0 ? (
              <BarChart
                series={examChartSeries}
                valueLabel="Percent"
                yFormat={(value) => `${value}%`}
                height={280}
              />
            ) : (
              <EmptyState
                icon="chartBar"
                title="No marked exams yet"
                message="Record results on an exam's mark sheet to see averages here."
              />
            )}

            {excludedExams > 0 ? (
              <p className="ex-hint">
                {excludedExams} exam(s) are excluded from the chart because they have no recorded
                marks.
              </p>
            ) : null}

            <div className="ex-bars">
              {performance.students.slice(0, 12).map((row) => {
                const value = toNumber(row.average_percentage) ?? 0;
                return (
                  <div className="ex-bar" key={row.student}>
                    <span className="ex-bar__label" title={row.student_name}>
                      {row.student_name}
                    </span>
                    <span className="ex-bar__track">
                      <span
                        className="ex-bar__fill"
                        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
                      />
                    </span>
                    <span className="ex-bar__value">
                      {percent(toNumber(row.average_percentage), 1)}
                    </span>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 'var(--space-4)' }}>
              <Table
                columns={groupColumns}
                rows={performance.students}
                rowKey={(row) => row.student}
                paginated={performance.students.length > 10}
                initialPageSize={10}
                dense
                emptyTitle="No student marks yet"
                emptyMessage="This group has no recorded exam results."
              />
            </div>
          </Card>
        ) : null}

        {student !== '' ? (
          studentQuery.loading && history === null ? (
            <Card>
              <LoadingState label="Loading the student's exam history…" variant="skeleton" rows={5} />
            </Card>
          ) : studentQuery.error !== null && history === null ? (
            <Card>
              <ErrorState error={studentQuery.error} onRetry={studentQuery.reload} />
            </Card>
          ) : history !== null ? (
            <>
              <div className="kpi-grid">
                <StatCard
                  label="Average"
                  value={percent(toNumber(history.summary.average_percentage), 2)}
                  icon="chartLine"
                  hint={`${history.summary.exams_taken} exam(s) taken`}
                />
                <StatCard
                  label="Latest"
                  value={percent(toNumber(history.summary.latest_percentage), 2)}
                  icon="arrowUp"
                  hint={
                    history.summary.latest_score === null
                      ? 'No marks yet'
                      : `score ${amount(toNumber(history.summary.latest_score), 2)}`
                  }
                />
                <StatCard
                  label="Highest"
                  value={percent(toNumber(history.summary.highest_percentage), 2)}
                  icon="arrowUp"
                />
                <StatCard
                  label="Lowest"
                  value={percent(toNumber(history.summary.lowest_percentage), 2)}
                  icon="arrowDown"
                />
                <StatCard
                  label="Passed / failed"
                  value={`${history.summary.pass_count} / ${history.summary.fail_count}`}
                  icon="checkCircle"
                />
                <StatCard
                  label="Trend"
                  value={<Badge tone={trendTone(history.summary.trend)}>{trendLabel(history.summary.trend)}</Badge>}
                  icon={trendIcon(history.summary.trend)}
                  hint="Recent half vs earlier half of the exams"
                />
              </div>

              <div className="ex-progress__split">
                <Card
                  title="Mark trend"
                  subtitle="Every recorded mark, oldest first — the server computes the trend from per-exam overall scores"
                >
                  {studentTrendPoints.length > 1 ? (
                    <LineChart
                      data={studentTrendPoints}
                      fill
                      showPoints
                      valueLabel="Percentage"
                      yFormat={(value) => `${value}%`}
                      height={260}
                    />
                  ) : (
                    <EmptyState
                      icon="chartLine"
                      title="Not enough marks to chart a trend"
                      message="At least two recorded marks are needed for a line."
                    />
                  )}
                </Card>

                <Card title="Pass / fail" subtitle="Across every exam the student has taken">
                  <DonutChart
                    data={passFailData}
                    centerLabel="Exams"
                    formatValue={(value) => String(value)}
                    emptyTitle="No exams recorded"
                  />
                </Card>
              </div>

              <Card title="Result history" subtitle="Newest first" flush>
                <Table
                  columns={resultColumns}
                  rows={history.results}
                  rowKey={(row) => row.id}
                  dense
                  initialPageSize={10}
                  emptyTitle="No results yet"
                  emptyMessage="Marks recorded on an exam's mark sheet appear here."
                />
              </Card>
            </>
          ) : null
        ) : null}
      </div>
    </div>
  );
}

export default ProgressPage;
