/**
 * Calendar: a day-by-day agenda of the current week.
 *
 * Today's classes come from GET /api/schedule/today/; the rest of the week
 * from GET /api/schedule/week/. Every elapsed day carries an attendance
 * indicator driven by the batch pendingForWeek() helper (one request per
 * elapsed day, never one per row).
 */

import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card } from '../../components';
import { useAuth } from '../../auth/AuthContext';
import { useSettings } from '../../settings/SettingsContext';
import { toIsoDate } from '../../utils/format';
import { AsyncSection, InlineNote } from '../students/ui';
import {
  addDaysIso,
  pendingForWeek,
  shortTime,
  startOfWeekIso,
  todaySlots,
  useApiQuery,
  weekDates,
  weekdayLabel,
  weekSlots,
} from './api';
import type { PendingByDate, ScheduleSlot } from './types';
import './schedule.css';

interface PendingResult {
  pending: PendingByDate;
  /** True when the attendance endpoint failed; the agenda still renders. */
  failed: boolean;
}

/** "submitted" / "not submitted" / "missing" for one class on one date. */
function AttendanceIndicator({
  date,
  group,
  pending,
  elapsed,
}: {
  date: string;
  group: number;
  pending: PendingByDate;
  elapsed: boolean;
}): ReactNode {
  if (!elapsed) return null;
  const bucket = pending[date];
  // No data for an elapsed day means the batch call did not include it: stay
  // silent rather than inventing a status.
  if (bucket === undefined) return null;
  const state = bucket[group];
  if (state === undefined) {
    return (
      <Badge tone="success" dot>
        Submitted
      </Badge>
    );
  }
  if (state === 'not_submitted') {
    return (
      <Badge tone="warning" dot>
        Not submitted
      </Badge>
    );
  }
  if (state === 'missing') {
    return (
      <Badge tone="danger" dot>
        Missing
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" dot>
      {state.replace(/_/g, ' ')}
    </Badge>
  );
}

export function CalendarPage(): ReactNode {
  const { hasPerm } = useAuth();
  const { date: formatDate } = useSettings();

  const canView = hasPerm('schedule.view');
  const todayIso = toIsoDate();

  const [weekStart, setWeekStart] = useState<string>(() => startOfWeekIso());
  const isCurrentWeek = weekStart === startOfWeekIso(todayIso);

  const weekQuery = useApiQuery(() => weekSlots({ week_start: weekStart }), [weekStart], canView);
  const todayQuery = useApiQuery(() => todaySlots(), [], canView && isCurrentWeek);

  const pendingQuery = useApiQuery<PendingResult>(
    async () => {
      try {
        return { pending: await pendingForWeek(weekStart), failed: false };
      } catch {
        return { pending: {}, failed: true };
      }
    },
    [weekStart],
    canView,
  );

  const weekSlotsList = useMemo(() => weekQuery.data?.slots ?? [], [weekQuery.data]);
  const pending = pendingQuery.data?.pending ?? {};
  const pendingFailed = pendingQuery.data?.failed ?? false;

  const dates = useMemo(() => weekDates(weekStart), [weekStart]);

  const totalSlots = useMemo(() => {
    if (!isCurrentWeek) return weekSlotsList.length;
    // Today's rows replace the week-derived ones, so the count stays exact.
    const todayWeekday = dates.indexOf(todayIso);
    if (todayWeekday < 0 || todayQuery.data === null) return weekSlotsList.length;
    const others = weekSlotsList.filter((slot) => slot.weekday !== todayWeekday).length;
    return others + todayQuery.data.length;
  }, [isCurrentWeek, weekSlotsList, dates, todayIso, todayQuery.data]);

  const slotsForDate = (date: string, weekday: number): ScheduleSlot[] => {
    if (isCurrentWeek && date === todayIso && todayQuery.data !== null) {
      return todayQuery.data;
    }
    return weekSlotsList
      .filter((slot) => slot.weekday === weekday)
      .sort((left, right) => left.start_time.localeCompare(right.start_time));
  };

  const loading = weekQuery.loading || (isCurrentWeek && todayQuery.loading);
  const error = weekQuery.error;

  return (
    <div>
      <header className="page-header">
        <div className="page-header__heading">
          <h1 className="page-header__title">Calendar</h1>
          <p className="page-header__subtitle">
            The week as a running agenda: each day with its classes, and an attendance indicator for
            every day that has already passed.
          </p>
        </div>
        <div className="page-header__actions">
          <Button
            icon="refresh"
            onClick={() => {
              weekQuery.reload();
              if (isCurrentWeek) todayQuery.reload();
              pendingQuery.reload();
            }}
            loading={weekQuery.loading}
          >
            Refresh
          </Button>
        </div>
      </header>

      {!canView ? (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <InlineNote tone="warning">
            Viewing the calendar needs the <code>schedule.view</code> permission.
          </InlineNote>
        </div>
      ) : null}

      <div className="sch-toolbar">
        <div className="sch-week-nav">
          <Button
            size="sm"
            icon="chevronLeft"
            aria-label="Previous week"
            onClick={() => setWeekStart((value) => addDaysIso(value, -7))}
          />
          <Button size="sm" onClick={() => setWeekStart(startOfWeekIso())}>
            This week
          </Button>
          <Button
            size="sm"
            icon="chevronRight"
            aria-label="Next week"
            onClick={() => setWeekStart((value) => addDaysIso(value, 7))}
          />
        </div>
      </div>

      <div className="sch-legend">
        <span>
          {formatDate(weekStart)} – {formatDate(addDaysIso(weekStart, 6))}
        </span>
        <span>{totalSlots} class(es)</span>
        {isCurrentWeek && todayQuery.data !== null ? (
          <span>Today: {todayQuery.data.length} class(es)</span>
        ) : null}
        {pendingFailed ? null : (
          <span>Attendance shown for elapsed days</span>
        )}
      </div>

      {isCurrentWeek && todayQuery.error !== null ? (
        <div style={{ marginBottom: 'var(--space-3)' }}>
          <InlineNote tone="warning">
            Today&apos;s own list could not be loaded; the week view is used instead.{' '}
            <Button size="sm" icon="refresh" onClick={todayQuery.reload}>
              Retry
            </Button>
          </InlineNote>
        </div>
      ) : null}

      {pendingFailed ? (
        <div style={{ marginBottom: 'var(--space-3)' }}>
          <InlineNote tone="warning">
            Attendance status is unavailable right now, so the indicators are hidden.{' '}
            <Button size="sm" icon="refresh" onClick={pendingQuery.reload}>
              Retry
            </Button>
          </InlineNote>
        </div>
      ) : null}

      <Card>
        <AsyncSection
          loading={loading}
          error={error}
          onRetry={weekQuery.reload}
          isEmpty={!loading && error === null && totalSlots === 0}
          loadingRows={6}
          loadingLabel="Loading the week…"
          emptyTitle="No classes this week"
          emptyMessage="Nothing is scheduled between these dates."
          emptyIcon="calendar"
        >
          <div className="sch-agenda">
            {dates.map((date, weekday) => {
              const daySlots = slotsForDate(date, weekday);
              const isToday = isCurrentWeek && date === todayIso;
              const elapsed = date <= todayIso;
              return (
                <section
                  key={date}
                  className={['sch-day', isToday ? 'sch-day--today' : ''].filter(Boolean).join(' ')}
                >
                  <header className="sch-day__head">
                    <span className="sch-day__title">
                      {weekdayLabel(weekday, true)} · {formatDate(date)}
                    </span>
                    <span className="u-row">
                      {isToday ? (
                        <Badge tone="primary" dot>
                          Today
                        </Badge>
                      ) : null}
                      {daySlots.length === 0 ? (
                        <span className="u-subtle">No classes</span>
                      ) : (
                        <span className="u-subtle">{daySlots.length} class(es)</span>
                      )}
                    </span>
                  </header>

                  {daySlots.length === 0 ? null : (
                    <div className="sch-day__body">
                      {daySlots.map((slot) => (
                        <div className="sch-entry" key={`${date}-${slot.id}`}>
                          <span className="sch-entry__time">
                            {shortTime(slot.start_time)}–{shortTime(slot.end_time)}
                          </span>
                          <Link className="sch-entry__main" to={`/groups/${slot.group}`}>
                            <span className="sch-entry__title">{slot.group_name}</span>
                            <span className="sch-entry__meta">
                              {slot.course_name === '' ? '' : slot.course_name}
                              {slot.teacher_name === '' ? '' : ` · ${slot.teacher_name}`}
                              {slot.room_name === '' ? '' : ` · ${slot.room_name}`}
                            </span>
                          </Link>
                          <span className="sch-entry__actions">
                            <AttendanceIndicator
                              date={date}
                              group={slot.group}
                              pending={pending}
                              elapsed={elapsed}
                            />
                            <Link className="btn btn--sm" to={`/groups/${slot.group}`}>
                              Open group
                            </Link>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </AsyncSection>
      </Card>
    </div>
  );
}

export default CalendarPage;
