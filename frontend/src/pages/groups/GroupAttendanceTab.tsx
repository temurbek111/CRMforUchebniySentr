/**
 * Group profile - Attendance tab.
 *
 * GET /api/groups/{id}/attendance-summary/ answers with three real things:
 *   sessions - every session the group has had, with its submission state and
 *              its own present/absent/late/excused split
 *   totals   - the same counters across the whole selection
 *   students - the per-student breakdown, worst attendance first
 *
 * The optional `from`/`to` parameters are wired to the date range control, so
 * the numbers always describe the window shown on screen.
 */

import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  DateField,
  DonutChart,
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
  type GroupAttendanceDateRow,
  type GroupAttendanceStudentRow,
} from '../students/api';
import { useAsyncResource } from '../students/hooks';
import { AsyncSection, RecordLink } from '../students/ui';

export interface GroupAttendanceTabProps {
  group: Group;
}

export function GroupAttendanceTab({ group }: GroupAttendanceTabProps) {
  const settings = useSettings();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const resource = useAsyncResource(
    () =>
      groupsApi.attendanceSummary(group.id, {
        from: from === '' ? undefined : from,
        to: to === '' ? undefined : to,
      }),
    `group-attendance:${group.id}:${from}:${to}`,
  );

  const data = resource.data;
  const totals = data?.totals;
  const marked = totals === undefined ? 0 : totals.present + totals.absent + totals.late + totals.excused;

  const donutData = useMemo<ReadonlyArray<ChartPoint>>(() => {
    if (totals === undefined) return [];
    return [
      { label: 'Present', value: totals.present },
      { label: 'Late', value: totals.late },
      { label: 'Absent', value: totals.absent },
      { label: 'Excused', value: totals.excused },
    ];
  }, [totals]);

  const sessionColumns = useMemo<ReadonlyArray<TableColumn<GroupAttendanceDateRow>>>(
    () => [
      {
        key: 'date',
        header: 'Session',
        width: '140px',
        render: (row) => (
          <span className="cell-stack">
            <RecordLink to={`/attendance?group=${group.id}&date=${row.date}`}>
              {settings.date(row.date)}
            </RecordLink>
            <span className="cell-stack__secondary">{row.teacher ?? 'No teacher'}</span>
          </span>
        ),
      },
      {
        key: 'state',
        header: 'State',
        width: '120px',
        render: (row) => (
          <Badge tone={row.state === 'submitted' ? 'success' : 'warning'} dot>
            {row.state === 'submitted' ? 'Submitted' : 'Open'}
          </Badge>
        ),
      },
      {
        key: 'marked',
        header: 'Marked',
        align: 'right',
        width: '110px',
        render: (row) => (
          <span className="cell-stack">
            <span>{settings.number(row.marked)}</span>
            {row.unmarked > 0 ? (
              <span className="cell-stack__secondary">{settings.number(row.unmarked)} unmarked</span>
            ) : null}
          </span>
        ),
      },
      { key: 'present', header: 'Present', align: 'right', render: (row) => settings.number(row.present) },
      { key: 'late', header: 'Late', align: 'right', render: (row) => settings.number(row.late) },
      { key: 'absent', header: 'Absent', align: 'right', render: (row) => settings.number(row.absent) },
      { key: 'excused', header: 'Excused', align: 'right', render: (row) => settings.number(row.excused) },
      {
        key: 'percentage',
        header: 'Rate',
        align: 'right',
        width: '90px',
        render: (row) => settings.percent(toNumber(row.percentage), 1),
      },
    ],
    [group.id, settings],
  );

  const studentColumns = useMemo<ReadonlyArray<TableColumn<GroupAttendanceStudentRow>>>(
    () => [
      {
        key: 'student',
        header: 'Student',
        render: (row) => <RecordLink to={`/students/${row.student}`}>{row.student_name}</RecordLink>,
      },
      {
        key: 'code',
        header: 'Code',
        width: '96px',
        render: (row) => <span className="u-mono">{row.student_code}</span>,
      },
      { key: 'present', header: 'Present', align: 'right', render: (row) => settings.number(row.present) },
      { key: 'late', header: 'Late', align: 'right', render: (row) => settings.number(row.late) },
      { key: 'absent', header: 'Absent', align: 'right', render: (row) => settings.number(row.absent) },
      { key: 'excused', header: 'Excused', align: 'right', render: (row) => settings.number(row.excused) },
      {
        key: 'percentage',
        header: 'Attendance',
        align: 'right',
        width: '110px',
        render: (row) => settings.percent(toNumber(row.percentage), 1),
      },
    ],
    [settings],
  );

  const toolbar = (
    <div className="toolbar-split">
      <DateField
        label="From"
        labelHidden
        small
        value={from}
        onChange={setFrom}
        max={to === '' ? undefined : to}
      />
      <DateField
        label="To"
        labelHidden
        small
        value={to}
        onChange={setTo}
        min={from === '' ? undefined : from}
      />
      {from !== '' || to !== '' ? (
        <Button
          size="sm"
          icon="close"
          onClick={() => {
            setFrom('');
            setTo('');
          }}
        >
          Clear range
        </Button>
      ) : null}
      <span className="toolbar-split__spacer" />
      <Button size="sm" icon="refresh" onClick={resource.reload}>
        Reload
      </Button>
    </div>
  );

  return (
    <AsyncSection
      loading={resource.loading}
      error={resource.error}
      onRetry={resource.reload}
      isEmpty={data !== null && data.sessions.length === 0 && data.students.length === 0}
      emptyIcon="calendar"
      emptyTitle="No attendance recorded yet"
      emptyMessage={
        from !== '' || to !== ''
          ? 'No session in this date range has been marked for this group.'
          : 'Once a teacher submits a register for this group, the rates and sessions appear here.'
      }
      loadingRows={5}
    >
      {data === null ? null : (
        <div className="section-stack">
          <div className="kpi-grid">
            <StatCard
              label="Attendance rate"
              icon="checkCircle"
              value={settings.percent(toNumber(data.totals.percentage), 1)}
              hint="Present + late over counted marks"
            />
            <StatCard
              label="Sessions"
              icon="calendar"
              value={settings.number(data.sessions.length)}
              hint={`${settings.number(marked)} marks recorded`}
            />
            <StatCard label="Present" icon="check" value={settings.number(data.totals.present)} />
            <StatCard label="Late" icon="schedule" value={settings.number(data.totals.late)} />
            <StatCard label="Absent" icon="alert" value={settings.number(data.totals.absent)} />
            <StatCard label="Excused" icon="info" value={settings.number(data.totals.excused)} />
          </div>

          <Card title="Mark distribution" subtitle="Every counted mark in the current selection.">
            <DonutChart
              data={donutData}
              centerLabel="Marks"
              centerValue={settings.number(marked)}
              formatValue={(value) => settings.number(value)}
              emptyTitle="Nothing to chart yet"
              emptyHint="Marks appear once a register has been submitted."
            />
          </Card>

          <Card
            flush
            title="Sessions"
            subtitle="Newest first — open a session in the Attendance module to see or amend the register."
          >
            <Table<GroupAttendanceDateRow>
              columns={sessionColumns}
              rows={data.sessions}
              rowKey={(row) => row.session}
              paginated={data.sessions.length > 25}
              initialPageSize={25}
              dense
              stickyHeader
              toolbar={toolbar}
              caption="Group sessions"
              emptyIcon="calendar"
              emptyTitle="No sessions"
              emptyMessage="No attendance session has been created for this group in this range."
            />
          </Card>

          <Card
            flush
            title="Per student"
            subtitle="Worst attendance first, so the students who need a call home are at the top."
          >
            <Table<GroupAttendanceStudentRow>
              columns={studentColumns}
              rows={data.students}
              rowKey={(row) => row.student}
              paginated={data.students.length > 25}
              initialPageSize={25}
              dense
              caption="Attendance by student"
              emptyIcon="students"
              emptyTitle="No marks yet"
              emptyMessage="Marks recorded for this group's students will be summarised here."
            />
          </Card>
        </div>
      )}
    </AsyncSection>
  );
}

export default GroupAttendanceTab;
