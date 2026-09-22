/**
 * Group profile - Performance tab.
 *
 * GET /api/groups/{id}/performance/ is the single source: one row per exam
 * (average + pass rate), the per-student roll-up and the overall trend. The
 * charts plot exactly those rows in the order the server returns them
 * (chronological), so a trend on screen is a trend in the data - exams without
 * marks are simply not plotted.
 */

import { useMemo } from 'react';
import {
  BarChart,
  Card,
  LineChart,
  StatCard,
  Table,
  type ChartPoint,
  type TableColumn,
} from '../../components';
import { useSettings } from '../../settings/SettingsContext';
import {
  groupsApi,
  toNumber,
  type Group,
  type GroupExamRow,
  type GroupPerformanceStudentRow,
} from '../students/api';
import { useAsyncResource } from '../students/hooks';
import { AsyncSection, RecordLink, TrendBadge } from '../students/ui';

export interface GroupPerformanceTabProps {
  group: Group;
}

export function GroupPerformanceTab({ group }: GroupPerformanceTabProps) {
  const settings = useSettings();
  const resource = useAsyncResource(() => groupsApi.performance(group.id), `group-performance:${group.id}`);
  const data = resource.data;

  const exams = useMemo(() => data?.exams ?? [], [data]);

  // Only exams that actually carry marks can be plotted.
  const averagePoints = useMemo<ReadonlyArray<ChartPoint>>(
    () =>
      exams.flatMap((exam) => {
        const value = toNumber(exam.average_percentage);
        return value === null ? [] : [{ label: exam.exam_name, value }];
      }),
    [exams],
  );

  const passPoints = useMemo<ReadonlyArray<ChartPoint>>(
    () =>
      exams.flatMap((exam) => {
        const value = toNumber(exam.pass_rate);
        return value === null ? [] : [{ label: exam.exam_name, value }];
      }),
    [exams],
  );

  const examColumns = useMemo<ReadonlyArray<TableColumn<GroupExamRow>>>(
    () => [
      {
        key: 'exam_name',
        header: 'Exam',
        render: (row) => (
          <span className="cell-stack">
            <RecordLink to={`/exams/${row.exam}`}>{row.exam_name}</RecordLink>
            <span className="cell-stack__secondary">{row.type.replace(/_/g, ' ')}</span>
          </span>
        ),
      },
      {
        key: 'date',
        header: 'Date',
        width: '120px',
        render: (row) => <span className="u-nowrap">{settings.date(row.date)}</span>,
      },
      {
        key: 'results_count',
        header: 'Marks',
        align: 'right',
        width: '90px',
        render: (row) => settings.number(row.results_count),
      },
      {
        key: 'average_percentage',
        header: 'Average',
        align: 'right',
        width: '110px',
        render: (row) => settings.percent(toNumber(row.average_percentage), 1),
      },
      {
        key: 'pass_rate',
        header: 'Pass rate',
        align: 'right',
        width: '110px',
        render: (row) => settings.percent(toNumber(row.pass_rate), 1),
      },
    ],
    [settings],
  );

  const studentColumns = useMemo<ReadonlyArray<TableColumn<GroupPerformanceStudentRow>>>(
    () => [
      {
        key: 'student_name',
        header: 'Student',
        render: (row) => (
          <span className="cell-stack">
            <RecordLink to={`/students/${row.student}`}>{row.student_name}</RecordLink>
            <span className="cell-stack__secondary u-mono">{row.student_code}</span>
          </span>
        ),
      },
      {
        key: 'exams_taken',
        header: 'Exams',
        align: 'right',
        width: '90px',
        render: (row) => settings.number(row.exams_taken),
      },
      {
        key: 'average_percentage',
        header: 'Average',
        align: 'right',
        width: '110px',
        render: (row) => settings.percent(toNumber(row.average_percentage), 1),
      },
      { key: 'passed', header: 'Passed', align: 'right', width: '90px', render: (row) => settings.number(row.passed) },
      { key: 'failed', header: 'Failed', align: 'right', width: '90px', render: (row) => settings.number(row.failed) },
      {
        key: 'trend',
        header: 'Trend',
        width: '150px',
        render: (row) => <TrendBadge trend={row.trend} />,
      },
    ],
    [settings],
  );

  const hasMarks = exams.some((exam) => exam.results_count > 0);

  return (
    <AsyncSection
      loading={resource.loading}
      error={resource.error}
      onRetry={resource.reload}
      isEmpty={data !== null && exams.length === 0}
      emptyIcon="chartLine"
      emptyTitle="No exams for this group yet"
      emptyMessage="Schedule an exam for this group in the Exams module; averages and the trend appear here once marks are recorded."
      loadingRows={5}
    >
      {data === null ? null : (
        <div className="section-stack">
          <div className="kpi-grid">
            <StatCard
              label="Average"
              icon="chartLine"
              value={settings.percent(toNumber(data.average_percentage), 1)}
              hint="Across every recorded mark"
            />
            <StatCard
              label="Pass rate"
              icon="checkCircle"
              value={settings.percent(toNumber(data.pass_rate), 1)}
            />
            <StatCard label="Exams" icon="clipboard" value={settings.number(exams.length)} />
            <StatCard
              label="Students assessed"
              icon="students"
              value={settings.number(data.students.length)}
            />
            <StatCard
              label="Trend"
              icon="chartBar"
              value={<TrendBadge trend={data.trend} />}
              hint="Compared with the earlier exams"
            />
          </div>

          <Card
            title="Average per exam"
            subtitle="Chronological, straight from the recorded marks."
          >
            <LineChart
              data={averagePoints}
              fill
              showPoints
              valueLabel="Average"
              yFormat={(value) => settings.percent(value, 0)}
              emptyTitle="No marked exams yet"
              emptyHint={
                hasMarks
                  ? 'The marks recorded so far are not enough to plot an average.'
                  : 'Record marks for this group\u2019s exams to see the curve.'
              }
            />
          </Card>

          <Card title="Pass rate per exam" subtitle="Share of marks at or above the passing score.">
            <BarChart
              data={passPoints}
              valueLabel="Pass rate"
              yFormat={(value) => settings.percent(value, 0)}
              emptyTitle="No pass rate to chart yet"
              emptyHint="Pass rates appear once marks are recorded against a passing score."
            />
          </Card>

          <Card flush title="Exams" subtitle="Open an exam to see its mark sheet.">
            <Table<GroupExamRow>
              columns={examColumns}
              rows={exams}
              rowKey={(row) => row.exam}
              paginated={exams.length > 25}
              initialPageSize={25}
              dense
              stickyHeader
              caption="Exams for this group"
              emptyIcon="clipboard"
              emptyTitle="No exams"
              emptyMessage="Exams created for this group appear here."
            />
          </Card>

          <Card flush title="Per student" subtitle="Rolled up from every mark the server holds.">
            <Table<GroupPerformanceStudentRow>
              columns={studentColumns}
              rows={data.students}
              rowKey={(row) => row.student}
              paginated={data.students.length > 25}
              initialPageSize={25}
              dense
              caption="Performance by student"
              emptyIcon="students"
              emptyTitle="No results yet"
              emptyMessage="Students appear here once they have at least one recorded mark."
            />
          </Card>
        </div>
      )}
    </AsyncSection>
  );
}

export default GroupPerformanceTab;
