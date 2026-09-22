/**
 * Group profile - Schedule tab.
 *
 * GET /api/groups/{id}/schedule/ returns the group's recurring weekly slots
 * (already ordered by weekday and start time). Everything rendered here comes
 * from those rows - the weekly board, the totals and the table. Durations are
 * the only derived value, and they are a straight subtraction of the two times
 * the server sent.
 */

import { useMemo, useState } from 'react';
import { Button, Card, Select, StatCard, Table, type TableColumn } from '../../components';
import { useSettings } from '../../settings/SettingsContext';
import { groupsApi, type Group, type GroupScheduleSlot } from '../students/api';
import { useAsyncResource } from '../students/hooks';
import { AsyncSection, DataField } from '../students/ui';

export interface GroupScheduleTabProps {
  group: Group;
}

function toMinutes(time: string): number {
  const [rawHours, rawMinutes] = time.split(':');
  const hours = Number(rawHours);
  const minutes = Number(rawMinutes);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return hours * 60 + minutes;
}

/** "90" -> "1 h 30 min"; a plain subtraction of the two boundary times. */
function minutesLabel(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}

function durationLabel(start: string, end: string): string {
  return minutesLabel(Math.max(0, toMinutes(end) - toMinutes(start)));
}

export function GroupScheduleTab({ group }: GroupScheduleTabProps) {
  const settings = useSettings();
  const [weekday, setWeekday] = useState<number | ''>('');

  const resource = useAsyncResource(() => groupsApi.schedule(group.id), `group-schedule:${group.id}`);
  const slots = useMemo(() => resource.data ?? [], [resource.data]);

  const weekdays = useMemo(() => {
    const seen = new Map<number, string>();
    for (const slot of slots) seen.set(slot.weekday, slot.weekday_name);
    return [...seen.entries()].sort((left, right) => left[0] - right[0]);
  }, [slots]);

  const visible = useMemo(
    () => (weekday === '' ? slots : slots.filter((slot) => slot.weekday === weekday)),
    [slots, weekday],
  );

  const weeklyMinutes = useMemo(
    () => slots.reduce((total, slot) => total + Math.max(0, toMinutes(slot.end_time) - toMinutes(slot.start_time)), 0),
    [slots],
  );

  const rooms = useMemo(
    () => new Set(slots.map((slot) => slot.room).filter((room) => room !== '')),
    [slots],
  );

  const teachers = useMemo(
    () => new Set(slots.map((slot) => slot.teacher).filter((teacher) => teacher !== '')),
    [slots],
  );

  const columns = useMemo<ReadonlyArray<TableColumn<GroupScheduleSlot>>>(
    () => [
      { key: 'weekday_name', header: 'Day', width: '130px', render: (row) => row.weekday_name },
      {
        key: 'start_time',
        header: 'Time',
        width: '150px',
        render: (row) => (
          <span className="u-nowrap u-mono">
            {row.start_time}–{row.end_time}
          </span>
        ),
      },
      {
        key: 'duration',
        header: 'Duration',
        align: 'right',
        width: '110px',
        render: (row) => durationLabel(row.start_time, row.end_time),
      },
      {
        key: 'teacher',
        header: 'Teacher',
        render: (row) => row.teacher || <span className="u-subtle">Not set</span>,
      },
      {
        key: 'room',
        header: 'Room',
        render: (row) => row.room || <span className="u-subtle">Not set</span>,
      },
      {
        key: 'effective_from',
        header: 'Runs from',
        width: '130px',
        render: (row) => <span className="u-nowrap">{settings.date(row.effective_from)}</span>,
      },
      {
        key: 'effective_to',
        header: 'Until',
        width: '130px',
        render: (row) =>
          row.effective_to === null ? (
            <span className="u-subtle">Open ended</span>
          ) : (
            <span className="u-nowrap">{settings.date(row.effective_to)}</span>
          ),
      },
    ],
    [settings],
  );

  const toolbar = (
    <div className="toolbar-split">
      <Select<number>
        label="Day"
        labelHidden
        small
        placeholder="Every day"
        options={weekdays.map(([value, label]) => ({ value, label }))}
        value={weekday}
        onChange={(value) => setWeekday(value)}
      />
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
      isEmpty={resource.data !== null && slots.length === 0}
      emptyIcon="schedule"
      emptyTitle="No weekly slots yet"
      emptyMessage="This group has no recurring timetable yet. Add slots in the Timetable module and they appear here."
      loadingRows={5}
    >
      <div className="section-stack">
        <div className="kpi-grid">
          <StatCard
            label="Slots per week"
            icon="schedule"
            value={settings.number(slots.length)}
            hint={slots.length === 1 ? 'One recurring class' : 'Recurring classes'}
          />
          <StatCard
            label="Teaching time"
            icon="calendar"
            value={minutesLabel(weeklyMinutes)}
            hint="Every slot, per week"
          />
          <StatCard label="Rooms used" icon="academic" value={settings.number(rooms.size)} />
          <StatCard label="Teachers" icon="teachers" value={settings.number(teachers.size)} />
        </div>

        <Card title="Weekly pattern" subtitle="One line per recurring class, by day of week.">
          {weekdays.length === 0 ? (
            <p className="u-subtle">No slots to lay out.</p>
          ) : (
            <div className="meta-grid">
              {weekdays.map(([value, label]) => (
                <DataField key={value} label={label}>
                  <span className="cell-stack">
                    {slots
                      .filter((slot) => slot.weekday === value)
                      .map((slot) => (
                        <span className="cell-stack__primary" key={slot.id}>
                          {slot.start_time}–{slot.end_time}
                          {slot.teacher !== '' ? ` · ${slot.teacher}` : ''}
                          {slot.room !== '' ? ` · ${slot.room}` : ''}
                        </span>
                      ))}
                  </span>
                </DataField>
              ))}
            </div>
          )}
        </Card>

        <Card flush title="Slots" subtitle={`${settings.number(visible.length)} of ${settings.number(slots.length)} slots shown`}>
          <Table<GroupScheduleSlot>
            columns={columns}
            rows={visible}
            rowKey={(row) => row.id}
            paginated={visible.length > 25}
            initialPageSize={25}
            dense
            stickyHeader
            toolbar={toolbar}
            caption="Weekly slots"
            emptyIcon="schedule"
            emptyTitle="No slot on this day"
            emptyMessage="Pick another day or clear the filter to see the whole week."
          />
        </Card>
      </div>
    </AsyncSection>
  );
}

export default GroupScheduleTab;
