/**
 * Student profile - Attendance tab.
 *
 * GET /api/students/{id}/attendance/ returns four things and all four are used:
 *   summary  - headline counters + the server-computed percentage
 *   monthly  - `YYYY-MM` -> per-status counts, newest month first
 *   records  - every marked session, newest first
 *   calendar - `YYYY-MM-DD` -> status, drawn as a month grid
 *
 * The grid never invents a status: days without a record stay blank.
 */

import { useMemo, useState } from 'react';
import { Button, Card, StatCard, StatusBadge, Table, type TableColumn } from '../../components';
import { useSettings } from '../../settings/SettingsContext';
import { toIsoDate } from '../../utils/format';
import { studentsApi, toNumber, type AttendanceMonthSummary, type AttendanceRow } from './api';
import { useAsyncResource } from './hooks';
import { AsyncSection, MonthGrid, monthLabel, shiftMonth } from './ui';

export interface StudentAttendanceTabProps {
  studentId: number;
}

function monthKeyOf(date: Date): string {
  return toIsoDate(date).slice(0, 7);
}

export function StudentAttendanceTab({ studentId }: StudentAttendanceTabProps) {
  const settings = useSettings();
  const resource = useAsyncResource(
    () => studentsApi.attendance(studentId),
    `attendance:${studentId}`,
  );
  const data = resource.data;

  const [month, setMonth] = useState('');

  const months = useMemo(() => Object.keys(data?.monthly ?? {}), [data]);
  const effectiveMonth = month !== '' ? month : months[0] ?? monthKeyOf(new Date());

  const monthColumns = useMemo<ReadonlyArray<TableColumn<[string, AttendanceMonthSummary]>>>(
    () => [
      {
        key: 'month',
        header: 'Month',
        render: ([key]) => <span className="u-nowrap">{monthLabel(key)}</span>,
      },
      { key: 'total', header: 'Marked', align: 'right', render: ([, m]) => settings.number(m.total) },
      { key: 'present', header: 'Present', align: 'right', render: ([, m]) => settings.number(m.present) },
      { key: 'late', header: 'Late', align: 'right', render: ([, m]) => settings.number(m.late) },
      { key: 'absent', header: 'Absent', align: 'right', render: ([, m]) => settings.number(m.absent) },
      { key: 'excused', header: 'Excused', align: 'right', render: ([, m]) => settings.number(m.excused) },
      {
        key: 'percentage',
        header: 'Attendance',
        align: 'right',
        render: ([, m]) => settings.percent(toNumber(m.percentage), 1),
      },
    ],
    [settings],
  );

  const recordColumns = useMemo<ReadonlyArray<TableColumn<AttendanceRow>>>(
    () => [
      {
        key: 'date',
        header: 'Date',
        width: '130px',
        render: (row) => <span className="u-nowrap">{settings.date(row.date)}</span>,
      },
      {
        key: 'group',
        header: 'Group',
        render: (row) => row.group || <span className="u-subtle">—</span>,
      },
      { key: 'status', header: 'Status', width: '110px', render: (row) => <StatusBadge status={row.status} /> },
      {
        key: 'reason',
        header: 'Reason',
        render: (row) => (row.reason ? row.reason.replace(/_/g, ' ') : <span className="u-subtle">—</span>),
      },
      {
        key: 'note',
        header: 'Note',
        render: (row) => row.note || <span className="u-subtle">—</span>,
      },
      {
        key: 'modified_by',
        header: 'Marked by',
        render: (row) => row.modified_by ?? <span className="u-subtle">—</span>,
      },
    ],
    [settings],
  );

  return (
    <AsyncSection
      loading={resource.loading}
      error={resource.error}
      onRetry={resource.reload}
      isEmpty={data !== null && data.records.length === 0}
      emptyIcon="calendar"
      emptyTitle="No attendance recorded yet"
      emptyMessage="Once a teacher marks a session for this student's group it will appear here."
      loadingRows={5}
    >
      {data === null ? null : (
        <div className="section-stack">
          <div className="kpi-grid">
            <StatCard label="Attendance" icon="checkCircle" value={settings.percent(toNumber(data.summary.percentage), 1)} />
            <StatCard label="Marked sessions" icon="calendar" value={settings.number(data.summary.total)} />
            <StatCard label="Present" icon="check" value={settings.number(data.summary.present)} />
            <StatCard label="Late" icon="schedule" value={settings.number(data.summary.late)} />
            <StatCard label="Absent" icon="alert" value={settings.number(data.summary.absent)} />
            <StatCard label="Excused" icon="info" value={settings.number(data.summary.excused)} />
          </div>

          <Card title="Month grid" subtitle="Days without a record are left blank.">
            <div className="section-stack">
              <div className="calendar__toolbar">
                <Button size="sm" icon="chevronLeft" onClick={() => setMonth(shiftMonth(effectiveMonth, -1))}>
                  Previous
                </Button>
                <span className="calendar__month">{monthLabel(effectiveMonth)}</span>
                <Button
                  size="sm"
                  iconAfter="chevronRight"
                  onClick={() => setMonth(shiftMonth(effectiveMonth, 1))}
                >
                  Next
                </Button>
              </div>
              <MonthGrid calendar={data.calendar} month={effectiveMonth} />
            </div>
          </Card>

          <Card title="Monthly summary" subtitle="One row per month with marked sessions.">
            <Table<[string, AttendanceMonthSummary]>
              columns={monthColumns}
              rows={Object.entries(data.monthly)}
              rowKey={([key]) => key}
              paginated={false}
              dense
              emptyIcon="calendar"
              emptyTitle="No monthly totals"
              emptyMessage="Monthly totals appear once sessions have been marked."
            />
          </Card>

          <Card title="Sessions" subtitle={`${settings.number(data.records.length)} marked sessions`}>
            <Table<AttendanceRow>
              columns={recordColumns}
              rows={data.records}
              rowKey={(row) => row.id}
              paginated
              initialPageSize={25}
              dense
              emptyIcon="calendar"
              emptyTitle="No sessions"
              emptyMessage="No attendance has been recorded for this student yet."
            />
          </Card>
        </div>
      )}
    </AsyncSection>
  );
}

export default StudentAttendanceTab;
