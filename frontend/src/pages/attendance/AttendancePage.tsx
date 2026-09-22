import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DateField,
  EmptyState,
  ErrorState,
  LoadingState,
  SearchInput,
  Select,
  StatCard,
  StatusBadge,
  Table,
  type TableColumn,
} from '../../components';
import { useAuth } from '../../auth/AuthContext';
import { useSettings } from '../../settings/SettingsContext';
import { errorMessage } from '../../types';
import { humanise, startOfMonthIso, toIsoDate } from '../../utils/format';
import {
  absenceWatchlist,
  groupOptions,
  groupSchedule,
  markSheet,
  openSheet,
  submitSheet,
  toNumber,
  todayAttendance,
  useApiQuery,
  weekdayIndex,
} from './api';
import type {
  AbsenceWatchRow,
  AttendanceSessionRow,
  AttendanceSheet,
  AttendanceStatusValue,
  DraftRow,
  GroupOption,
  RosterRow,
  MarkRecord,
} from './types';
import './attendance.css';

/** Status buttons always render in this order, with the server's labels. */
const STATUS_ORDER: AttendanceStatusValue[] = ['present', 'absent', 'late', 'excused'];

type TabKey = 'sheet' | 'today' | 'absences';

function draftsFromRoster(roster: RosterRow[]): Record<number, DraftRow> {
  const out: Record<number, DraftRow> = {};
  for (const row of roster) {
    out[row.student] = {
      student: row.student,
      status: row.status ?? '',
      reason: row.reason,
      note: row.note,
    };
  }
  return out;
}

interface SheetSeed {
  group: number | null;
  date: string;
  slot: number | null;
  nonce: number;
}

interface ConfirmRequest {
  message: string;
  run: () => void;
}

/** The teacher's marking workflow: pick a group + date, mark, save. */
function SheetTab({
  groups,
  canManage,
  seed,
  onDirtyChange,
}: {
  groups: GroupOption[];
  canManage: boolean;
  seed: SheetSeed;
  onDirtyChange: (dirty: boolean) => void;
}): ReactNode {
  const { percent, date: formatDate, dateTime } = useSettings();

  const [selection, setSelection] = useState<{ group: number | null; date: string; slot: number | null }>({
    group: seed.group,
    date: seed.date,
    slot: seed.slot,
  });
  const [sheet, setSheet] = useState<AttendanceSheet | null>(null);
  const [drafts, setDrafts] = useState<Record<number, DraftRow>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmRequest | null>(null);
  const [groupFilter, setGroupFilter] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);

  // External navigation into the sheet (Today tab, calendar, deep links).
  useEffect(() => {
    setSelection({ group: seed.group, date: seed.date, slot: seed.slot });
  }, [seed.nonce, seed.group, seed.date, seed.slot]);

  const sheetQuery = useApiQuery(
    () => openSheet({ group: selection.group ?? 0, date: selection.date, slot: selection.slot }),
    [selection.group, selection.date, selection.slot],
    selection.group !== null && selection.date !== '',
  );

  const slotsQuery = useApiQuery(
    () => groupSchedule(selection.group ?? 0),
    [selection.group],
    selection.group !== null,
  );

  const slots = slotsQuery.data ?? [];
  const slotsForDay = useMemo(
    () => slots.filter((slot) => slot.weekday === weekdayIndex(selection.date)),
    [slots, selection.date],
  );

  // A slot from another weekday must not stay selected.
  useEffect(() => {
    if (selection.slot === null) return;
    if (slotsForDay.some((slot) => slot.id === selection.slot)) return;
    setSelection((prev) => ({ ...prev, slot: null }));
  }, [slotsForDay, selection.slot]);

  // Adopt every payload the server sends (open, save, submit).
  useEffect(() => {
    const payload = sheetQuery.data;
    if (payload === null) return;
    setSheet(payload);
    setDrafts(draftsFromRoster(payload.roster));
    setNotice(null);
    setActiveIndex(0);
  }, [sheetQuery.data]);

  const dirty = useMemo(() => {
    if (sheet === null) return false;
    return sheet.roster.some((row) => {
      const draft = drafts[row.student];
      if (draft === undefined) return false;
      return (
        draft.status !== (row.status ?? '') ||
        draft.reason !== row.reason ||
        draft.note !== row.note
      );
    });
  }, [sheet, drafts]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(
    () => () => {
      onDirtyChange(false);
    },
    [onDirtyChange],
  );

  // Never lose marks when the tab is closed or reloaded.
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const pendingCount = useMemo(() => {
    if (sheet === null) return 0;
    return sheet.roster.filter((row) => (drafts[row.student]?.status ?? '') === '').length;
  }, [sheet, drafts]);

  const records = useMemo<MarkRecord[]>(() => {
    if (sheet === null) return [];
    const out: MarkRecord[] = [];
    for (const row of sheet.roster) {
      const draft = drafts[row.student];
      if (draft === undefined || draft.status === '') continue;
      const entry: MarkRecord = { student: draft.student, status: draft.status };
      const note = draft.note.trim();
      if (note !== '') entry.note = note;
      if (draft.status === 'absent' || draft.status === 'excused') {
        if (draft.reason !== '') entry.reason = draft.reason;
      }
      out.push(entry);
    }
    return out;
  }, [sheet, drafts]);

  const setStatus = useCallback((student: number, status: AttendanceStatusValue) => {
    setDrafts((prev) => {
      const draft = prev[student];
      if (draft === undefined) return prev;
      const keepsReason = status === 'absent' || status === 'excused';
      return {
        ...prev,
        [student]: { ...draft, status, reason: keepsReason ? draft.reason : '' },
      };
    });
  }, []);

  const changeDraft = useCallback((student: number, patch: Partial<DraftRow>) => {
    setDrafts((prev) => {
      const draft = prev[student];
      if (draft === undefined) return prev;
      return { ...prev, [student]: { ...draft, ...patch } };
    });
  }, []);

  const markAllPresentDraft = useCallback(() => {
    setDrafts((prev) => {
      const next: Record<number, DraftRow> = {};
      for (const key of Object.keys(prev)) {
        const draft = prev[Number(key)];
        if (draft === undefined) continue;
        next[draft.student] = { ...draft, status: 'present', reason: '' };
      }
      return next;
    });
  }, []);

  const save = useCallback(
    async (submit: boolean): Promise<void> => {
      if (sheet === null || records.length === 0) return;
      setSaving(true);
      setSaveError(null);
      setNotice(null);
      try {
        const payload = await markSheet(sheet.session.id, records, submit);
        setSheet(payload);
        setDrafts(draftsFromRoster(payload.roster));
        setNotice(
          submit
            ? `Saved and submitted ${records.length} mark(s).`
            : `Saved ${records.length} mark(s).`,
        );
      } catch (cause) {
        setSaveError(cause);
      } finally {
        setSaving(false);
      }
    },
    [sheet, records],
  );

  const submitWithoutChanges = useCallback(async (): Promise<void> => {
    if (sheet === null) return;
    setSaving(true);
    setSaveError(null);
    setNotice(null);
    try {
      const payload = await submitSheet(sheet.session.id);
      setSheet(payload);
      setDrafts(draftsFromRoster(payload.roster));
      setNotice('Attendance submitted.');
    } catch (cause) {
      setSaveError(cause);
    } finally {
      setSaving(false);
    }
  }, [sheet]);

  /** Anything that replaces the loaded sheet must be confirmed while dirty. */
  const applySelection = useCallback(
    (patch: Partial<{ group: number | null; date: string; slot: number | null }>): void => {
      if (!dirty) {
        setSelection((prev) => ({ ...prev, ...patch }));
        return;
      }
      setPendingConfirm({
        message: 'This sheet has unsaved marks. Opening another sheet will discard them.',
        run: () => setSelection((prev) => ({ ...prev, ...patch })),
      });
    },
    [dirty],
  );

  // Keyboard marking: arrows move the active row, 1-4 / p,a,l,e set the status.
  useEffect(() => {
    if (sheet === null || !canManage) return undefined;
    const handler = (event: KeyboardEvent): void => {
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const rows = sheet.roster;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) => {
          const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
          return Math.max(0, Math.min(rows.length - 1, next));
        });
        return;
      }
      const map: Record<string, AttendanceStatusValue> = {
        '1': 'present',
        '2': 'absent',
        '3': 'late',
        '4': 'excused',
        p: 'present',
        a: 'absent',
        l: 'late',
        e: 'excused',
      };
      const status = map[event.key.toLowerCase()];
      if (status === undefined) return;
      const row = rows[activeIndex];
      if (row === undefined) return;
      event.preventDefault();
      setStatus(row.student, status);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [sheet, canManage, activeIndex, setStatus]);

  useEffect(() => {
    const row = rowRefs.current[activeIndex];
    if (row !== undefined && row !== null) row.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const filteredGroups = useMemo(() => {
    const needle = groupFilter.trim().toLowerCase();
    if (needle === '') return groups;
    return groups.filter((group) => {
      const haystack = [group.name, group.course_name ?? '', group.teacher_name ?? '']
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [groups, groupFilter]);

  const statusOptions = useMemo(() => {
    if (sheet === null) return [];
    return STATUS_ORDER.map((value) => {
      const found = sheet.statuses.find((entry) => entry.value === value);
      return { value, label: found?.label ?? humanise(value) };
    });
  }, [sheet]);

  return (
    <div className="u-stack">
      <div className="att-picker">
        <div className="att-picker__field">
          <SearchInput
            value={groupFilter}
            onChange={setGroupFilter}
            placeholder="Filter groups…"
            label="Filter groups"
            small
          />
        </div>
        <div className="att-picker__field">
          <Select
            label="Group"
            required
            placeholder="Select a group"
            options={filteredGroups.map((group) => ({
              value: group.id,
              label:
                group.course_name === undefined || group.course_name === ''
                  ? group.name
                  : `${group.name} · ${group.course_name}`,
            }))}
            value={selection.group ?? ''}
            onChange={(value) => applySelection({ group: value === '' ? null : value })}
            hint={
              groups.length === 0
                ? 'No groups are assigned to you.'
                : `${filteredGroups.length} of ${groups.length} groups`
            }
          />
        </div>
        <div className="att-picker__field">
          <DateField
            label="Date"
            required
            value={selection.date}
            onChange={(value) => applySelection({ date: value })}
          />
        </div>
        {slotsForDay.length > 0 ? (
          <div className="att-picker__field">
            <Select
              label="Slot (optional)"
              placeholder="Whole day"
              options={slotsForDay.map((slot) => ({
                value: slot.id,
                label: `${slot.start_time}–${slot.end_time}${slot.room === '' ? '' : ` · ${slot.room}`}`,
              }))}
              value={selection.slot ?? ''}
              onChange={(value) => applySelection({ slot: value === '' ? null : value })}
            />
          </div>
        ) : null}
      </div>

      {!canManage ? (
        <div className="alert alert--info">
          <div className="alert__content">
            <span className="alert__title">Read-only</span>
            <span>
              Marking attendance needs the <code>attendance.manage</code> permission. You can still
              review sheets.
            </span>
          </div>
        </div>
      ) : null}

      {selection.group === null ? (
        <Card>
          <EmptyState
            icon="clipboard"
            title="Pick a group to open its sheet"
            message="Choose a group and a date; the sheet is opened (or re-opened) straight from the server."
          />
        </Card>
      ) : null}

      {selection.group !== null && sheetQuery.loading && sheet === null ? (
        <Card>
          <LoadingState label="Opening the sheet…" variant="skeleton" rows={6} />
        </Card>
      ) : null}

      {selection.group !== null && sheetQuery.error !== null && sheet === null ? (
        <Card>
          <ErrorState error={sheetQuery.error} onRetry={sheetQuery.reload} />
        </Card>
      ) : null}

      {sheet !== null && selection.group !== null ? (
        <>
          <div className={`att-bar${dirty ? ' is-dirty' : ''}`}>
            <div className="u-stack">
              <div className="u-row" style={{ flexWrap: 'wrap' }}>
                <strong>{sheet.session.group_name}</strong>
                <span className="att-meta">{formatDate(sheet.session.date)}</span>
                <StatusBadge status={sheet.session.state} />
                {dirty ? <span className="att-dirty">● Unsaved changes</span> : null}
              </div>
              <span className="att-subtle">
                {pendingCount > 0
                  ? `${pendingCount} of ${sheet.statistics.roster} students still unmarked`
                  : `All ${sheet.statistics.roster} students marked`}
                {sheet.session.teacher === null || sheet.session.teacher === ''
                  ? ''
                  : ` · Teacher: ${sheet.session.teacher}`}
                {sheet.session.submitted_at === null
                  ? ''
                  : ` · Submitted ${dateTime(sheet.session.submitted_at)}`}
              </span>
              {dirty ? (
                <span className="att-subtle">
                  The statistics below are the last saved totals and refresh after each save.
                </span>
              ) : null}
            </div>
            <div className="att-bar__actions">
              <Button icon="check" onClick={markAllPresentDraft} disabled={!canManage || saving}>
                Mark all present
              </Button>
              {!dirty && sheet.session.state !== 'submitted' ? (
                <Button
                  icon="clipboard"
                  disabled={!canManage || saving}
                  onClick={() => void submitWithoutChanges()}
                >
                  Submit sheet
                </Button>
              ) : null}
              <Button
                variant="primary"
                icon="check"
                loading={saving}
                disabled={!canManage || saving || records.length === 0}
                onClick={() => void save(false)}
              >
                Save
              </Button>
              <Button
                variant="primary"
                icon="checkCircle"
                loading={saving}
                disabled={!canManage || saving || records.length === 0}
                onClick={() => void save(true)}
              >
                Save &amp; submit
              </Button>
            </div>
          </div>

          {saveError !== null ? (
            <div className="alert alert--error" role="alert">
              <div className="alert__content">
                <span className="alert__title">Could not save the sheet</span>
                <span>{errorMessage(saveError)}</span>
              </div>
            </div>
          ) : null}

          {notice !== null ? (
            <div className="alert alert--success" role="status">
              <div className="alert__content">
                <span>{notice}</span>
              </div>
            </div>
          ) : null}

          <div className="att-stats">
            <div className="att-stat">
              <span className="att-stat__label">Roster</span>
              <span className="att-stat__value">{sheet.statistics.roster}</span>
              <span className="att-subtle">
                {sheet.statistics.marked} marked · {sheet.statistics.unmarked} unmarked
              </span>
            </div>
            <div className="att-stat att-stat--present">
              <span className="att-stat__label">Present</span>
              <span className="att-stat__value">{sheet.statistics.present}</span>
            </div>
            <div className="att-stat att-stat--absent">
              <span className="att-stat__label">Absent</span>
              <span className="att-stat__value">{sheet.statistics.absent}</span>
            </div>
            <div className="att-stat att-stat--late">
              <span className="att-stat__label">Late</span>
              <span className="att-stat__value">{sheet.statistics.late}</span>
            </div>
            <div className="att-stat att-stat--excused">
              <span className="att-stat__label">Excused</span>
              <span className="att-stat__value">{sheet.statistics.excused}</span>
            </div>
            <div className="att-stat">
              <span className="att-stat__label">Attendance</span>
              <span className="att-stat__value">
                {percent(toNumber(sheet.statistics.percentage), 1)}
              </span>
              <span className="att-subtle">present + late ÷ counted (excused excluded)</span>
            </div>
          </div>

          {sheet.roster.length === 0 ? (
            <Card>
              <EmptyState
                icon="users"
                title="No active students in this group"
                message="Enrol students in the group before marking attendance."
              />
            </Card>
          ) : (
            <div className="att-roster">
              {sheet.roster.map((row, index) => {
                const draft = drafts[row.student];
                const status = draft?.status ?? '';
                const needsReason = status === 'absent' || status === 'excused';
                return (
                  <div
                    key={row.student}
                    ref={(element) => {
                      rowRefs.current[index] = element;
                    }}
                    className={[
                      'att-row',
                      index === activeIndex ? 'is-active' : '',
                      status === '' ? 'is-unmarked' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onFocusCapture={() => setActiveIndex(index)}
                  >
                    <div className="att-row__who">
                      <span className="att-row__name">{row.student_name}</span>
                      <span className="att-row__code">{row.student_code}</span>
                    </div>

                    <div
                      className="att-row__status"
                      role="group"
                      aria-label={`Attendance for ${row.student_name}`}
                    >
                      {statusOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`att-seg att-seg--${option.value}`}
                          aria-pressed={status === option.value}
                          disabled={!canManage}
                          onClick={() => {
                            setActiveIndex(index);
                            setStatus(row.student, option.value);
                          }}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>

                    {needsReason ? (
                      <div className="att-row__extra">
                        <div className="att-row__reason">
                          <Select
                            label="Reason"
                            labelHidden
                            small
                            placeholder="Reason"
                            options={(sheet.reasons ?? []).map((reason) => ({
                              value: reason.value,
                              label: reason.label,
                            }))}
                            value={draft?.reason ?? ''}
                            disabled={!canManage}
                            onChange={(value) => changeDraft(row.student, { reason: value })}
                          />
                        </div>
                        <div className="att-row__note">
                          <input
                            className="input input--sm"
                            type="text"
                            maxLength={255}
                            placeholder="Note (optional)"
                            aria-label={`Note for ${row.student_name}`}
                            value={draft?.note ?? ''}
                            disabled={!canManage}
                            onChange={(event) => changeDraft(row.student, { note: event.target.value })}
                          />
                        </div>
                      </div>
                    ) : null}

                    {row.modified_by === null || row.modified_by === '' ? null : (
                      <span className="att-subtle" title={`Last marked by ${row.modified_by}`}>
                        {row.modified_by}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="att-keys">
            <span>
              <span className="att-kbd">↑</span> <span className="att-kbd">↓</span> move the active
              row
            </span>
            <span>
              <span className="att-kbd">1</span> present · <span className="att-kbd">2</span> absent ·{' '}
              <span className="att-kbd">3</span> late · <span className="att-kbd">4</span> excused
            </span>
          </div>
        </>
      ) : null}

      <ConfirmDialog
        open={pendingConfirm !== null}
        title="Discard unsaved marks?"
        message={pendingConfirm?.message ?? ''}
        confirmLabel="Discard and continue"
        cancelLabel="Keep editing"
        tone="danger"
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          const request = pendingConfirm;
          setPendingConfirm(null);
          request?.run();
        }}
      />
    </div>
  );
}

/** Today: centre totals, every sheet opened today and the incomplete ones. */
function TodayTab({ onOpenSheet }: { onOpenSheet: (group: number, date: string) => void }): ReactNode {
  const { percent, dateTime, date: formatDate } = useSettings();
  const query = useApiQuery(() => todayAttendance(), []);
  const payload = query.data;

  const columns: Array<TableColumn<AttendanceSessionRow>> = [
    {
      key: 'group',
      header: 'Group',
      sortValue: (row) => row.group_name,
      render: (row) => (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => onOpenSheet(row.group, row.date)}
        >
          {row.group_name}
        </button>
      ),
    },
    { key: 'course', header: 'Course', render: (row) => row.course_name || '—' },
    { key: 'teacher', header: 'Teacher', render: (row) => row.teacher_name || '—' },
    {
      key: 'state',
      header: 'State',
      sortValue: (row) => row.state,
      render: (row) => <StatusBadge status={row.state} />,
    },
    {
      key: 'marked',
      header: 'Marked',
      align: 'right',
      sortValue: (row) => row.marked,
      render: (row) => `${row.marked} / ${row.roster}`,
    },
    {
      key: 'submitted',
      header: 'Submitted',
      render: (row) => (row.submitted_at === null ? '—' : dateTime(row.submitted_at)),
    },
  ];

  return (
    <div className="u-stack">
      {query.error !== null ? <ErrorState error={query.error} onRetry={query.reload} /> : null}

      {payload === null && query.loading ? (
        <Card>
          <LoadingState label="Loading today's attendance…" variant="skeleton" rows={5} />
        </Card>
      ) : null}

      {payload !== null ? (
        <>
          <div className="kpi-grid">
            <StatCard label="Attendance today" value={percent(toNumber(payload.totals.percentage), 1)} icon="clipboard" hint={formatDate(payload.date)} />
            <StatCard label="Present" value={payload.totals.present} icon="check" />
            <StatCard label="Absent" value={payload.totals.absent} icon="alert" />
            <StatCard label="Late" value={payload.totals.late} icon="schedule" />
            <StatCard label="Excused" value={payload.totals.excused} icon="info" />
            <StatCard label="Marks recorded" value={payload.totals.marked} icon="table" />
          </div>

          <Card
            title="Sheets opened today"
            subtitle={`${payload.sessions.length} sheet(s) for ${formatDate(payload.date)}`}
            flush
          >
            <Table
              columns={columns}
              rows={payload.sessions}
              rowKey={(row) => row.id}
              paginated={false}
              dense
              emptyTitle="No attendance sheets today"
              emptyMessage="Open a sheet from the Attendance tab, or check the timetable."
              actions={(row) => (
                <Button size="sm" onClick={() => onOpenSheet(row.group, row.date)}>
                  Open sheet
                </Button>
              )}
              actionsHeader=""
            />
          </Card>

          <Card
            title="Not submitted"
            subtitle="Groups that had a class today without a submitted sheet"
          >
            {payload.incomplete.length === 0 ? (
              <EmptyState
                icon="checkCircle"
                title="Everything is submitted"
                message="Every class scheduled for today has a submitted attendance sheet."
              />
            ) : (
              <div className="att-pending">
                {payload.incomplete.map((entry) => (
                  <div className="att-pending__row" key={`${entry.group}-${entry.state}`}>
                    <div className="u-stack">
                      <span className="att-pending__group">{entry.group_name}</span>
                      <span className="att-subtle">
                        {entry.time} · {humanise(entry.state)}
                      </span>
                    </div>
                    <div className="u-row">
                      <Badge tone={entry.state === 'missing' ? 'danger' : 'warning'}>
                        {humanise(entry.state)}
                      </Badge>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => onOpenSheet(entry.group, entry.date)}
                      >
                        Open sheet
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}

/** Repeated-absence watch list, driven by the centre's alert thresholds. */
function AbsencesTab(): ReactNode {
  const { date: formatDate, settings } = useSettings();
  const [dateFrom, setDateFrom] = useState(startOfMonthIso());
  const [dateTo, setDateTo] = useState(toIsoDate());

  const query = useApiQuery(
    () => absenceWatchlist(dateFrom, dateTo),
    [dateFrom, dateTo],
    dateFrom !== '' && dateTo !== '',
  );
  const rows = query.data?.results ?? [];

  const columns: Array<TableColumn<AbsenceWatchRow>> = [
    {
      key: 'student',
      header: 'Student',
      sortValue: (row) => row.student_name,
      render: (row) => (
        <div className="u-stack" style={{ gap: 0 }}>
          <span>{row.student_name}</span>
          <span className="att-row__code">{row.student_code}</span>
        </div>
      ),
    },
    {
      key: 'absences',
      header: 'Absences',
      align: 'right',
      sortValue: (row) => row.absences,
      render: (row) => row.absences,
    },
    {
      key: 'streak',
      header: 'Current streak',
      align: 'right',
      sortValue: (row) => row.streak,
      render: (row) => row.streak,
    },
    {
      key: 'reason',
      header: 'Trigger',
      sortValue: (row) => row.reason,
      render: (row) => (
        <Badge tone={row.reason === 'streak' ? 'danger' : 'warning'} dot>
          {row.reason === 'streak' ? 'Consecutive absences' : 'Absence count'}
        </Badge>
      ),
    },
    {
      key: 'period',
      header: 'Period',
      render: (row) => `${formatDate(row.from)} – ${formatDate(row.to)}`,
    },
  ];

  return (
    <div className="u-stack">
      <div className="att-toolbar">
        <div className="att-picker__field">
          <DateField label="From" value={dateFrom} onChange={setDateFrom} />
        </div>
        <div className="att-picker__field">
          <DateField label="To" value={dateTo} onChange={setDateTo} />
        </div>
        <Button icon="refresh" onClick={query.reload} loading={query.loading}>
          Refresh
        </Button>
      </div>

      <div className="alert alert--info">
        <div className="alert__content">
          <span>
            Alert thresholds from the centre settings: {settings.absence_alert_count} absence(s) or{' '}
            {settings.absence_streak_alert_count} in a row.
          </span>
        </div>
      </div>

      <Card
        title="Repeated absences"
        subtitle={`${rows.length} student(s) over the selected period`}
        flush
      >
        <Table
          columns={columns}
          rows={rows}
          rowKey={(row) => row.student}
          loading={query.loading}
          error={query.error}
          onRetry={query.reload}
          paginated={false}
          emptyTitle="No repeated absences"
          emptyMessage="No student crossed the configured absence thresholds in this period."
        />
      </Card>
    </div>
  );
}

export function AttendancePage(): ReactNode {
  const { hasPerm } = useAuth();
  const [searchParams] = useSearchParams();
  const canManage = hasPerm('attendance.manage');

  const groupsQuery = useApiQuery(() => groupOptions(), []);
  const groups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data]);

  const today = useMemo(() => toIsoDate(), []);
  const initialGroup = useMemo(() => {
    const raw = searchParams.get('group');
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }, [searchParams]);

  const [tab, setTab] = useState<TabKey>(initialGroup === null ? 'today' : 'sheet');
  const [sheetDirty, setSheetDirty] = useState(false);
  /** A navigation the user asked for while the sheet had unsaved marks. */
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [seed, setSeed] = useState<SheetSeed>({
    group: initialGroup,
    date: searchParams.get('date') ?? today,
    slot: null,
    nonce: 0,
  });

  const handleDirtyChange = useCallback((dirty: boolean) => setSheetDirty(dirty), []);

  /** Run now, or only after the user confirms that unsaved marks are lost. */
  const guard = useCallback(
    (run: () => void): void => {
      if (!sheetDirty) {
        run();
        return;
      }
      // Wrapped so React treats it as a value, not as a state updater.
      setPendingAction(() => run);
    },
    [sheetDirty],
  );

  const openSheetFor = useCallback(
    (group: number, date: string) => {
      guard(() => {
        setSeed((prev) => ({ group, date, slot: null, nonce: prev.nonce + 1 }));
        setTab('sheet');
      });
    },
    [guard],
  );

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'sheet', label: 'Mark attendance' },
    { key: 'today', label: 'Today' },
    { key: 'absences', label: 'Absences' },
  ];

  const selectTab = (next: TabKey): void => {
    if (next === tab) return;
    guard(() => setTab(next));
  };

  return (
    <div>
      <header className="page-header">
        <div className="page-header__heading">
          <h1 className="page-header__title">Attendance</h1>
          <p className="page-header__subtitle">
            Open a group's sheet, mark the class and submit it. Totals and percentages are computed
            by the server.
          </p>
        </div>
      </header>

      <div className="att-tabs" role="tablist" aria-label="Attendance views">
        {tabs.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={tab === entry.key}
            className={`att-tab${tab === entry.key ? ' is-active' : ''}`}
            onClick={() => selectTab(entry.key)}
          >
            {entry.label}
            {entry.key === 'sheet' && sheetDirty ? ' •' : ''}
          </button>
        ))}
      </div>

      {groupsQuery.error !== null ? (
        <div className="alert alert--error" role="alert">
          <div className="alert__content">
            <span>{errorMessage(groupsQuery.error)}</span>
          </div>
        </div>
      ) : null}

      {tab === 'sheet' ? (
        <SheetTab
          groups={groups}
          canManage={canManage}
          seed={seed}
          onDirtyChange={handleDirtyChange}
        />
      ) : null}

      {tab === 'today' ? <TodayTab onOpenSheet={openSheetFor} /> : null}
      {tab === 'absences' ? <AbsencesTab /> : null}

      <ConfirmDialog
        open={pendingAction !== null}
        title="Leave without saving?"
        message="This sheet has unsaved attendance marks. Switching view now will discard them."
        confirmLabel="Discard marks"
        cancelLabel="Stay here"
        tone="danger"
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
          const run = pendingAction;
          setPendingAction(null);
          if (run !== null) run();
        }}
      />
    </div>
  );
}

export default AttendancePage;
