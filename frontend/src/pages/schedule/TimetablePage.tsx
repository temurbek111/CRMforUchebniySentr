/**
 * Timetable: the weekly grid (Mon..Sun) built from GET /api/schedule/week/.
 *
 * Slot creation, editing and deletion go straight to the API - conflicts are
 * detected server-side and arrive as field errors on the 400 response, which
 * this page renders inline (no client-side conflict logic here).
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DateField,
  Modal,
  Select,
  TextField,
} from '../../components';
import { useAuth } from '../../auth/AuthContext';
import { useSettings } from '../../settings/SettingsContext';
import { ApiError, errorMessage } from '../../types';
import { toIsoDate } from '../../utils/format';
import { AsyncSection, InlineNote } from '../students/ui';
import {
  addDaysIso,
  courseOptions,
  createSlot,
  deleteSlot,
  groupOptions,
  hoursFromMinutes,
  roomOptions,
  shortTime,
  startOfWeekIso,
  teacherOptions,
  updateSlot,
  useApiQuery,
  weekdayLabel,
  weekdayOfIso,
  weekSlots,
} from './api';
import type {
  GroupOption,
  Room,
  ScheduleSlot,
  ScheduleSlotWritePayload,
  TeacherOption,
} from './types';
import './schedule.css';

const WEEKDAYS: number[] = [0, 1, 2, 3, 4, 5, 6];

const WEEKDAY_OPTIONS = WEEKDAYS.map((index) => ({
  value: index,
  label: weekdayLabel(index, true),
}));

interface SlotFormState {
  group: number | '';
  weekday: number | '';
  start_time: string;
  end_time: string;
  teacher: number | '';
  room: number | '';
  effective_from: string;
  effective_to: string;
  note: string;
  allow_capacity_override: boolean;
}

function emptyForm(defaultWeekday: number): SlotFormState {
  return {
    group: '',
    weekday: defaultWeekday,
    start_time: '09:00',
    end_time: '10:30',
    teacher: '',
    room: '',
    effective_from: '',
    effective_to: '',
    note: '',
    allow_capacity_override: false,
  };
}

function formFromSlot(slot: ScheduleSlot): SlotFormState {
  return {
    group: slot.group,
    weekday: slot.weekday,
    start_time: shortTime(slot.start_time),
    end_time: shortTime(slot.end_time),
    teacher: slot.teacher === null ? '' : slot.teacher,
    room: slot.room === null ? '' : slot.room,
    effective_from: slot.effective_from ?? '',
    effective_to: slot.effective_to ?? '',
    note: slot.note ?? '',
    allow_capacity_override: false,
  };
}

function fieldMessages(error: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (error instanceof ApiError) {
    for (const [field, messages] of Object.entries(error.errors)) {
      out[field] = (messages ?? []).join(' ');
    }
  }
  return out;
}

/** "HH:MM" -> minutes since midnight; NaN when the field is not a valid time. */
function minutesOf(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (match === null) return Number.NaN;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return Number.NaN;
  return hours * 60 + minutes;
}

/** Create / edit form. Both flows share every field and every error slot. */
function SlotFormModal({
  open,
  slot,
  defaultWeekday,
  groups,
  teachers,
  rooms,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** null = create; otherwise the slot being edited. */
  slot: ScheduleSlot | null;
  defaultWeekday: number;
  groups: GroupOption[];
  teachers: TeacherOption[];
  rooms: Room[];
  onClose: () => void;
  onSaved: (slot: ScheduleSlot) => void;
}): ReactNode {
  const [form, setForm] = useState<SlotFormState>(() => emptyForm(defaultWeekday));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(slot === null ? emptyForm(defaultWeekday) : formFromSlot(slot));
    setErrors({});
    setSubmitting(false);
  }, [open, slot, defaultWeekday]);

  const update = (patch: Partial<SlotFormState>): void => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const submit = async (): Promise<void> => {
    const next: Record<string, string> = {};
    if (form.group === '') next.group = 'Choose a group.';
    if (form.weekday === '') next.weekday = 'Choose a weekday.';
    const start = minutesOf(form.start_time);
    const end = minutesOf(form.end_time);
    if (Number.isNaN(start)) next.start_time = 'Enter a start time as HH:MM.';
    if (Number.isNaN(end)) next.end_time = 'Enter an end time as HH:MM.';
    if (!Number.isNaN(start) && !Number.isNaN(end) && end <= start) {
      next.end_time = 'The end time must be after the start time.';
    }
    if (form.effective_from !== '' && form.effective_to !== '' && form.effective_to < form.effective_from) {
      next.effective_to = 'It cannot end before it starts.';
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const payload: ScheduleSlotWritePayload = {
      group: form.group === '' ? 0 : form.group,
      weekday: form.weekday === '' ? 0 : form.weekday,
      start_time: form.start_time.trim(),
      end_time: form.end_time.trim(),
      teacher: form.teacher === '' ? null : form.teacher,
      room: form.room === '' ? null : form.room,
      effective_from: form.effective_from === '' ? null : form.effective_from,
      effective_to: form.effective_to === '' ? null : form.effective_to,
      note: form.note.trim(),
      allow_capacity_override: form.allow_capacity_override,
    };

    setSubmitting(true);
    try {
      const saved =
        slot === null ? await createSlot(payload) : await updateSlot(slot.id, payload);
      onSaved(saved);
    } catch (cause) {
      const mapped = fieldMessages(cause);
      setErrors(
        Object.keys(mapped).length > 0 ? mapped : { non_field_errors: errorMessage(cause) },
      );
    } finally {
      setSubmitting(false);
    }
  };

  const tertiary = Object.keys(errors).filter(
    (field) => !['group', 'weekday', 'start_time', 'end_time', 'teacher', 'room', 'effective_to', 'non_field_errors'].includes(field),
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={slot === null ? 'New slot' : 'Edit slot'}
      subtitle="A slot is one recurring weekly class: a group, a weekday and a time window."
      size="lg"
      closeOnBackdrop={!submitting}
      footer={
        <>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={submitting}
            onClick={() => {
              void submit();
            }}
          >
            {slot === null ? 'Create slot' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="u-stack">
        {errors.non_field_errors !== undefined ? (
          <div className="alert alert--error" role="alert">
            <div className="alert__content">
              <span>{errors.non_field_errors}</span>
            </div>
          </div>
        ) : null}

        <div className="form-grid">
          <Select
            label="Group"
            required
            placeholder="Select a group"
            options={groups.map((entry) => ({
              value: entry.id,
              label:
                entry.course_name === undefined || entry.course_name === ''
                  ? entry.name
                  : `${entry.name} · ${entry.course_name}`,
            }))}
            value={form.group}
            onChange={(value) => update({ group: value })}
            error={errors.group}
          />
          <Select
            label="Weekday"
            required
            options={WEEKDAY_OPTIONS}
            value={form.weekday}
            onChange={(value) => update({ weekday: value })}
            error={errors.weekday}
          />
          <TextField
            label="Start time"
            required
            type="time"
            value={form.start_time}
            onChange={(value) => update({ start_time: value })}
            error={errors.start_time}
          />
          <TextField
            label="End time"
            required
            type="time"
            value={form.end_time}
            onChange={(value) => update({ end_time: value })}
            error={errors.end_time}
          />
          <Select
            label="Teacher"
            placeholder="Unassigned"
            options={teachers.map((entry) => ({ value: entry.id, label: entry.full_name }))}
            value={form.teacher}
            onChange={(value) => update({ teacher: value })}
            error={errors.teacher}
          />
          <Select
            label="Room"
            placeholder="No room"
            options={rooms.map((entry) => ({
              value: entry.id,
              label: `${entry.name} · ${entry.capacity} seats`,
            }))}
            value={form.room}
            onChange={(value) => update({ room: value })}
            error={errors.room}
          />
          <DateField
            label="Effective from"
            value={form.effective_from}
            onChange={(value) => update({ effective_from: value })}
            error={errors.effective_from}
            hint="Leave empty to start immediately."
          />
          <DateField
            label="Effective to"
            value={form.effective_to}
            onChange={(value) => update({ effective_to: value })}
            error={errors.effective_to}
            hint="Leave empty for an open-ended slot."
          />
        </div>

        <TextField
          label="Note"
          value={form.note}
          onChange={(value) => update({ note: value })}
          error={errors.note}
          placeholder="Anything the teacher needs to know"
        />

        <label className="u-row">
          <input
            type="checkbox"
            checked={form.allow_capacity_override}
            onChange={(event) => update({ allow_capacity_override: event.target.checked })}
          />
          <span>
            Allow booking a room below the group size
            {errors.allow_capacity_override !== undefined ? (
              <span className="field__error"> {errors.allow_capacity_override}</span>
            ) : null}
          </span>
        </label>

        {tertiary.length > 0 ? (
          <div className="alert alert--error" role="alert">
            <div className="alert__content">
              <ul className="alert__list">
                {tertiary.map((field) => (
                  <li key={field}>{errors[field]}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        <InlineNote>
          The server rejects overlapping teacher, room or group windows. Any clash is named here
          with the conflicting slot, so change the time or the teacher and save again.
        </InlineNote>
      </div>
    </Modal>
  );
}

/** Read-only detail card for one slot, with the manage actions. */
function SlotDetailModal({
  slot,
  canManage,
  onClose,
  onEdit,
  onDelete,
}: {
  slot: ScheduleSlot | null;
  canManage: boolean;
  onClose: () => void;
  onEdit: (slot: ScheduleSlot) => void;
  onDelete: (slot: ScheduleSlot) => void;
}): ReactNode {
  const { date: formatDate } = useSettings();

  return (
    <Modal
      open={slot !== null}
      onClose={onClose}
      title={slot === null ? '' : slot.group_name}
      subtitle={slot === null ? undefined : shortTime(slot.start_time) + '–' + shortTime(slot.end_time)}
      footer={
        slot === null ? undefined : (
          <>
            {canManage ? (
              <Button variant="danger" icon="trash" onClick={() => onDelete(slot)}>
                Delete
              </Button>
            ) : null}
            {canManage ? (
              <Button icon="edit" onClick={() => onEdit(slot)}>
                Edit
              </Button>
            ) : null}
            <Link className="btn btn--primary" to={`/groups/${slot.group}`}>
              Open group
            </Link>
          </>
        )
      }
    >
      {slot === null ? null : (
        <div className="u-stack">
          <div className="sch-detail">
            <div className="sch-detail__item">
              <span className="sch-detail__label">Weekday</span>
              <span className="sch-detail__value">{weekdayLabel(slot.weekday, true)}</span>
            </div>
            <div className="sch-detail__item">
              <span className="sch-detail__label">Time</span>
              <span className="sch-detail__value">
                {shortTime(slot.start_time)}–{shortTime(slot.end_time)}
              </span>
            </div>
            <div className="sch-detail__item">
              <span className="sch-detail__label">Duration</span>
              <span className="sch-detail__value">
                {slot.duration_minutes} min ({hoursFromMinutes(slot.duration_minutes)} h)
              </span>
            </div>
            <div className="sch-detail__item">
              <span className="sch-detail__label">Course</span>
              <span className="sch-detail__value">{slot.course_name === '' ? '—' : slot.course_name}</span>
            </div>
            <div className="sch-detail__item">
              <span className="sch-detail__label">Teacher</span>
              <span className="sch-detail__value">
                {slot.teacher_name === '' ? 'Unassigned' : slot.teacher_name}
              </span>
            </div>
            <div className="sch-detail__item">
              <span className="sch-detail__label">Room</span>
              <span className="sch-detail__value">
                {slot.room_name === '' ? 'No room' : slot.room_name}
              </span>
            </div>
            <div className="sch-detail__item">
              <span className="sch-detail__label">Students</span>
              <span className="sch-detail__value">{slot.student_count}</span>
            </div>
            <div className="sch-detail__item">
              <span className="sch-detail__label">Effective</span>
              <span className="sch-detail__value">
                {formatDate(slot.effective_from)}
                {slot.effective_to === null ? ' → open' : ` → ${formatDate(slot.effective_to)}`}
              </span>
            </div>
          </div>

          <div className="u-row">
            {slot.is_active ? (
              <Badge tone="success" dot>
                Active
              </Badge>
            ) : (
              <Badge tone="neutral" dot>
                Inactive
              </Badge>
            )}
          </div>

          {slot.note.trim() === '' ? null : <p className="u-muted">{slot.note}</p>}
        </div>
      )}
    </Modal>
  );
}

export function TimetablePage(): ReactNode {
  const { hasPerm } = useAuth();
  const { date: formatDate } = useSettings();
  const [searchParams, setSearchParams] = useSearchParams();

  const canView = hasPerm('schedule.view');
  const canManage = hasPerm('schedule.manage');

  const todayIso = toIsoDate();
  const todayIndex = weekdayOfIso(todayIso);

  const [weekStart, setWeekStart] = useState<string>(() => startOfWeekIso());
  const [group, setGroup] = useState<number | ''>('');
  const [teacher, setTeacher] = useState<number | ''>('');
  const [course, setCourse] = useState<number | ''>('');
  const [room, setRoom] = useState<number | ''>(() => {
    const raw = searchParams.get('room');
    if (raw === null) return '';
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : '';
  });

  const [selected, setSelected] = useState<ScheduleSlot | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduleSlot | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScheduleSlot | null>(null);

  const weekQuery = useApiQuery(
    () => weekSlots({ week_start: weekStart, teacher, room, group, course }),
    [weekStart, teacher, room, group, course],
    canView,
  );

  const groupsQuery = useApiQuery(() => groupOptions(), [], canView);
  const teachersQuery = useApiQuery(() => teacherOptions(), [], canView);
  const roomsQuery = useApiQuery(() => roomOptions(), [], canView);
  const coursesQuery = useApiQuery(() => courseOptions(), [], canView);

  const slots = useMemo(() => weekQuery.data?.slots ?? [], [weekQuery.data]);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDaysIso(weekStart, index)),
    [weekStart],
  );

  const weekContainsToday = todayIso >= weekStart && todayIso <= addDaysIso(weekStart, 6);

  const rowTimes = useMemo(() => {
    const unique = new Set<string>();
    for (const slot of slots) unique.add(shortTime(slot.start_time));
    return Array.from(unique).sort();
  }, [slots]);

  const byCell = useMemo(() => {
    const map = new Map<string, ScheduleSlot[]>();
    for (const slot of slots) {
      const key = `${slot.weekday}|${shortTime(slot.start_time)}`;
      const bucket = map.get(key);
      if (bucket === undefined) map.set(key, [slot]);
      else bucket.push(slot);
    }
    return map;
  }, [slots]);

  const hasFilters =
    group !== '' || teacher !== '' || room !== '' || course !== '';

  const changeRoom = (value: number | ''): void => {
    setRoom(value);
    const next = new URLSearchParams(searchParams);
    if (value === '') next.delete('room');
    else next.set('room', String(value));
    setSearchParams(next, { replace: true });
  };

  const clearFilters = (): void => {
    setGroup('');
    setTeacher('');
    setCourse('');
    changeRoom('');
  };

  const openCreate = (): void => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (slot: ScheduleSlot): void => {
    setSelected(null);
    setEditing(slot);
    setFormOpen(true);
  };

  const confirmDelete = async (): Promise<void> => {
    if (deleteTarget === null) return;
    await deleteSlot(deleteTarget.id);
    setDeleteTarget(null);
    setSelected(null);
    weekQuery.reload();
  };

  const defaultWeekday = weekContainsToday && todayIndex >= 0 ? todayIndex : 0;

  return (
    <div>
      <header className="page-header">
        <div className="page-header__heading">
          <h1 className="page-header__title">Timetable</h1>
          <p className="page-header__subtitle">
            The weekly grid for every group, teacher and room. Click a slot to see its details or to
            reschedule it.
          </p>
        </div>
        <div className="page-header__actions">
          <Button icon="refresh" onClick={weekQuery.reload} loading={weekQuery.loading}>
            Refresh
          </Button>
          {canManage ? (
            <Button variant="primary" icon="plus" onClick={openCreate}>
              New slot
            </Button>
          ) : null}
        </div>
      </header>

      {!canView ? (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <InlineNote tone="warning">
            Viewing the timetable needs the <code>schedule.view</code> permission.
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
            Today
          </Button>
          <Button
            size="sm"
            icon="chevronRight"
            aria-label="Next week"
            onClick={() => setWeekStart((value) => addDaysIso(value, 7))}
          />
        </div>

        <div className="sch-toolbar__field">
          <Select
            label="Group"
            placeholder="All groups"
            options={(groupsQuery.data ?? []).map((entry) => ({ value: entry.id, label: entry.name }))}
            value={group}
            onChange={setGroup}
            small
          />
        </div>
        <div className="sch-toolbar__field">
          <Select
            label="Teacher"
            placeholder="All teachers"
            options={(teachersQuery.data ?? []).map((entry) => ({
              value: entry.id,
              label: entry.full_name,
            }))}
            value={teacher}
            onChange={setTeacher}
            small
          />
        </div>
        <div className="sch-toolbar__field">
          <Select
            label="Room"
            placeholder="All rooms"
            options={(roomsQuery.data ?? []).map((entry) => ({ value: entry.id, label: entry.name }))}
            value={room}
            onChange={changeRoom}
            small
          />
        </div>
        <div className="sch-toolbar__field">
          <Select
            label="Course"
            placeholder="All courses"
            options={(coursesQuery.data ?? []).map((entry) => ({
              value: entry.id,
              label: entry.name,
            }))}
            value={course}
            onChange={setCourse}
            small
          />
        </div>
        {hasFilters ? (
          <Button size="sm" icon="close" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>

      <div className="sch-legend">
        <span>
          Week of {formatDate(weekStart)} – {formatDate(addDaysIso(weekStart, 6))}
        </span>
        <span>{slots.length} slot(s)</span>
        {weekContainsToday ? <span>Today is highlighted</span> : null}
      </div>

      <Card>
        <AsyncSection
          loading={weekQuery.loading}
          error={weekQuery.error}
          onRetry={weekQuery.reload}
          isEmpty={!weekQuery.loading && weekQuery.error === null && slots.length === 0}
          loadingRows={8}
          loadingLabel="Loading the weekly grid…"
          emptyTitle={hasFilters ? 'No slots match these filters' : 'No classes this week'}
          emptyMessage={
            hasFilters
              ? 'Clear the filters to see the whole week again.'
              : canManage
                ? 'Add the first recurring slot for a group and it will appear here every week.'
                : 'Nothing has been scheduled for this week yet.'
          }
          emptyIcon="schedule"
          emptyAction={
            hasFilters ? (
              <Button icon="close" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : canManage ? (
              <Button variant="primary" icon="plus" onClick={openCreate}>
                New slot
              </Button>
            ) : undefined
          }
        >
          <div
            className="sch-grid"
            style={{ gridTemplateColumns: 'minmax(88px, 104px) repeat(7, minmax(0, 1fr))' }}
          >
            <div className="sch-grid__head" aria-hidden="true" />
            {days.map((day, index) => (
              <div
                key={day}
                className={[
                  'sch-grid__head',
                  weekContainsToday && index === todayIndex ? 'sch-grid__head--today' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {weekdayLabel(index, true)}
              </div>
            ))}

            {rowTimes.map((time) => (
              <TimetableRow
                key={time}
                time={time}
                byCell={byCell}
                isTodayColumn={weekContainsToday ? todayIndex : -1}
                onSelect={setSelected}
              />
            ))}
          </div>
        </AsyncSection>
      </Card>

      <SlotDetailModal
        slot={selected}
        canManage={canManage}
        onClose={() => setSelected(null)}
        onEdit={openEdit}
        onDelete={(slot) => setDeleteTarget(slot)}
      />

      <SlotFormModal
        open={formOpen}
        slot={editing}
        defaultWeekday={defaultWeekday}
        groups={groupsQuery.data ?? []}
        teachers={teachersQuery.data ?? []}
        rooms={roomsQuery.data ?? []}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSaved={() => {
          setFormOpen(false);
          setEditing(null);
          weekQuery.reload();
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this slot?"
        tone="danger"
        confirmLabel="Delete slot"
        message={
          deleteTarget === null ? (
            ''
          ) : (
            <>
              <strong>{deleteTarget.group_name}</strong> on{' '}
              {weekdayLabel(deleteTarget.weekday, true)}{' '}
              {shortTime(deleteTarget.start_time)}–{shortTime(deleteTarget.end_time)} will be removed
              from the timetable. Attendance already recorded stays untouched.
            </>
          )
        }
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

/** One time row: the time label followed by the seven day cells. */
function TimetableRow({
  time,
  byCell,
  isTodayColumn,
  onSelect,
}: {
  time: string;
  byCell: Map<string, ScheduleSlot[]>;
  /** Weekday index of the highlighted column, or -1 when today is elsewhere. */
  isTodayColumn: number;
  onSelect: (slot: ScheduleSlot) => void;
}): ReactNode {
  return (
    <>
      <div className="sch-grid__time">{time}</div>
      {WEEKDAYS.map((day) => {
        const cellSlots = byCell.get(`${day}|${time}`) ?? [];
        return (
          <div
            className={['sch-cell', day === isTodayColumn ? 'sch-cell--today' : '']
              .filter(Boolean)
              .join(' ')}
            key={`${day}-${time}`}
          >
            {cellSlots.map((slot) => (
              <button
                key={slot.id}
                type="button"
                className={['sch-slot', slot.is_active ? '' : 'is-inactive'].filter(Boolean).join(' ')}
                onClick={() => onSelect(slot)}
              >
                <span className="sch-slot__group">{slot.group_name}</span>
                <span className="sch-slot__meta">
                  {shortTime(slot.start_time)}–{shortTime(slot.end_time)}
                </span>
                {slot.teacher_name === '' ? null : (
                  <span className="sch-slot__meta">{slot.teacher_name}</span>
                )}
                <span className="sch-slot__meta">
                  {slot.course_name === '' ? '' : `${slot.course_name}`}
                  {slot.room_name === '' ? '' : ` · ${slot.room_name}`}
                </span>
              </button>
            ))}
          </div>
        );
      })}
    </>
  );
}

export default TimetablePage;
