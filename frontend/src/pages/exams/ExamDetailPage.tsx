import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  StatCard,
} from '../../components';
import { useAuth } from '../../auth/AuthContext';
import { useSettings } from '../../settings/SettingsContext';
import { errorMessage } from '../../types';
import {
  examResults,
  getExam,
  groupStudents,
  publishExam,
  saveResults,
  toNumber,
  useApiQuery,
} from './api';
import { examTypeLabel, gradeTone } from './labels';
import type {
  ExamComponent,
  GroupStudent,
  MarkSheetStudent,
  ResultEntry,
} from './types';
import './exams.css';

/** Draft cell key for a component-less (overall) exam. */
const OVERALL = 'overall';

interface DraftEntry {
  scores: Record<string, string>;
  comment: string;
}

const EMPTY_DRAFT: DraftEntry = { scores: {}, comment: '' };

function sortComponents(components: ReadonlyArray<ExamComponent>): ExamComponent[] {
  return [...components].sort((left, right) => left.order - right.order || left.id - right.id);
}

function draftFromRow(row: MarkSheetStudent | undefined, components: ExamComponent[]): DraftEntry {
  const scores: Record<string, string> = {};
  if (components.length === 0) {
    scores[OVERALL] = row?.overall_score ?? '';
  } else {
    for (const component of components) {
      scores[String(component.id)] = row?.scores[component.name] ?? '';
    }
  }
  return { scores, comment: row?.comment ?? '' };
}

export function ExamDetailPage(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const examId = Number(id);
  const validId = Number.isFinite(examId) && examId > 0;

  const { hasPerm } = useAuth();
  const { date: formatDate, amount, percent } = useSettings();
  const canManage = hasPerm('exams.manage');
  // The server accepts result batches from exams.manage; results.enter is the
  // narrower grant the UI advertises, so both open the mark sheet.
  const canEnter = hasPerm('exams.manage') || hasPerm('results.enter');

  const examQuery = useApiQuery(() => getExam(examId), [examId], validId);
  const summaryQuery = useApiQuery(() => examResults(examId), [examId], validId);

  const exam = examQuery.data;
  const summary = summaryQuery.data;

  const groupId = exam?.group ?? null;
  const rosterQuery = useApiQuery(() => groupStudents(groupId ?? 0), [groupId], groupId !== null);

  const components = useMemo(
    () => sortComponents(summary?.components ?? exam?.components ?? []),
    [summary, exam],
  );

  /** Group roster, plus any student who already has marks but left the group. */
  const roster = useMemo<GroupStudent[]>(() => {
    const base = rosterQuery.data ?? [];
    const seen = new Set(base.map((entry) => entry.student));
    const extras: GroupStudent[] = [];
    if (summary !== null) {
      for (const row of summary.students) {
        if (seen.has(row.student)) continue;
        extras.push({
          student: row.student,
          student_name: row.student_name,
          student_code: row.student_code,
        });
      }
    }
    return [...base, ...extras];
  }, [rosterQuery.data, summary]);

  const [drafts, setDrafts] = useState<Record<number, DraftEntry>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);

  // Seed the mark sheet from the server payload (and after every save).
  useEffect(() => {
    if (summary === null) return;
    const byStudent = new Map(summary.students.map((row) => [row.student, row]));
    const next: Record<number, DraftEntry> = {};
    for (const entry of roster) {
      next[entry.student] = draftFromRow(byStudent.get(entry.student), components);
    }
    setDrafts(next);
    setSaveError(null);
    setNotice(null);
  }, [summary, roster, components]);

  const dirty = useMemo(() => {
    if (summary === null) return false;
    const byStudent = new Map(summary.students.map((row) => [row.student, row]));
    for (const entry of roster) {
      const draft = drafts[entry.student];
      if (draft === undefined) continue;
      const original = draftFromRow(byStudent.get(entry.student), components);
      for (const key of Object.keys(original.scores)) {
        if ((original.scores[key] ?? '').trim() !== (draft.scores[key] ?? '').trim()) return true;
      }
      if (original.comment.trim() !== draft.comment.trim()) return true;
    }
    return false;
  }, [drafts, roster, components, summary]);

  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  /** `student:cell` -> validation message. */
  const cellErrors = useMemo(() => {
    const out: Record<string, string> = {};
    if (exam === null) return out;
    const limits: Record<string, number | null> = { [OVERALL]: toNumber(exam.max_score) };
    for (const component of components) {
      limits[String(component.id)] = toNumber(component.max_score);
    }
    for (const entry of roster) {
      const draft = drafts[entry.student];
      if (draft === undefined) continue;
      for (const [key, raw] of Object.entries(draft.scores)) {
        const text = raw.trim();
        if (text === '') continue;
        const value = Number(text);
        const cell = `${entry.student}:${key}`;
        if (!Number.isFinite(value)) {
          out[cell] = 'Not a number';
          continue;
        }
        if (value < 0) {
          out[cell] = 'Cannot be negative';
          continue;
        }
        const max = limits[key] ?? null;
        if (max !== null && value > max) out[cell] = `Maximum is ${max}`;
      }
    }
    return out;
  }, [drafts, roster, components, exam]);

  const invalidCells = Object.keys(cellErrors).length;

  const entries = useMemo<ResultEntry[]>(() => {
    const out: ResultEntry[] = [];
    const hasComponents = components.length > 0;
    for (const entry of roster) {
      const draft = drafts[entry.student];
      if (draft === undefined) continue;
      const comment = draft.comment.trim();
      const keys = hasComponents ? components.map((component) => String(component.id)) : [OVERALL];
      let commentAttached = false;
      for (const key of keys) {
        const raw = (draft.scores[key] ?? '').trim();
        if (raw === '') continue;
        const result: ResultEntry = {
          student: entry.student,
          component: hasComponents ? Number(key) : null,
          score: raw,
        };
        if (!commentAttached && comment !== '') {
          result.teacher_comment = comment;
          commentAttached = true;
        }
        out.push(result);
      }
    }
    return out;
  }, [drafts, roster, components]);

  const setScore = useCallback((student: number, key: string, value: string) => {
    setDrafts((prev) => {
      const draft = prev[student] ?? EMPTY_DRAFT;
      return { ...prev, [student]: { ...draft, scores: { ...draft.scores, [key]: value } } };
    });
  }, []);

  const setComment = useCallback((student: number, value: string) => {
    setDrafts((prev) => {
      const draft = prev[student] ?? EMPTY_DRAFT;
      return { ...prev, [student]: { ...draft, comment: value } };
    });
  }, []);

  const save = useCallback(async (): Promise<void> => {
    if (exam === null || entries.length === 0 || invalidCells > 0) return;
    setSaving(true);
    setSaveError(null);
    setNotice(null);
    try {
      const updated = await saveResults(exam.id, entries);
      summaryQuery.setData(updated);
      setNotice(`Saved ${entries.length} mark(s).`);
    } catch (cause) {
      setSaveError(cause);
    } finally {
      setSaving(false);
    }
  }, [exam, entries, invalidCells, summaryQuery]);

  if (!validId) {
    return <ErrorState error={new Error('That exam id is not valid.')} />;
  }

  const loadingFirstPaint =
    (examQuery.loading || summaryQuery.loading) && exam === null && summary === null;

  return (
    <div>
      <header className="page-header">
        <div className="page-header__heading">
          <div className="u-row">
            <Link to="/exams" className="u-muted">
              ← Exams
            </Link>
          </div>
          <h1 className="page-header__title">{exam?.name ?? 'Exam'}</h1>
          <p className="page-header__subtitle">
            {exam === null
              ? 'Loading…'
              : [
                  exam.group_name,
                  exam.course_name,
                  examTypeLabel(exam.exam_type, exam.exam_type_display),
                  formatDate(exam.date),
                ]
                  .filter((part) => part !== '')
                  .join(' · ')}
          </p>
        </div>
        <div className="page-header__actions">
          <Button icon="refresh" onClick={examQuery.reload} loading={examQuery.loading}>
            Reload
          </Button>
          {exam !== null && canManage ? (
            exam.is_published ? (
              <Badge tone="success" dot>
                Published
              </Badge>
            ) : (
              <Button
                variant="primary"
                icon="checkCircle"
                onClick={() => setConfirmPublish(true)}
                disabled={saving}
              >
                Publish results
              </Button>
            )
          ) : null}
        </div>
      </header>

      {examQuery.error !== null && exam === null ? (
        <Card>
          <ErrorState error={examQuery.error} onRetry={examQuery.reload} />
        </Card>
      ) : null}

      {loadingFirstPaint ? (
        <Card>
          <LoadingState label="Loading the mark sheet…" variant="skeleton" rows={7} />
        </Card>
      ) : null}

      {exam !== null ? (
        <>
          <div className="u-stack">
            <Card title="Exam setup">
              <div className="ex-progress__metrics">
                <div className="ex-metric">
                  <span className="ex-metric__label">Max score</span>
                  <span className="ex-metric__value">{amount(toNumber(exam.max_score), 2)}</span>
                </div>
                <div className="ex-metric">
                  <span className="ex-metric__label">Passing score</span>
                  <span className="ex-metric__value">{amount(toNumber(exam.passing_score), 2)}</span>
                </div>
                <div className="ex-metric">
                  <span className="ex-metric__label">Passing percentage</span>
                  <span className="ex-metric__value">
                    {percent(toNumber(exam.passing_percentage), 2)}
                  </span>
                </div>
                <div className="ex-metric">
                  <span className="ex-metric__label">Components</span>
                  <span className="ex-metric__value">{components.length}</span>
                </div>
                <div className="ex-metric">
                  <span className="ex-metric__label">Results recorded</span>
                  <span className="ex-metric__value">{exam.results_count}</span>
                </div>
              </div>
              {components.length > 0 ? (
                <div className="ex-evidence">
                  {components.map((component) => (
                    <div className="ex-evidence__item" key={component.id}>
                      <span className="ex-evidence__label">{component.name}</span>
                      <span className="ex-evidence__value">
                        max {amount(toNumber(component.max_score), 2)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="ex-hint" style={{ marginTop: 'var(--space-3)' }}>
                  This exam is marked with a single score per student.
                </p>
              )}
              {exam.description.trim() === '' ? null : (
                <p className="att-meta" style={{ marginTop: 'var(--space-3)' }}>
                  {exam.description}
                </p>
              )}
            </Card>

            {summary !== null ? (
              <Card title="Live statistics" subtitle="Computed by the server from the recorded marks">
                <div className="ex-stats">
                  <StatCard
                    label="Average"
                    value={percent(toNumber(summary.statistics.average_percentage), 2)}
                    icon="chartLine"
                  />
                  <StatCard
                    label="Highest"
                    value={percent(toNumber(summary.statistics.highest_percentage), 2)}
                    icon="arrowUp"
                  />
                  <StatCard
                    label="Lowest"
                    value={percent(toNumber(summary.statistics.lowest_percentage), 2)}
                    icon="arrowDown"
                  />
                  <StatCard
                    label="Pass rate"
                    value={percent(toNumber(summary.statistics.pass_rate), 2)}
                    icon="checkCircle"
                  />
                  <StatCard label="Passed" value={summary.statistics.passed_count} />
                  <StatCard label="Failed" value={summary.statistics.failed_count} />
                </div>

                {summary.statistics.below_passing.length > 0 ? (
                  <div style={{ marginTop: 'var(--space-4)' }}>
                    <h3 style={{ marginBottom: 'var(--space-2)' }}>Below passing</h3>
                    <div className="ex-below">
                      {summary.statistics.below_passing.map((row) => (
                        <div className="ex-below__row" key={row.student}>
                          <span>{row.student_name}</span>
                          <strong>{percent(toNumber(row.percentage), 2)}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </Card>
            ) : null}

            <Card
              title="Mark sheet"
              subtitle={
                components.length > 0
                  ? 'One column per component; the overall score is computed by the server on save.'
                  : 'One score per student.'
              }
              flush
            >
              {summaryQuery.loading && summary === null ? (
                <div style={{ padding: 'var(--space-4)' }}>
                  <LoadingState label="Loading marks…" variant="skeleton" rows={6} />
                </div>
              ) : null}

              {summaryQuery.error !== null && summary === null ? (
                <div style={{ padding: 'var(--space-4)' }}>
                  <ErrorState error={summaryQuery.error} onRetry={summaryQuery.reload} />
                </div>
              ) : null}

              {summary !== null && roster.length === 0 ? (
                <div style={{ padding: 'var(--space-4)' }}>
                  <EmptyState
                    icon="users"
                    title="No students to mark"
                    message="This group has no active students and no recorded marks."
                  />
                </div>
              ) : null}

              {summary !== null && roster.length > 0 ? (
                <>
                  {!canEnter ? (
                    <div style={{ padding: 'var(--space-3)' }}>
                      <div className="alert alert--info">
                        <div className="alert__content">
                          <span>
                            Mark entry needs the <code>results.enter</code> (or{' '}
                            <code>exams.manage</code>) permission. The marks below are read-only.
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="ex-scroll" style={{ padding: '0 var(--space-3) var(--space-3)' }}>
                    <table className="ex-sheet">
                      <thead>
                        <tr>
                          <th scope="col">Student</th>
                          {components.length === 0 ? (
                            <th scope="col">Score (max {amount(toNumber(exam.max_score), 2)})</th>
                          ) : (
                            components.map((component) => (
                              <th scope="col" key={component.id}>
                                {component.name}
                                <div className="ex-hint">
                                  max {amount(toNumber(component.max_score), 2)}
                                </div>
                              </th>
                            ))
                          )}
                          <th scope="col">Comment</th>
                          <th scope="col" style={{ textAlign: 'right' }}>
                            Overall
                          </th>
                          <th scope="col" style={{ textAlign: 'right' }}>
                            Grade
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {roster.map((entry) => {
                          const draft = drafts[entry.student] ?? EMPTY_DRAFT;
                          const row = summary.students.find((item) => item.student === entry.student);
                          const original = draftFromRow(row, components);
                          const cells =
                            components.length === 0
                              ? [{ key: OVERALL, label: 'score', saved: row?.overall_score ?? '' }]
                              : components.map((component) => ({
                                  key: String(component.id),
                                  label: component.name,
                                  saved: row?.scores[component.name] ?? '',
                                }));
                          const rowDirty =
                            cells.some(
                              (cell) =>
                                (draft.scores[cell.key] ?? '').trim() !==
                                (original.scores[cell.key] ?? '').trim(),
                            ) || draft.comment.trim() !== original.comment.trim();
                          return (
                            <tr key={entry.student} className={rowDirty ? 'is-dirty' : undefined}>
                              <td>
                                <div className="ex-sheet__who">
                                  <span>{entry.student_name}</span>
                                  <span className="att-row__code">{entry.student_code}</span>
                                </div>
                              </td>
                              {cells.map((cell) => {
                                const message = cellErrors[`${entry.student}:${cell.key}`];
                                if (!canEnter) {
                                  return (
                                    <td key={cell.key} className="ex-sheet__overall">
                                      {cell.saved === '' ? '—' : amount(toNumber(cell.saved), 2)}
                                    </td>
                                  );
                                }
                                return (
                                  <td
                                    key={cell.key}
                                    className={[
                                      'ex-sheet__score',
                                      message === undefined ? '' : 'ex-sheet__invalid',
                                    ]
                                      .filter(Boolean)
                                      .join(' ')}
                                  >
                                    <input
                                      className="input input--sm"
                                      type="text"
                                      inputMode="decimal"
                                      aria-label={`${entry.student_name} ${cell.label}`}
                                      value={draft.scores[cell.key] ?? ''}
                                      onChange={(event) =>
                                        setScore(entry.student, cell.key, event.target.value)
                                      }
                                    />
                                    {message === undefined ? null : (
                                      <span className="ex-sheet__error">{message}</span>
                                    )}
                                  </td>
                                );
                              })}
                              <td className="ex-sheet__comment">
                                {canEnter ? (
                                  <input
                                    className="input input--sm"
                                    type="text"
                                    placeholder="Comment"
                                    aria-label={`Comment for ${entry.student_name}`}
                                    value={draft.comment}
                                    onChange={(event) => setComment(entry.student, event.target.value)}
                                  />
                                ) : (
                                  <span className="u-muted">{row?.comment ?? '—'}</span>
                                )}
                              </td>
                              <td className="ex-sheet__overall" style={{ textAlign: 'right' }}>
                                {row === undefined
                                  ? '—'
                                  : `${amount(toNumber(row.overall_score), 2)} · ${percent(
                                      toNumber(row.overall_percentage),
                                      2,
                                    )}`}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                {row === undefined ? (
                                  '—'
                                ) : (
                                  <Badge tone={gradeTone(row.grade)}>{row.grade}</Badge>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {components.length > 0 ? (
                    <p className="ex-hint" style={{ padding: '0 var(--space-4) var(--space-3)' }}>
                      A student's comment is stored against the first component that has a score.
                    </p>
                  ) : null}

                  {canEnter ? (
                    <div
                      className="att-bar"
                      style={{ margin: 0, borderLeft: 0, borderRight: 0, borderBottom: 0 }}
                    >
                      <div className="u-stack" style={{ gap: 2 }}>
                        <span className="att-subtle">
                          {entries.length} score(s) ready to save
                          {invalidCells > 0 ? ` · ${invalidCells} cell(s) need fixing` : ''}
                        </span>
                        {dirty ? <span className="att-dirty">● Unsaved changes</span> : null}
                      </div>
                      <div className="att-bar__actions">
                        <Button
                          variant="primary"
                          icon="check"
                          loading={saving}
                          disabled={saving || invalidCells > 0 || entries.length === 0 || !dirty}
                          onClick={() => void save()}
                        >
                          Save marks
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </Card>

            {saveError !== null ? (
              <div className="alert alert--error" role="alert">
                <div className="alert__content">
                  <span className="alert__title">Could not save the marks</span>
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

            {summary !== null && summary.students.length > 0 ? (
              <Card
                title="Student results"
                subtitle="Server-computed overall score, percentage, grade and pass state"
                flush
              >
                <div className="ex-scroll" style={{ padding: '0 var(--space-3) var(--space-3)' }}>
                  <table className="ex-sheet">
                    <thead>
                      <tr>
                        <th scope="col">Student</th>
                        {components.map((component) => (
                          <th scope="col" key={component.id}>
                            {component.name}
                          </th>
                        ))}
                        <th scope="col" style={{ textAlign: 'right' }}>
                          Overall
                        </th>
                        <th scope="col" style={{ textAlign: 'right' }}>
                          Percentage
                        </th>
                        <th scope="col">Grade</th>
                        <th scope="col">Pass</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.students.map((row) => (
                        <tr key={row.student}>
                          <td>
                            <div className="ex-sheet__who">
                              <span>{row.student_name}</span>
                              <span className="att-row__code">{row.student_code}</span>
                            </div>
                          </td>
                          {components.map((component) => (
                            <td key={component.id} className="ex-sheet__overall">
                              {row.scores[component.name] === undefined
                                ? '—'
                                : amount(toNumber(row.scores[component.name]), 2)}
                            </td>
                          ))}
                          <td className="ex-sheet__overall" style={{ textAlign: 'right' }}>
                            {amount(toNumber(row.overall_score), 2)}
                          </td>
                          <td className="ex-sheet__overall" style={{ textAlign: 'right' }}>
                            {percent(toNumber(row.overall_percentage), 2)}
                          </td>
                          <td>
                            <Badge tone={gradeTone(row.grade)}>{row.grade}</Badge>
                          </td>
                          <td>
                            <Badge tone={row.passed ? 'success' : 'danger'} dot>
                              {row.passed ? 'Passed' : 'Failed'}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ) : null}
          </div>
        </>
      ) : null}

      <ConfirmDialog
        open={confirmPublish}
        title="Publish these results?"
        message={
          <>
            Publishing makes {exam?.name ?? 'this exam'} visible to everyone who can see the group
            and raises a notification. It does not change the marks themselves.
          </>
        }
        confirmLabel="Publish"
        tone="primary"
        onCancel={() => setConfirmPublish(false)}
        onConfirm={async () => {
          if (exam === null) return;
          await publishExam(exam.id);
          setConfirmPublish(false);
          examQuery.reload();
          summaryQuery.reload();
        }}
      />
    </div>
  );
}

export default ExamDetailPage;
