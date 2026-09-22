import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  DateField,
  Modal,
  Pagination,
  SearchInput,
  Select,
  Table,
  TextField,
  type TableColumn,
} from '../../components';
import { useAuth } from '../../auth/AuthContext';
import { useSettings } from '../../settings/SettingsContext';
import { ApiError, errorMessage } from '../../types';
import { toIsoDate } from '../../utils/format';
import {
  courseOptions,
  createExam,
  exams,
  groupOptions,
  toNumber,
  useApiQuery,
} from './api';
import { examTypeLabel } from './labels';
import { EXAM_TYPE_VALUES, type CourseOption, type Exam, type ExamTypeValue, type GroupOption } from './types';
import './exams.css';

interface ComponentDraft {
  name: string;
  max_score: string;
}

const EMPTY_COMPONENT: ComponentDraft = { name: '', max_score: '' };

function isPositive(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return false;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0;
}

/** New exam form, including the dynamic component editor (IELTS sections etc.). */
function NewExamModal({
  open,
  groups,
  courses,
  defaultGroup,
  onClose,
  onCreated,
}: {
  open: boolean;
  groups: GroupOption[];
  courses: CourseOption[];
  defaultGroup: number | '';
  onClose: () => void;
  onCreated: (exam: Exam) => void;
}): ReactNode {
  const [group, setGroup] = useState<number | ''>(defaultGroup);
  const [course, setCourse] = useState<number | ''>('');
  const [name, setName] = useState('');
  const [examType, setExamType] = useState<ExamTypeValue>('quiz');
  const [date, setDate] = useState(toIsoDate());
  const [maxScore, setMaxScore] = useState('100');
  const [passingScore, setPassingScore] = useState('');
  const [description, setDescription] = useState('');
  const [components, setComponents] = useState<ComponentDraft[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setGroup(defaultGroup);
      setCourse('');
      setName('');
      setExamType('quiz');
      setDate(toIsoDate());
      setMaxScore('100');
      setPassingScore('');
      setDescription('');
      setComponents([]);
      setErrors({});
      setSubmitting(false);
    }
  }, [open, defaultGroup]);

  const addComponent = (): void => setComponents((prev) => [...prev, { ...EMPTY_COMPONENT }]);
  const updateComponent = (index: number, patch: Partial<ComponentDraft>): void =>
    setComponents((prev) => prev.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  const removeComponent = (index: number): void =>
    setComponents((prev) => prev.filter((_, position) => position !== index));

  const submit = async (): Promise<void> => {
    const next: Record<string, string> = {};
    if (group === '') next.group = 'Choose a group.';
    if (name.trim() === '') next.name = 'Give the exam a name.';
    if (date.trim() === '') next.date = 'Pick the exam date.';
    if (!isPositive(maxScore)) next.max_score = 'The maximum score must be above zero.';
    const passing = passingScore.trim();
    if (passing !== '') {
      const parsed = Number(passing);
      if (!Number.isFinite(parsed) || parsed < 0) {
        next.passing_score = 'The passing score cannot be negative.';
      } else if (isPositive(maxScore) && parsed > Number(maxScore)) {
        next.passing_score = 'The passing score cannot exceed the maximum score.';
      }
    }
    const cleaned: ComponentDraft[] = [];
    for (const row of components) {
      const componentName = row.name.trim();
      if (componentName === '' && row.max_score.trim() === '') continue;
      if (componentName === '') {
        next.components = 'Every component needs a name.';
        break;
      }
      if (!isPositive(row.max_score)) {
        next.components = `Component “${componentName}” needs a maximum above zero.`;
        break;
      }
      if (cleaned.some((entry) => entry.name.toLowerCase() === componentName.toLowerCase())) {
        next.components = `Component “${componentName}” is listed twice.`;
        break;
      }
      cleaned.push({ name: componentName, max_score: row.max_score.trim() });
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    try {
      const created = await createExam({
        group: group === '' ? 0 : group,
        name: name.trim(),
        exam_type: examType,
        date,
        course: course === '' ? null : course,
        max_score: maxScore.trim(),
        passing_score: passing === '' ? null : passing,
        description: description.trim(),
        components: cleaned.map((row, index) => ({
          name: row.name,
          max_score: row.max_score,
          order: index,
        })),
      });
      onCreated(created);
    } catch (cause) {
      if (cause instanceof ApiError && Object.keys(cause.errors).length > 0) {
        const mapped: Record<string, string> = {};
        for (const [field, messages] of Object.entries(cause.errors)) {
          mapped[field] = (messages ?? []).join(' ');
        }
        setErrors(mapped);
      } else {
        setErrors({ non_field_errors: errorMessage(cause) });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New exam"
      subtitle="An exam can be a single score or split into components (e.g. IELTS Listening / Reading / Writing / Speaking)."
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
            Create exam
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
            value={group}
            onChange={setGroup}
            error={errors.group}
          />
          <Select
            label="Course"
            placeholder="Use the group's course"
            options={courses.map((entry) => ({ value: entry.id, label: `${entry.name} (${entry.code})` }))}
            value={course}
            onChange={setCourse}
            error={errors.course}
          />
          <TextField
            label="Exam name"
            required
            value={name}
            onChange={setName}
            error={errors.name}
            placeholder="e.g. IELTS Mock 3"
          />
          <Select
            label="Type"
            required
            options={EXAM_TYPE_VALUES.map((value) => ({ value, label: examTypeLabel(value) }))}
            value={examType}
            onChange={(value) => setExamType(value === '' ? 'custom' : (value as ExamTypeValue))}
            error={errors.exam_type}
          />
          <DateField label="Date" required value={date} onChange={setDate} error={errors.date} />
          <TextField
            label="Max score"
            required
            value={maxScore}
            onChange={setMaxScore}
            error={errors.max_score}
            hint="A per-exam maximum: it does not have to be 100."
          />
          <TextField
            label="Passing score"
            value={passingScore}
            onChange={setPassingScore}
            error={errors.passing_score}
            hint="Leave empty to use the centre's default passing percentage."
          />
        </div>

        <TextField
          label="Description"
          value={description}
          onChange={setDescription}
          error={errors.description}
        />

        <div className="ex-components">
          <div className="ex-components__head">
            <div className="u-stack" style={{ gap: 2 }}>
              <strong>Components</strong>
              <span className="ex-hint">
                Optional. With components the mark sheet gets one column each; the overall score is
                computed by the server.
              </span>
            </div>
            <Button size="sm" icon="plus" onClick={addComponent}>
              Add component
            </Button>
          </div>

          {errors.components !== undefined ? (
            <p className="field__error">{errors.components}</p>
          ) : null}

          {components.length === 0 ? (
            <p className="ex-hint">No components: this exam is marked with a single score.</p>
          ) : (
            components.map((row, index) => (
              <div className="ex-components__row" key={`component-${index}`}>
                <div className="ex-components__name">
                  <TextField
                    label={index === 0 ? 'Name' : undefined}
                    labelHidden
                    placeholder={`Component ${index + 1} name`}
                    value={row.name}
                    onChange={(value) => updateComponent(index, { name: value })}
                  />
                </div>
                <div className="ex-components__score">
                  <TextField
                    label={index === 0 ? 'Max score' : undefined}
                    labelHidden
                    placeholder="Max"
                    value={row.max_score}
                    onChange={(value) => updateComponent(index, { max_score: value })}
                  />
                </div>
                <div className="ex-components__remove">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="trash"
                    aria-label={`Remove component ${index + 1}`}
                    onClick={() => removeComponent(index)}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}

export function ExamsListPage(): ReactNode {
  const { hasPerm } = useAuth();
  const { date: formatDate, amount } = useSettings();
  const navigate = useNavigate();
  const canManage = hasPerm('exams.manage');

  const [group, setGroup] = useState<number | ''>('');
  const [course, setCourse] = useState<number | ''>('');
  const [examType, setExamType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [group, course, examType, dateFrom, dateTo, search, pageSize]);

  const groupsQuery = useApiQuery(() => groupOptions(), []);
  const coursesQuery = useApiQuery(() => courseOptions(), []);

  const listQuery = useApiQuery(
    () =>
      exams({
        group,
        course,
        exam_type: examType,
        date_from: dateFrom,
        date_to: dateTo,
        search,
        page,
        page_size: pageSize,
      }),
    [group, course, examType, dateFrom, dateTo, search, page, pageSize],
  );

  const rows = useMemo(() => listQuery.data?.results ?? [], [listQuery.data]);
  const totalPages = listQuery.data?.total_pages ?? 1;
  const totalItems = listQuery.data?.count ?? 0;

  const columns: Array<TableColumn<Exam>> = [
    {
      key: 'name',
      header: 'Exam',
      render: (exam) => (
        <Link to={`/exams/${exam.id}`} className="u-nowrap">
          {exam.name}
        </Link>
      ),
      width: '28%',
    },
    { key: 'group', header: 'Group', render: (exam) => exam.group_name },
    {
      key: 'type',
      header: 'Type',
      render: (exam) => examTypeLabel(exam.exam_type, exam.exam_type_display),
    },
    {
      key: 'date',
      header: 'Date',
      align: 'right',
      render: (exam) => formatDate(exam.date),
    },
    {
      key: 'scores',
      header: 'Max / pass',
      align: 'right',
      render: (exam) => (
        <span className="u-nowrap">
          {amount(toNumber(exam.max_score), 2)} / {amount(toNumber(exam.passing_score), 2)}
        </span>
      ),
    },
    {
      key: 'components',
      header: 'Components',
      align: 'right',
      render: (exam) => exam.components_count,
    },
    {
      key: 'results',
      header: 'Results',
      align: 'right',
      render: (exam) => exam.results_count,
    },
    {
      key: 'published',
      header: 'Published',
      render: (exam) =>
        exam.is_published ? (
          <Badge tone="success" dot>
            Published
          </Badge>
        ) : (
          <Badge tone="warning" dot>
            Draft
          </Badge>
        ),
    },
  ];

  return (
    <div>
      <header className="page-header">
        <div className="page-header__heading">
          <h1 className="page-header__title">Exams</h1>
          <p className="page-header__subtitle">
            Every assessment of your groups, newest first. Open an exam to mark it and publish the
            results.
          </p>
        </div>
        <div className="page-header__actions">
          <Button icon="refresh" onClick={listQuery.reload} loading={listQuery.loading}>
            Refresh
          </Button>
          {canManage ? (
            <Button variant="primary" icon="plus" onClick={() => setShowNew(true)}>
              New exam
            </Button>
          ) : null}
        </div>
      </header>

      <div className="ex-filters">
        <div className="ex-filters__search">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search exams…"
            label="Search exams"
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
            label="Course"
            placeholder="All courses"
            options={(coursesQuery.data ?? []).map((entry) => ({
              value: entry.id,
              label: entry.name,
            }))}
            value={course}
            onChange={setCourse}
          />
        </div>
        <div className="ex-filters__field">
          <Select
            label="Type"
            placeholder="All types"
            options={EXAM_TYPE_VALUES.map((value) => ({ value, label: examTypeLabel(value) }))}
            value={examType}
            onChange={setExamType}
          />
        </div>
        <div className="ex-filters__field">
          <DateField label="From" value={dateFrom} onChange={setDateFrom} />
        </div>
        <div className="ex-filters__field">
          <DateField label="To" value={dateTo} onChange={setDateTo} />
        </div>
      </div>

      {groupsQuery.error !== null ? (
        <div className="alert alert--error" role="alert">
          <div className="alert__content">
            <span>{errorMessage(groupsQuery.error)}</span>
          </div>
        </div>
      ) : null}

      <Card flush>
        <Table
          columns={columns}
          rows={rows}
          rowKey={(exam) => exam.id}
          paginated={false}
          dense
          loading={listQuery.loading}
          error={listQuery.error}
          onRetry={listQuery.reload}
          onRowClick={(exam) => navigate(`/exams/${exam.id}`)}
          emptyTitle="No exams found"
          emptyMessage="Adjust the filters, or create the first exam for one of your groups."
          emptyIcon="academic"
          emptyAction={
            canManage ? (
              <Button variant="primary" icon="plus" onClick={() => setShowNew(true)}>
                New exam
              </Button>
            ) : undefined
          }
          footer={
            rows.length > 0 ? (
              <Pagination
                page={listQuery.data?.page ?? page}
                totalPages={totalPages}
                totalItems={totalItems}
                pageSize={listQuery.data?.page_size ?? pageSize}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                itemLabel="exams"
              />
            ) : undefined
          }
        />
      </Card>

      <NewExamModal
        open={showNew}
        groups={groupsQuery.data ?? []}
        courses={coursesQuery.data ?? []}
        defaultGroup={group}
        onClose={() => setShowNew(false)}
        onCreated={(exam) => {
          setShowNew(false);
          navigate(`/exams/${exam.id}`);
        }}
      />
    </div>
  );
}

export default ExamsListPage;
