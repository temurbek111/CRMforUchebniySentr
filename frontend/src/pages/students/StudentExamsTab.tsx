/**
 * Student profile - Exams tab.
 *
 * GET /api/students/{id}/exams/ gives a summary plus every individual mark
 * (newest first). The line chart plots the per-exam percentage in
 * chronological order - one point per exam, straight from the API.
 */

import { useMemo } from 'react';
import { Badge, Card, EmptyState, LineChart, StatCard, Table, type TableColumn } from '../../components';
import type { ChartPoint } from '../../components';
import { useSettings } from '../../settings/SettingsContext';
import { studentsApi, toNumber, type ExamResultRow } from './api';
import { useAsyncResource } from './hooks';
import { AsyncSection, TrendBadge } from './ui';

export interface StudentExamsTabProps {
  studentId: number;
}

/** Collapse the per-component rows into one point per exam, oldest first. */
function toTrendPoints(results: ReadonlyArray<ExamResultRow>): ChartPoint[] {
  const byExam = new Map<number, { label: string; value: number; sortKey: string }>();

  for (const row of results) {
    const percentage = toNumber(row.percentage);
    if (percentage === null) continue;
    const existing = byExam.get(row.exam);
    // The API returns one row per component; the overall mark wins when present.
    if (existing === undefined || row.component === null) {
      byExam.set(row.exam, {
        label: row.date,
        value: percentage,
        sortKey: `${row.date}-${String(row.exam).padStart(6, '0')}`,
      });
    }
  }

  return [...byExam.values()]
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey))
    .map((entry) => ({ label: entry.label, value: entry.value }));
}

export function StudentExamsTab({ studentId }: StudentExamsTabProps) {
  const settings = useSettings();
  const resource = useAsyncResource(() => studentsApi.exams(studentId), `exams:${studentId}`);
  const data = resource.data;

  const points = useMemo(() => toTrendPoints(data?.results ?? []), [data]);

  /** One row per exam (overall marks), newest first, for the results table. */
  const examRows = useMemo<ReadonlyArray<ExamResultRow>>(() => {
    const seen = new Set<number>();
    const out: ExamResultRow[] = [];
    for (const row of data?.results ?? []) {
      if (row.component !== null) continue;
      if (seen.has(row.exam)) continue;
      seen.add(row.exam);
      out.push(row);
    }
    return out;
  }, [data]);

  const columns = useMemo<ReadonlyArray<TableColumn<ExamResultRow>>>(
    () => [
      {
        key: 'date',
        header: 'Date',
        width: '120px',
        render: (row) => <span className="u-nowrap">{settings.date(row.date)}</span>,
      },
      {
        key: 'exam',
        header: 'Exam',
        render: (row) => (
          <span className="cell-stack">
            <span className="cell-stack__primary">{row.exam_name}</span>
            {row.group_name ? <span className="cell-stack__secondary">{row.group_name}</span> : null}
          </span>
        ),
      },
      {
        key: 'type',
        header: 'Type',
        width: '110px',
        render: (row) => <Badge tone="neutral">{row.type.replace(/_/g, ' ')}</Badge>,
      },
      {
        key: 'score',
        header: 'Score',
        align: 'right',
        width: '110px',
        render: (row) => (
          <span className="u-nowrap">
            {row.score ?? '—'}
            {row.max_score !== null ? <span className="u-subtle"> / {row.max_score}</span> : null}
          </span>
        ),
      },
      {
        key: 'percentage',
        header: 'Percentage',
        align: 'right',
        width: '110px',
        render: (row) => settings.percent(toNumber(row.percentage), 1),
      },
      { key: 'grade', header: 'Grade', width: '80px', align: 'center', render: (row) => row.grade || '—' },
      {
        key: 'comment',
        header: 'Teacher comment',
        render: (row) => row.teacher_comment || <span className="u-subtle">—</span>,
      },
    ],
    [settings],
  );

  return (
    <AsyncSection
      loading={resource.loading}
      error={resource.error}
      onRetry={resource.reload}
      isEmpty={data !== null && data.results.length === 0}
      emptyIcon="reports"
      emptyTitle="No exam results yet"
      emptyMessage="Marks recorded for this student's group will show up here."
      loadingRows={5}
    >
      {data === null ? null : (
        <div className="section-stack">
          <div className="kpi-grid">
            <StatCard label="Exams taken" icon="reports" value={settings.number(data.summary.exams_taken)} />
            <StatCard
              label="Average"
              icon="chartLine"
              value={settings.percent(toNumber(data.summary.average_percentage), 1)}
            />
            <StatCard label="Passed" icon="checkCircle" value={settings.number(data.summary.pass_count)} />
            <StatCard label="Failed" icon="alert" value={settings.number(data.summary.fail_count)} />
            <StatCard
              label="Highest"
              icon="arrowUp"
              value={settings.percent(toNumber(data.summary.highest_percentage), 1)}
            />
            <StatCard
              label="Lowest"
              icon="arrowDown"
              value={settings.percent(toNumber(data.summary.lowest_percentage), 1)}
            />
            <StatCard
              label="Trend"
              icon="chartBar"
              value={<TrendBadge trend={data.summary.trend} />}
            />
          </div>

          <Card title="Percentage over time" subtitle="One point per exam, oldest to newest.">
            {points.length === 0 ? (
              <EmptyState
                icon="chartLine"
                title="Nothing to chart yet"
                message="A trend line appears once at least one exam result has been recorded."
              />
            ) : (
              <LineChart
                data={points}
                height={240}
                fill
                yFormat={(value) => settings.percent(value, 0)}
                valueLabel="Exam percentage"
              />
            )}
          </Card>

          <Card title="Results" subtitle={`${settings.number(examRows.length)} exams with an overall mark`}>
            <Table<ExamResultRow>
              columns={columns}
              rows={examRows}
              rowKey={(row) => row.id}
              paginated
              initialPageSize={25}
              dense
              emptyIcon="reports"
              emptyTitle="No overall marks"
              emptyMessage="Only component marks have been recorded so far."
            />
          </Card>
        </div>
      )}
    </AsyncSection>
  );
}

export default StudentExamsTab;
