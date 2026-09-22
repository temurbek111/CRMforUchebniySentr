import { useId, useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { Badge, StatusBadge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DateField } from '../../components/DateField';
import { ErrorState } from '../../components/ErrorState';
import { Icon } from '../../components/Icon';
import { LoadingState } from '../../components/LoadingState';
import { Modal } from '../../components/Modal';
import { Pagination } from '../../components/Pagination';
import { Select } from '../../components/Select';
import { StatCard } from '../../components/StatCard';
import { Table, type TableColumn } from '../../components/Table';
import { TextField } from '../../components/TextField';
import { useSettings } from '../../settings/SettingsContext';
import { PERMISSIONS, type QueryParams } from '../../types';
import { toIsoDate } from '../../utils/format';
import { teacherApi, type TeacherRow } from '../teachers/api';

import {
  financeApi,
  type PayrollItemRow,
  type PayrollRunDetail,
  type PayrollRunRow,
} from './api';
import { FinanceOverviewSection } from './FinanceOverviewSection';
import {
  PAYMENT_METHODS,
  PAYROLL_STATUSES,
  currentMonthRange,
  fieldErrorsOf,
  formatMoneyValue,
  formatPercentValue,
  formatPeriodRange,
  isDecimalInput,
  isZeroMoney,
  messageLines,
  readString,
  useMutation,
  useQueryData,
} from './shared';

const PAGE_SIZE = 25;

type Dialog =
  | { kind: 'none' }
  | { kind: 'sheet'; runId: number }
  | { kind: 'calculate' }
  | { kind: 'pay'; run: PayrollRunRow }
  | { kind: 'approve'; run: PayrollRunRow };

/**
 * Payroll runs: calculate, review the frozen sheet, approve and pay.
 *
 * Nothing on this page can edit an approved or paid run — the server locks it
 * and the UI shows the lock instead of offering the action.
 */
export function PayrollPage() {
  const { hasPerm } = useAuth();
  const { currency } = useSettings();

  const canView = hasPerm(PERMISSIONS.PAYROLL_VIEW);
  const canManage = hasPerm(PERMISSIONS.PAYROLL_MANAGE);
  const canApprove = hasPerm(PERMISSIONS.PAYROLL_APPROVE);
  const canViewTeachers = hasPerm(PERMISSIONS.TEACHERS_VIEW);

  const today = toIsoDate();
  const range = currentMonthRange(today);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' });

  const params = useMemo<QueryParams>(
    () => ({
      page,
      page_size: PAGE_SIZE,
      status: statusFilter === '' ? undefined : statusFilter,
      ordering: '-period_start',
    }),
    [page, statusFilter],
  );

  const runs = useQueryData(
    (signal) => financeApi.payroll.list(params, signal),
    [page, statusFilter, refreshKey],
    canView,
  );

  const payable = useQueryData(
    (signal) => financeApi.payroll.payable(signal),
    [refreshKey],
    canView,
  );

  const money = (value: string | number | null | undefined): string => formatMoneyValue(value, currency);

  const rows = runs.data?.results ?? [];
  const pendingRuns = payable.data?.pending_runs ?? [];

  const columns: ReadonlyArray<TableColumn<PayrollRunRow>> = [
    {
      key: 'label',
      header: 'Run',
      render: (row) => (
        <div className="u-stack" style={{ gap: 0 }}>
          <span>{row.label}</span>
          <span className="u-subtle">
            {row.teachers_count === 1 ? '1 teacher' : `${row.teachers_count} teachers`}
          </span>
        </div>
      ),
    },
    {
      key: 'period',
      header: 'Period',
      render: (row) => formatPeriodRange(row.period_start, row.period_end),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <div className="u-stack" style={{ gap: 2 }}>
          <StatusBadge status={row.status_label || row.status} />
          {row.is_locked ? (
            <Badge tone="info" title="Approved and paid runs are frozen and cannot be recalculated">
              <Icon name="lock" size={11} /> Locked
            </Badge>
          ) : null}
        </div>
      ),
    },
    { key: 'gross', header: 'Gross', align: 'right', render: (row) => money(row.total_gross) },
    {
      key: 'deductions',
      header: 'Deductions',
      align: 'right',
      render: (row) => money(row.total_deductions),
    },
    {
      key: 'net',
      header: 'Net payable',
      align: 'right',
      render: (row) => <strong>{money(row.total_net)}</strong>,
    },
  ];

  if (!canView) {
    return (
      <div className="u-stack" style={{ gap: 'var(--space-5)' }}>
        <header className="page-header">
          <div className="page-header__heading">
            <h1 className="page-header__title">Payroll</h1>
            <p className="page-header__subtitle">Teacher salaries per payroll run</p>
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
          <h1 className="page-header__title">Payroll</h1>
          <p className="page-header__subtitle">
            Each run freezes the salary policy it was calculated with, so approving or paying never
            changes history.
          </p>
        </div>
        <div className="page-header__actions">
          {canManage ? (
            <Button
              variant="primary"
              icon="plus"
              onClick={() => setDialog({ kind: 'calculate' })}
            >
              Calculate payroll
            </Button>
          ) : null}
        </div>
      </header>

      <Card
        title="Payroll payable"
        subtitle="Calculated and approved runs that have not been paid yet"
      >
        {payable.loading && payable.data === null ? (
          <LoadingState label="Loading the payroll position…" />
        ) : null}
        {payable.error !== null ? (
          <ErrorState error={payable.error} onRetry={payable.reload} />
        ) : null}
        {payable.data !== null ? (
          <div className="kpi-grid">
            <StatCard
              label="Payroll payable"
              icon="teachers"
              value={money(payable.data.payroll_payable)}
              hint="Teachers are owed this amount right now"
            />
            <StatCard
              label="Pending runs"
              icon="clipboard"
              value={String(pendingRuns.length)}
              hint="Calculated or approved, awaiting payment"
            />
          </div>
        ) : null}
      </Card>

      <FinanceOverviewSection
        from={range.from}
        to={range.to}
        title={`Centre-wide figures for ${range.from} – ${range.to}`}
      />

      <Card flush>
        <div className="filter-bar">
          <div className="filter-bar__field">
            <Select
              small
              label="Status"
              placeholder="All statuses"
              options={PAYROLL_STATUSES}
              value={statusFilter}
              onChange={(value) => {
                setStatusFilter(value);
                setPage(1);
              }}
            />
          </div>
        </div>

        <Table<PayrollRunRow>
          paginated={false}
          stickyHeader
          rows={rows}
          rowKey={(row) => row.id}
          columns={columns}
          loading={runs.loading && runs.data === null}
          error={runs.error}
          onRetry={runs.reload}
          emptyIcon="clipboard"
          emptyTitle="No payroll runs yet"
          emptyMessage="Use “Calculate payroll” to build a run for a period — it picks up every active teacher's salary policy and the lessons they taught."
          caption="Payroll runs"
          actions={(row) => (
            <div className="u-row" style={{ justifyContent: 'flex-end' }}>
              <Button size="sm" icon="eye" onClick={() => setDialog({ kind: 'sheet', runId: row.id })}>
                Run sheet
              </Button>
              {canApprove && row.status === 'calculated' ? (
                <Button size="sm" variant="primary" onClick={() => setDialog({ kind: 'approve', run: row })}>
                  Approve
                </Button>
              ) : null}
              {canManage && row.status === 'approved' ? (
                <Button size="sm" variant="primary" onClick={() => setDialog({ kind: 'pay', run: row })}>
                  Pay
                </Button>
              ) : null}
            </div>
          )}
          footer={
            runs.data !== null && runs.data.count > 0 ? (
              <Pagination
                page={runs.data.page}
                totalPages={runs.data.total_pages}
                totalItems={runs.data.count}
                pageSize={runs.data.page_size}
                itemLabel="runs"
                onPageChange={setPage}
              />
            ) : undefined
          }
        />
      </Card>

      {dialog.kind === 'sheet' ? (
        <RunSheetDialog
          runId={dialog.runId}
          canApprove={canApprove}
          canPay={canManage}
          onClose={() => setDialog({ kind: 'none' })}
          onApprove={(run) => setDialog({ kind: 'approve', run })}
          onPay={(run) => setDialog({ kind: 'pay', run })}
        />
      ) : null}

      {dialog.kind === 'calculate' ? (
        <CalculatePayrollDialog
          canPickTeachers={canViewTeachers}
          onClose={() => setDialog({ kind: 'none' })}
          onCalculated={(run) => {
            setRefreshKey((value) => value + 1);
            setDialog({ kind: 'sheet', runId: run.id });
          }}
        />
      ) : null}

      {dialog.kind === 'approve' ? (
        <ConfirmDialog
          open
          tone="primary"
          title={`Approve payroll for ${dialog.run.label}`}
          confirmLabel="Approve run"
          message={
            <div className="u-stack">
              <p>
                Approving freezes this run: the {money(dialog.run.total_gross)} gross and{' '}
                {money(dialog.run.total_net)} net become final and the run can no longer be
                recalculated.
              </p>
              <p className="u-muted">
                {dialog.run.teachers_count === 1
                  ? '1 teacher'
                  : `${dialog.run.teachers_count} teachers`}{' '}
                · {formatPeriodRange(dialog.run.period_start, dialog.run.period_end)}
              </p>
            </div>
          }
          onCancel={() => setDialog({ kind: 'none' })}
          onConfirm={async () => {
            await financeApi.payroll.approve(dialog.run.id);
            setRefreshKey((value) => value + 1);
            setDialog({ kind: 'none' });
          }}
        />
      ) : null}

      {dialog.kind === 'pay' ? (
        <PayRunDialog
          run={dialog.run}
          onClose={() => setDialog({ kind: 'none' })}
          onPaid={() => {
            setRefreshKey((value) => value + 1);
            setDialog({ kind: 'none' });
          }}
        />
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Run sheet
// --------------------------------------------------------------------------- //

interface RunSheetDialogProps {
  runId: number;
  canApprove: boolean;
  canPay: boolean;
  onClose: () => void;
  onApprove: (run: PayrollRunRow) => void;
  onPay: (run: PayrollRunRow) => void;
}

/** The frozen calculation for one run, teacher by teacher. */
function RunSheetDialog({ runId, canApprove, canPay, onClose, onApprove, onPay }: RunSheetDialogProps) {
  const { currency, dateTime } = useSettings();
  const run = useQueryData((signal) => financeApi.payroll.get(runId, signal), [runId]);
  const money = (value: string | number | null | undefined): string => formatMoneyValue(value, currency);

  const asRunRow = (detail: PayrollRunDetail): PayrollRunRow => ({
    id: detail.id,
    label: detail.label,
    period_start: detail.period_start,
    period_end: detail.period_end,
    status: detail.status,
    status_label: detail.status_label,
    is_locked: detail.is_locked,
    total_gross: detail.total_gross,
    total_deductions: detail.total_deductions,
    total_net: detail.total_net,
    teachers_count: detail.teachers_count,
    calculated_at: detail.calculated_at,
    approved_by: null,
    approved_by_name: detail.approved_by ?? '',
    approved_at: detail.approved_at,
    paid_at: detail.paid_at,
    expense: detail.expense,
    notes: detail.notes,
  });

  const detail = run.data;

  const columns: ReadonlyArray<TableColumn<PayrollItemRow>> = [
    { key: 'teacher', header: 'Teacher', render: (row) => row.teacher_name },
    {
      key: 'lessons',
      header: 'Lessons',
      align: 'right',
      render: (row) => String(row.lessons_count),
    },
    { key: 'base', header: 'Base', align: 'right', render: (row) => money(row.base_amount) },
    {
      key: 'per_lesson',
      header: 'Per lesson',
      align: 'right',
      render: (row) => (
        <div className="u-stack" style={{ gap: 0 }}>
          <span>{money(row.per_lesson_amount)}</span>
          {isZeroMoney(row.revenue_base) ? null : (
            <span className="u-subtle">of {money(row.revenue_base)} revenue</span>
          )}
        </div>
      ),
    },
    {
      key: 'revenue_share',
      header: 'Revenue share',
      align: 'right',
      render: (row) => money(row.revenue_share_amount),
    },
    { key: 'bonuses', header: 'Bonuses', align: 'right', render: (row) => money(row.bonuses) },
    {
      key: 'deductions',
      header: 'Deductions',
      align: 'right',
      render: (row) => money(row.deductions),
    },
    {
      key: 'gross',
      header: 'Gross',
      align: 'right',
      render: (row) => money(row.gross_amount),
    },
    {
      key: 'net',
      header: 'Net',
      align: 'right',
      render: (row) => <strong>{money(row.net_amount)}</strong>,
    },
    {
      key: 'policy',
      header: 'Frozen policy',
      render: (row) => {
        const snapshot = row.policy_snapshot;
        const model = readString(snapshot, 'model_label') || readString(snapshot, 'model');
        const rate = (key: string): string => {
          const raw = readString(snapshot, key);
          return raw === '' || isZeroMoney(raw) ? '' : money(raw);
        };
        const shareRaw = readString(snapshot, 'revenue_share_pct');
        const share =
          shareRaw === '' || isZeroMoney(shareRaw) ? '' : formatPercentValue(shareRaw);
        const effective = formatPeriodRange(
          readString(snapshot, 'effective_from'),
          readString(snapshot, 'effective_to'),
        );
        if (model === '' && effective === '—') {
          return <span className="u-subtle">No policy in force</span>;
        }
        const parts = [
          rate('base_amount') === '' ? '' : `base ${rate('base_amount')}`,
          rate('per_lesson_rate') === '' ? '' : `lesson ${rate('per_lesson_rate')}`,
          share === '' ? '' : `share ${share}`,
          rate('lesson_bonus') === '' ? '' : `bonus ${rate('lesson_bonus')}`,
        ].filter((part) => part !== '');
        return (
          <div className="u-stack" style={{ gap: 0 }}>
            <span>{model === '' ? 'Policy snapshot' : model}</span>
            <span className="u-subtle">Effective {effective}</span>
            {parts.length > 0 ? <span className="u-subtle">{parts.join(' · ')}</span> : null}
          </div>
        );
      },
    },
    {
      key: 'breakdown',
      header: 'Calculation',
      render: (row) => {
        const entries = Object.entries(row.breakdown ?? {});
        if (entries.length === 0) return <span className="u-subtle">—</span>;
        return (
          <div className="u-stack" style={{ gap: 0 }}>
            {entries.map(([key, value]) => (
              <span key={key} className="u-muted">
                {value}
              </span>
            ))}
          </div>
        );
      },
    },
  ];

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={`Run sheet — ${detail === null ? '…' : detail.label}`}
      subtitle={
        detail === null
          ? undefined
          : `${formatPeriodRange(detail.period_start, detail.period_end)} · ${detail.status_label}`
      }
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          {detail !== null && canApprove && detail.status === 'calculated' ? (
            <Button variant="primary" onClick={() => onApprove(asRunRow(detail))}>
              Approve run
            </Button>
          ) : null}
          {detail !== null && canPay && detail.status === 'approved' ? (
            <Button variant="primary" onClick={() => onPay(asRunRow(detail))}>
              Pay run
            </Button>
          ) : null}
        </>
      }
    >
      {run.loading && detail === null ? <LoadingState label="Loading the run sheet…" /> : null}
      {run.error !== null ? <ErrorState error={run.error} onRetry={run.reload} /> : null}

      {detail !== null ? (
        <div className="u-stack" style={{ gap: 'var(--space-4)' }}>
          {detail.is_locked ? (
            <div className="alert alert--warning" role="status">
              <span className="alert__icon" aria-hidden="true">
                <Icon name="lock" size={16} />
              </span>
              <div className="alert__content">
                This run is {detail.status_label.toLowerCase()} — its figures are frozen and it can
                no longer be recalculated.
              </div>
            </div>
          ) : null}

          <div className="kpi-grid">
            <StatCard label="Gross" value={money(detail.total_gross)} />
            <StatCard label="Deductions" value={money(detail.total_deductions)} />
            <StatCard label="Net payable" value={money(detail.total_net)} icon="teachers" />
            <StatCard label="Teachers" value={String(detail.teachers_count)} icon="users" />
          </div>

          <div className="u-stack" style={{ gap: 'var(--space-1)' }}>
            <div className="u-row u-row--between">
              <span className="u-muted">Calculated</span>
              <span>{dateTime(detail.calculated_at)}</span>
            </div>
            <div className="u-row u-row--between">
              <span className="u-muted">Approved</span>
              <span>
                {detail.approved_at === null
                  ? '—'
                  : `${detail.approved_by ?? 'unknown'} · ${dateTime(detail.approved_at)}`}
              </span>
            </div>
            <div className="u-row u-row--between">
              <span className="u-muted">Paid</span>
              <span>{detail.paid_at === null ? '—' : dateTime(detail.paid_at)}</span>
            </div>
            {detail.expense !== null ? (
              <div className="u-row u-row--between">
                <span className="u-muted">Expense booked</span>
                <span>Teacher Salaries expense #{detail.expense}</span>
              </div>
            ) : null}
          </div>

          <Table<PayrollItemRow>
            dense
            stickyHeader
            paginated={false}
            rows={detail.items}
            rowKey={(row) => row.id}
            caption={`Payroll lines for ${detail.label}`}
            columns={columns}
            emptyTitle="This run has no lines"
            emptyMessage="Nobody was eligible when the run was calculated."
          />
        </div>
      ) : null}
    </Modal>
  );
}

// --------------------------------------------------------------------------- //
// Calculate a run
// --------------------------------------------------------------------------- //

interface CalculatePayrollDialogProps {
  canPickTeachers: boolean;
  onClose: () => void;
  onCalculated: (run: PayrollRunDetail) => void;
}

/** Builds (or recalculates) a run. Recalculating an approved run is refused. */
function CalculatePayrollDialog({ canPickTeachers, onClose, onCalculated }: CalculatePayrollDialogProps) {
  const { currency } = useSettings();
  const today = toIsoDate();
  const range = currentMonthRange(today);
  const [periodStart, setPeriodStart] = useState(range.from);
  const [periodEnd, setPeriodEnd] = useState(today);
  const [label, setLabel] = useState('');
  const [deductions, setDeductions] = useState<Record<number, string>>({});
  const [excluded, setExcluded] = useState<Record<number, boolean>>({});
  const [touched, setTouched] = useState(false);
  const { busy, error, run } = useMutation();

  const teachers = useQueryData(
    (signal) => teacherApi.teachers.list({ status: 'active', page_size: 200 }, signal),
    [],
    canPickTeachers,
  );

  const errors = fieldErrorsOf(error);
  const general = messageLines(error);
  const teacherRows: TeacherRow[] = teachers.data?.results ?? [];

  const periodError =
    touched && (periodStart === '' || periodEnd === '')
      ? 'Both the start and the end of the period are required.'
      : touched && periodStart !== '' && periodEnd !== '' && periodEnd < periodStart
        ? 'The period cannot end before it starts.'
        : undefined;

  const invalidDeductions = Object.entries(deductions).filter(
    ([, value]) => value.trim() !== '' && !isDecimalInput(value),
  );

  const submit = async (): Promise<void> => {
    setTouched(true);
    if (periodError !== undefined || invalidDeductions.length > 0) return;
    const deductionPayload: Record<string, string> = {};
    for (const [teacherId, value] of Object.entries(deductions)) {
      if (value.trim() !== '') deductionPayload[teacherId] = value.trim();
    }
    const teacherIds = teacherRows
      .filter((teacher) => excluded[teacher.id] !== true)
      .map((teacher) => teacher.id);
    const allIncluded = teacherIds.length === teacherRows.length;

    await run(async () => {
      const result = await financeApi.payroll.calculate({
        period_start: periodStart,
        period_end: periodEnd,
        deductions: Object.keys(deductionPayload).length > 0 ? deductionPayload : undefined,
        teacher_ids: teacherRows.length > 0 && !allIncluded ? teacherIds : undefined,
        label: label.trim() === '' ? undefined : label.trim(),
      });
      onCalculated(result);
    });
  };

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      size="lg"
      title="Calculate payroll"
      subtitle="Creates a run for the period, or recalculates the existing draft run for it."
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
            Calculate
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

        <div className="form-grid">
          <DateField
            label="Period start"
            value={periodStart}
            onChange={setPeriodStart}
            required
            error={periodError ?? errors.period_start}
          />
          <DateField
            label="Period end"
            value={periodEnd}
            onChange={setPeriodEnd}
            required
            error={errors.period_end}
          />
          <TextField
            label="Label"
            value={label}
            onChange={setLabel}
            hint="Defaults to the period's month name."
            error={errors.label}
          />
        </div>

        <div>
          <h3 className="card__title">Teachers and deductions</h3>
          <p className="card__subtitle">
            Every included teacher is calculated from the salary policy in force at the end of the
            period and the lessons actually taught in it.
          </p>

          {!canPickTeachers ? (
            <div className="alert alert--info" role="status">
              <div className="alert__content">
                Without <code>teachers.view</code> the run is calculated for every active teacher and
                no per-teacher deductions can be entered.
              </div>
            </div>
          ) : teachers.loading && teachers.data === null ? (
            <LoadingState label="Loading teachers…" inline />
          ) : teachers.error !== null ? (
            <ErrorState error={teachers.error} onRetry={teachers.reload} />
          ) : teacherRows.length === 0 ? (
            <p className="u-muted">No active teachers found.</p>
          ) : (
            <Table<TeacherRow>
              dense
              paginated={false}
              rows={teacherRows}
              rowKey={(row) => row.id}
              caption="Deductions per teacher"
              columns={[
                {
                  key: 'teacher',
                  header: 'Teacher',
                  render: (row) => (
                    <div className="u-stack" style={{ gap: 0 }}>
                      <span>{row.full_name}</span>
                      <span className="u-subtle">{row.specialization || '—'}</span>
                    </div>
                  ),
                },
                {
                  key: 'include',
                  header: 'Include',
                  render: (row) => (
                    <IncludeToggle
                      teacher={row}
                      included={excluded[row.id] !== true}
                      onChange={(included) =>
                        setExcluded((current) => ({ ...current, [row.id]: !included }))
                      }
                    />
                  ),
                },
                {
                  key: 'deduction',
                  header: `Deduction (${currency.currency_code || 'currency'})`,
                  render: (row) => (
                    <TextField
                      label="Deduction"
                      labelHidden
                      small
                      inputMode="decimal"
                      placeholder="0.00"
                      value={deductions[row.id] ?? ''}
                      onChange={(value) =>
                        setDeductions((current) => ({ ...current, [row.id]: value }))
                      }
                      error={
                        (deductions[row.id] ?? '').trim() !== '' &&
                        !isDecimalInput(deductions[row.id] ?? '')
                          ? 'Enter an amount like 50000 or 50000.50.'
                          : undefined
                      }
                    />
                  ),
                },
              ]}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Checkbox with a stable id inside the deduction table. */
function IncludeToggle({
  teacher,
  included,
  onChange,
}: {
  teacher: TeacherRow;
  included: boolean;
  onChange: (included: boolean) => void;
}) {
  const id = useId();
  return (
    <label className="u-row" htmlFor={id} style={{ gap: 'var(--space-2)' }}>
      <input
        id={id}
        type="checkbox"
        checked={included}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={`Include ${teacher.full_name} in this run`}
      />
      <span className="u-muted">{included ? 'Included' : 'Excluded'}</span>
    </label>
  );
}

// --------------------------------------------------------------------------- //
// Pay a run
// --------------------------------------------------------------------------- //

interface PayRunDialogProps {
  run: PayrollRunRow;
  onClose: () => void;
  onPaid: () => void;
}

/**
 * Records payment of an approved run. The server books a "Teacher Salaries"
 * expense for the net total, so the expense ledger stays truthful.
 */
function PayRunDialog({ run, onClose, onPaid }: PayRunDialogProps) {
  const { currency } = useSettings();
  const [method, setMethod] = useState('bank_transfer');
  const [paidDate, setPaidDate] = useState(toIsoDate());
  const [reference, setReference] = useState('');
  const { busy, error, run: runSubmit } = useMutation();

  const errors = fieldErrorsOf(error);
  const general = messageLines(error);

  const submit = async (): Promise<void> => {
    await runSubmit(async () => {
      await financeApi.payroll.pay(run.id, {
        method,
        paid_date: paidDate === '' ? null : paidDate,
        reference: reference.trim(),
      });
      onPaid();
    });
  };

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      title={`Pay payroll for ${run.label}`}
      subtitle={`Net payable ${formatMoneyValue(run.total_net, currency)}`}
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
            Mark as paid
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
            Paying books a <strong>Teacher Salaries</strong> expense of{' '}
            {formatMoneyValue(run.total_net, currency)} in the expenses ledger. A paid run cannot be
            edited or recalculated.
          </div>
        </div>

        <div className="form-grid">
          <Select
            label="Method"
            options={PAYMENT_METHODS}
            value={method}
            onChange={(value) => setMethod(value === '' ? 'bank_transfer' : value)}
            error={errors.method}
          />
          <DateField
            label="Paid on"
            value={paidDate}
            onChange={setPaidDate}
            error={errors.paid_date}
          />
          <TextField
            label="Reference"
            value={reference}
            onChange={setReference}
            placeholder="Transfer or payslip reference"
            error={errors.reference}
          />
        </div>
      </div>
    </Modal>
  );
}

export default PayrollPage;
