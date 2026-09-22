import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DateField } from '../../components/DateField';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { LoadingState } from '../../components/LoadingState';
import { Modal } from '../../components/Modal';
import { Select } from '../../components/Select';
import { StatCard } from '../../components/StatCard';
import { Table, type TableColumn } from '../../components/Table';
import { TextField } from '../../components/TextField';
import { useSettings } from '../../settings/SettingsContext';
import { PERMISSIONS } from '../../types';
import { toIsoDate } from '../../utils/format';
import {
  teacherApi,
  type CurrentSalaryRow,
  type SalaryPolicyRow,
  type SalaryPolicyWritePayload,
} from './api';
import {
  SALARY_MODELS,
  fieldErrorsOf,
  formatMoneyValue,
  formatPercentValue,
  isDecimalInput,
  isZeroMoney,
  labelFor,
  messageLines,
  useMutation,
  useQueryData,
} from '../finance/shared';

/**
 * Current salary policy per teacher, and the form that creates a new version.
 *
 * Compensation is versioned data on the server: "setting a salary" creates a
 * NEW policy effective from a chosen date and closes the previous one the day
 * before, so past payroll runs keep their frozen numbers.
 */
export function SalariesPage() {
  const { hasPerm } = useAuth();
  const { currency, date } = useSettings();
  const canView = hasPerm(PERMISSIONS.PAYROLL_VIEW);
  const canManage = hasPerm(PERMISSIONS.PAYROLL_MANAGE);

  const [onDate, setOnDate] = useState(toIsoDate());
  const [refreshKey, setRefreshKey] = useState(0);
  const [dialog, setDialog] = useState<
    { kind: 'none' } | { kind: 'form'; teacherId: number | null }
  >({ kind: 'none' });
  const [lastSaved, setLastSaved] = useState<SalaryPolicyRow | null>(null);

  const current = useQueryData(
    (signal) => teacherApi.salaries.current({ date: onDate }, signal),
    [onDate, refreshKey],
    canView,
  );

  const rows = current.data ?? [];
  const withPolicy = rows.filter((row) => row.policy !== null).length;
  const money = (value: string | number | null | undefined): string => formatMoneyValue(value, currency);

  const columns: ReadonlyArray<TableColumn<CurrentSalaryRow>> = [
    {
      key: 'teacher',
      header: 'Teacher',
      render: (row) => (
        <div className="u-stack" style={{ gap: 0 }}>
          <Link to={`/teachers/${row.teacher}`}>{row.teacher_name}</Link>
          <span className="u-subtle">
            {row.lessons_this_month === 1
              ? '1 lesson this month'
              : `${row.lessons_this_month} lessons this month`}
          </span>
        </div>
      ),
    },
    {
      key: 'model',
      header: 'Model',
      render: (row) =>
        row.policy === null ? (
          <Badge tone="warning">No policy</Badge>
        ) : (
          <Badge tone="primary">{row.policy.model_label || row.policy.model}</Badge>
        ),
    },
    {
      key: 'base',
      header: 'Base',
      align: 'right',
      render: (row) =>
        row.policy === null || isZeroMoney(row.policy.base_amount) ? (
          <span className="u-subtle">—</span>
        ) : (
          money(row.policy.base_amount)
        ),
    },
    {
      key: 'per_lesson',
      header: 'Per lesson',
      align: 'right',
      render: (row) =>
        row.policy === null || isZeroMoney(row.policy.per_lesson_rate) ? (
          <span className="u-subtle">—</span>
        ) : (
          money(row.policy.per_lesson_rate)
        ),
    },
    {
      key: 'revenue_share',
      header: 'Revenue share',
      align: 'right',
      render: (row) =>
        row.policy === null || isZeroMoney(row.policy.revenue_share_pct) ? (
          <span className="u-subtle">—</span>
        ) : (
          formatPercentValue(row.policy.revenue_share_pct)
        ),
    },
    {
      key: 'lesson_bonus',
      header: 'Lesson bonus',
      align: 'right',
      render: (row) =>
        row.policy === null || isZeroMoney(row.policy.lesson_bonus) ? (
          <span className="u-subtle">—</span>
        ) : (
          money(row.policy.lesson_bonus)
        ),
    },
    {
      key: 'effective',
      header: 'Effective',
      render: (row) =>
        row.policy === null ? (
          <span className="u-subtle">—</span>
        ) : (
          <div className="u-stack" style={{ gap: 0 }}>
            <span>{date(row.policy.effective_from)}</span>
            {row.policy.effective_to === null ? (
              <Badge tone="success">Open-ended</Badge>
            ) : (
              <span className="u-subtle">until {date(row.policy.effective_to)}</span>
            )}
          </div>
        ),
    },
  ];

  if (!canView) {
    return (
      <div className="u-stack" style={{ gap: 'var(--space-5)' }}>
        <header className="page-header">
          <div className="page-header__heading">
            <h1 className="page-header__title">Salaries</h1>
            <p className="page-header__subtitle">Compensation policies per teacher</p>
          </div>
        </header>
        <Card title="Not available">
          <div className="alert alert--info" role="status">
            <div className="alert__content">
              Your role does not include the <code>payroll.view</code> permission.
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="u-stack" style={{ gap: 'var(--space-5)' }}>
      <header className="page-header">
        <div className="page-header__heading">
          <h1 className="page-header__title">Salaries</h1>
          <p className="page-header__subtitle">
            The policy in force for every active teacher, with the lessons they have taught this
            month.
          </p>
        </div>
        <div className="page-header__actions">
          {canManage ? (
            <Button
              variant="primary"
              icon="plus"
              onClick={() => setDialog({ kind: 'form', teacherId: null })}
            >
              Set salary policy
            </Button>
          ) : null}
        </div>
      </header>

      {lastSaved !== null ? (
        <div className="alert alert--success" role="status">
          <div className="alert__content">
            New policy saved for <strong>{lastSaved.teacher_name}</strong>:{' '}
            {lastSaved.model_label || labelFor(SALARY_MODELS, lastSaved.model)} effective from{' '}
            {date(lastSaved.effective_from)}. The previous version was closed automatically.
          </div>
        </div>
      ) : null}

      <Card title="Policies in force" subtitle={`As of ${date(onDate)}`}>
        <div className="filter-bar" style={{ borderBottom: 'none', paddingLeft: 0, paddingRight: 0 }}>
          <div className="filter-bar__field">
            <DateField
              small
              label="On date"
              value={onDate}
              onChange={setOnDate}
              hint="Shows the policy active on this day."
            />
          </div>
        </div>

        {current.loading && current.data === null ? (
          <LoadingState label="Loading salary policies…" />
        ) : null}
        {current.error !== null ? (
          <ErrorState error={current.error} onRetry={current.reload} />
        ) : null}

        {current.data !== null ? (
          <div className="u-stack" style={{ gap: 'var(--space-4)' }}>
            <div className="kpi-grid">
              <StatCard label="Active teachers" icon="teachers" value={String(rows.length)} />
              <StatCard
                label="With a policy"
                icon="checkCircle"
                value={String(withPolicy)}
                hint="Payroll can be calculated for them"
              />
              <StatCard
                label="Without a policy"
                icon="alert"
                value={String(rows.length - withPolicy)}
                hint="Their payroll lines will be zero"
              />
            </div>

            {rows.length === 0 ? (
              <EmptyState
                icon="teachers"
                title="No active teachers"
                message="Add teachers first, then set their salary policy here."
              />
            ) : (
              <Table<CurrentSalaryRow>
                paginated={false}
                dense
                stickyHeader
                rows={rows}
                rowKey={(row) => row.teacher}
                columns={columns}
                caption="Salary policies in force"
                actions={
                  canManage
                    ? (row) => (
                        <Button
                          size="sm"
                          onClick={() => setDialog({ kind: 'form', teacherId: row.teacher })}
                        >
                          {row.policy === null ? 'Set policy' : 'New version'}
                        </Button>
                      )
                    : undefined
                }
              />
            )}
          </div>
        ) : null}
      </Card>

      {dialog.kind === 'form' ? (
        <SalaryPolicyDialog
          teachers={rows.filter((row) => row.policy !== null || row.teacher !== null)}
          selectedTeacherId={dialog.teacherId}
          onClose={() => setDialog({ kind: 'none' })}
          onSaved={(policy) => {
            setLastSaved(policy);
            setRefreshKey((value) => value + 1);
            setDialog({ kind: 'none' });
          }}
        />
      ) : null}
    </div>
  );
}

interface SalaryPolicyDialogProps {
  teachers: ReadonlyArray<CurrentSalaryRow>;
  /** Pre-selected teacher when the dialog was opened from a row. */
  selectedTeacherId: number | null;
  onClose: () => void;
  onSaved: (policy: SalaryPolicyRow) => void;
}

/** Creates a NEW policy version; explains the effective-date behaviour. */
function SalaryPolicyDialog({
  teachers,
  selectedTeacherId,
  onClose,
  onSaved,
}: SalaryPolicyDialogProps) {
  const { currency } = useSettings();
  const today = toIsoDate();
  const [teacherId, setTeacherId] = useState<number | ''>(selectedTeacherId ?? '');
  const [model, setModel] = useState('fixed');
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [baseAmount, setBaseAmount] = useState('');
  const [perLessonRate, setPerLessonRate] = useState('');
  const [revenueSharePct, setRevenueSharePct] = useState('');
  const [lessonBonus, setLessonBonus] = useState('');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const { busy, error, run } = useMutation();

  const errors = fieldErrorsOf(error);
  const general = messageLines(error);

  const teacherOptions = useMemo(
    () => teachers.map((row) => ({ value: row.teacher, label: row.teacher_name })),
    [teachers],
  );

  const requiresBase = model === 'fixed' || model === 'hybrid';
  const requiresPerLesson = model === 'per_class';
  const requiresShare = model === 'percentage';

  const teacherError = touched && teacherId === '' ? 'Choose the teacher this policy applies to.' : undefined;
  const amountError = (value: string, required: boolean): string | undefined => {
    if (!touched) return undefined;
    if (value.trim() === '') return required ? 'An amount is required.' : undefined;
    if (!isDecimalInput(value)) return 'Enter an amount like 2500000 or 2500000.50.';
    if (isZeroMoney(value)) return 'The amount must be greater than zero.';
    return undefined;
  };

  const baseError = requiresBase
    ? amountError(baseAmount, model === 'fixed')
    : touched && baseAmount.trim() !== '' && !isDecimalInput(baseAmount)
      ? 'Enter an amount like 2500000 or 2500000.50.'
      : undefined;
  const perLessonError = requiresPerLesson
    ? amountError(perLessonRate, true)
    : touched && perLessonRate.trim() !== '' && !isDecimalInput(perLessonRate)
      ? 'Enter an amount like 50000 or 50000.50.'
      : undefined;
  const bonusError =
    touched && lessonBonus.trim() !== '' && !isDecimalInput(lessonBonus)
      ? 'Enter an amount like 10000 or 10000.50.'
      : undefined;
  const shareError = ((): string | undefined => {
    if (!touched) return undefined;
    if (revenueSharePct.trim() === '') {
      return requiresShare ? 'A percentage is required (for example 30).' : undefined;
    }
    if (!isDecimalInput(revenueSharePct)) return 'Enter a percentage like 30 or 12.50.';
    const parsed = Number(revenueSharePct);
    if (!(parsed > 0 && parsed <= 100)) return 'The revenue share must be between 0 and 100.';
    return undefined;
  })();

  const hybridNeedsOne = model === 'hybrid' && isZeroMoney(baseAmount) && isZeroMoney(lessonBonus);

  const submit = async (): Promise<void> => {
    setTouched(true);
    if (teacherId === '') return;
    if (baseError !== undefined || perLessonError !== undefined || bonusError !== undefined) return;
    if (shareError !== undefined) return;
    if (hybridNeedsOne) return;

    const payload: SalaryPolicyWritePayload = {
      teacher: teacherId,
      model,
      effective_from: effectiveFrom,
      note: note.trim(),
    };
    if (baseAmount.trim() !== '') payload.base_amount = baseAmount.trim();
    if (perLessonRate.trim() !== '') payload.per_lesson_rate = perLessonRate.trim();
    if (revenueSharePct.trim() !== '') payload.revenue_share_pct = revenueSharePct.trim();
    if (lessonBonus.trim() !== '') payload.lesson_bonus = lessonBonus.trim();

    await run(async () => {
      const policy = await teacherApi.salaries.create(payload);
      onSaved(policy);
    });
  };

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      size="lg"
      title="Set salary policy"
      subtitle="Creates a new version — the previous policy is closed the day before the chosen date."
      closeOnBackdrop={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={() => {
              void submit();
            }}
          >
            Save new version
          </Button>
        </>
      }
    >
      <div className="u-stack" style={{ gap: 'var(--space-4)' }}>
        {general.length > 0 ? (
          <div className="alert alert--error" role="alert">
            <div className="alert__content">
              <ul className="alert__list">
                {general.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        <div className="alert alert--info" role="status">
          <div className="alert__content">
            Salary changes are versioned. Saving closes the current policy the day before{' '}
            {effectiveFrom === '' ? 'the chosen date' : effectiveFrom} and starts a new one, so
            payroll runs that were already calculated keep their frozen snapshot.
          </div>
        </div>

        <div className="form-grid">
          <Select<number>
            label="Teacher"
            required
            placeholder="Choose a teacher"
            options={teacherOptions}
            value={teacherId}
            onChange={setTeacherId}
            error={teacherError ?? errors.teacher}
            disabled={selectedTeacherId !== null}
          />
          <Select
            label="Model"
            required
            options={SALARY_MODELS}
            value={model}
            onChange={(value) => setModel(value === '' ? 'fixed' : value)}
            error={errors.model}
          />
          <DateField
            label="Effective from"
            required
            value={effectiveFrom}
            onChange={setEffectiveFrom}
            hint="Payroll uses the policy in force at the end of the period."
            error={errors.effective_from}
          />
        </div>

        <div className="form-grid">
          {requiresBase ? (
            <TextField
              label={`Base amount (${currency.currency_code || 'currency'})`}
              required={model === 'fixed'}
              inputMode="decimal"
              placeholder="0.00"
              value={baseAmount}
              onChange={setBaseAmount}
              error={baseError ?? errors.base_amount}
              hint={model === 'hybrid' ? 'Paid every month regardless of lessons.' : undefined}
            />
          ) : null}

          {requiresPerLesson ? (
            <TextField
              label={`Per-lesson rate (${currency.currency_code || 'currency'})`}
              required
              inputMode="decimal"
              placeholder="0.00"
              value={perLessonRate}
              onChange={setPerLessonRate}
              error={perLessonError ?? errors.per_lesson_rate}
              hint="Multiplied by the lessons actually taught."
            />
          ) : null}

          {requiresShare ? (
            <TextField
              label="Revenue share (%)"
              required
              inputMode="decimal"
              placeholder="0"
              value={revenueSharePct}
              onChange={setRevenueSharePct}
              error={shareError ?? errors.revenue_share_pct}
              hint="Share of the fees collected from this teacher's groups."
            />
          ) : null}

          {model === 'hybrid' ? (
            <TextField
              label={`Lesson bonus (${currency.currency_code || 'currency'})`}
              inputMode="decimal"
              placeholder="0.00"
              value={lessonBonus}
              onChange={setLessonBonus}
              error={bonusError ?? errors.lesson_bonus}
              hint="Extra amount per lesson taught (base + lessons)."
            />
          ) : null}

          <TextField
            label="Note"
            value={note}
            onChange={setNote}
            hint="Why the terms changed — shown next to the policy version."
            error={errors.note}
          />
        </div>

        {hybridNeedsOne ? (
          <div className="alert alert--warning" role="status">
            <div className="alert__content">
              A hybrid policy needs either a base amount or a lesson bonus.
            </div>
          </div>
        ) : null}

        {model === 'percentage' ? (
          <p className="u-muted">
            The revenue share applies to the fees collected in the payroll period from the students
            of this teacher&apos;s groups.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

export default SalariesPage;
