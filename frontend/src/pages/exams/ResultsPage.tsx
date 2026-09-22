import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  DateField,
  Icon,
  Pagination,
  SearchInput,
  Select,
  Table,
  type TableColumn,
} from '../../components';
import { useSettings } from '../../settings/SettingsContext';
import { errorMessage } from '../../types';
import { allExams, groupOptions, results, studentOptions, toNumber, useApiQuery } from './api';
import { gradeTone } from './labels';
import type { Exam, ExamResultRow, StudentOption } from './types';
import './exams.css';

type SortDirection = 'asc' | 'desc';

interface Ordering {
  field: string;
  direction: SortDirection;
}

/** Server-side sortable header (the API exposes ordering on score/percentage/created_at). */
function SortHeader({
  label,
  field,
  ordering,
  onSort,
}: {
  label: string;
  field: string;
  ordering: Ordering | null;
  onSort: (field: string) => void;
}): ReactNode {
  const active = ordering?.field === field;
  return (
    <button
      type="button"
      className={['table__sort', active ? 'is-active' : ''].filter(Boolean).join(' ')}
      onClick={() => onSort(field)}
      aria-label={`Sort by ${label}`}
    >
      <span>{label}</span>
      <span className="table__sort-icon" aria-hidden="true">
        <Icon name={active && ordering.direction === 'asc' ? 'arrowUp' : 'arrowDown'} size={12} />
      </span>
    </button>
  );
}

export function ResultsPage(): ReactNode {
  const { date: formatDate, amount, percent } = useSettings();

  const [group, setGroup] = useState<number | ''>('');
  const [exam, setExam] = useState<number | ''>('');
  const [student, setStudent] = useState<number | ''>('');
  const [grade, setGrade] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [ordering, setOrdering] = useState<Ordering | null>({ field: 'percentage', direction: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    setPage(1);
  }, [group, exam, student, grade, dateFrom, dateTo, search, pageSize, ordering]);

  const groupsQuery = useApiQuery(() => groupOptions(), []);
  const examsQuery = useApiQuery(() => allExams(), []);
  const studentsQuery = useApiQuery(() => studentOptions(group), [group]);

  const listQuery = useApiQuery(
    () =>
      results({
        group,
        exam,
        student,
        grade,
        date_from: dateFrom,
        date_to: dateTo,
        search,
        ordering: ordering === null ? undefined : `${ordering.direction === 'desc' ? '-' : ''}${ordering.field}`,
        page,
        page_size: pageSize,
      }),
    [group, exam, student, grade, dateFrom, dateTo, search, ordering, page, pageSize],
  );

  const rows = useMemo(() => listQuery.data?.results ?? [], [listQuery.data]);

  /** Server-provided thresholds, so a pass/fail badge never invents a rule. */
  const examById = useMemo(() => {
    const map = new Map<number, Exam>();
    for (const entry of examsQuery.data ?? []) map.set(entry.id, entry);
    return map;
  }, [examsQuery.data]);

  const toggleSort = (field: string): void => {
    setOrdering((prev) => {
      if (prev === null || prev.field !== field) return { field, direction: 'asc' };
      if (prev.direction === 'asc') return { field, direction: 'desc' };
      return { field, direction: 'asc' };
    });
  };

  const columns: Array<TableColumn<ExamResultRow>> = useMemo(
    () => [
      {
        key: 'student',
        header: 'Student',
        render: (row) => (
          <div className="ex-sheet__who">
            <span>{row.student_name}</span>
            <span className="att-row__code">{row.student_code}</span>
          </div>
        ),
      },
      {
        key: 'exam',
        header: 'Exam',
        render: (row) => <Link to={`/exams/${row.exam}`}>{row.exam_name}</Link>,
      },
      {
        key: 'date',
        header: 'Date',
        align: 'right',
        render: (row) => {
          const entry = examById.get(row.exam);
          return entry === undefined ? formatDate(row.created_at) : formatDate(entry.date);
        },
      },
      {
        key: 'component',
        header: 'Component',
        render: (row) => (row.component_name === '' ? 'Overall' : row.component_name),
      },
      {
        key: 'score',
        header: (
          <SortHeader label="Score" field="score" ordering={ordering} onSort={toggleSort} />
        ),
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
        header: (
          <SortHeader label="Percentage" field="percentage" ordering={ordering} onSort={toggleSort} />
        ),
        align: 'right',
        render: (row) => percent(toNumber(row.percentage), 2),
      },
      {
        key: 'grade',
        header: 'Grade',
        render: (row) => <Badge tone={gradeTone(row.grade)}>{row.grade}</Badge>,
      },
      {
        key: 'pass',
        header: 'Pass',
        render: (row) => {
          const entry = examById.get(row.exam);
          if (entry === undefined) {
            return <span className="u-subtle">—</span>;
          }
          const threshold = toNumber(entry.passing_percentage);
          const value = toNumber(row.percentage);
          if (threshold === null || value === null) {
            return <span className="u-subtle">—</span>;
          }
          const passed = value >= threshold;
          return (
            <Badge
              tone={passed ? 'success' : 'danger'}
              dot
              title={`Passing percentage ${threshold}%`}
            >
              {passed ? 'Passed' : 'Failed'}
            </Badge>
          );
        },
      },
      {
        key: 'comment',
        header: 'Comment',
        render: (row) => (row.teacher_comment.trim() === '' ? '—' : row.teacher_comment),
      },
    ],
    [amount, examById, formatDate, ordering, percent],
  );

  const gradeOptions = ['A', 'B', 'C', 'D', 'F'].map((value) => ({ value, label: value }));

  return (
    <div>
      <header className="page-header">
        <div className="page-header__heading">
          <h1 className="page-header__title">Results</h1>
          <p className="page-header__subtitle">
            Every recorded mark across exams. Percentages and grades come from the server; the pass
            badge compares the mark with that exam's passing percentage.
          </p>
        </div>
        <div className="page-header__actions">
          <Button icon="refresh" onClick={listQuery.reload} loading={listQuery.loading}>
            Refresh
          </Button>
        </div>
      </header>

      <div className="ex-filters">
        <div className="ex-filters__search">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search student or exam…"
            label="Search results"
          />
        </div>
        <div className="ex-filters__field">
          <Select
            label="Group"
            placeholder="All groups"
            options={(groupsQuery.data ?? []).map((entry) => ({ value: entry.id, label: entry.name }))}
            value={group}
            onChange={setGroup}
          />
        </div>
        <div className="ex-filters__field">
          <Select
            label="Exam"
            placeholder="All exams"
            options={(examsQuery.data ?? []).map((entry) => ({
              value: entry.id,
              label: `${entry.name} · ${formatDate(entry.date)}`,
            }))}
            value={exam}
            onChange={setExam}
          />
        </div>
        <div className="ex-filters__field">
          <Select
            label="Student"
            placeholder="All students"
            options={(studentsQuery.data ?? []).map((entry: StudentOption) => ({
              value: entry.id,
              label: entry.group_name === undefined ? entry.full_name : `${entry.full_name} · ${entry.group_name}`,
            }))}
            value={student}
            onChange={setStudent}
          />
        </div>
        <div className="ex-filters__field">
          <Select
            label="Grade"
            placeholder="All grades"
            options={gradeOptions}
            value={grade}
            onChange={setGrade}
          />
        </div>
        <div className="ex-filters__field">
          <DateField label="From" value={dateFrom} onChange={setDateFrom} />
        </div>
        <div className="ex-filters__field">
          <DateField label="To" value={dateTo} onChange={setDateTo} />
        </div>
      </div>

      {examsQuery.error !== null ? (
        <div className="alert alert--error" role="alert">
          <div className="alert__content">
            <span>
              Pass/fail badges need the exam list: {errorMessage(examsQuery.error)}
            </span>
          </div>
        </div>
      ) : null}

      <Card flush>
        <Table
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          paginated={false}
          dense
          loading={listQuery.loading}
          error={listQuery.error}
          onRetry={listQuery.reload}
          emptyTitle="No results found"
          emptyMessage="Adjust the filters, or record marks on an exam's mark sheet."
          emptyIcon="table"
          footer={
            rows.length > 0 ? (
              <Pagination
                page={listQuery.data?.page ?? page}
                totalPages={listQuery.data?.total_pages ?? 1}
                totalItems={listQuery.data?.count ?? 0}
                pageSize={listQuery.data?.page_size ?? pageSize}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                itemLabel="results"
              />
            ) : undefined
          }
        />
      </Card>
    </div>
  );
}

export default ResultsPage;
