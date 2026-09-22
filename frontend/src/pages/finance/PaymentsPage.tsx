import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Badge, StatusBadge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DateField } from '../../components/DateField';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { LoadingState } from '../../components/LoadingState';
import { Modal } from '../../components/Modal';
import { Pagination } from '../../components/Pagination';
import { SearchInput } from '../../components/SearchInput';
import { Select } from '../../components/Select';
import { StatCard } from '../../components/StatCard';
import { Table, type TableColumn } from '../../components/Table';
import { TextField } from '../../components/TextField';
import { useSettings } from '../../settings/SettingsContext';
import { PERMISSIONS, type QueryParams } from '../../types';
import { toIsoDate } from '../../utils/format';
import { teacherApi } from '../teachers/api';
import { financeApi, type BillingPeriodRow, type GenerateInvoicesResult, type InvoiceRow, type PaymentRow } from './api';
import { ReasonDialog } from './ReasonDialog';
import {
  PAYMENT_METHODS,
  currentMonthRange,
  fieldErrorsOf,
  formatMoneyValue,
  formatPeriodRange,
  formatPercentValue,
  isDecimalInput,
  isZeroMoney,
  messageLines,
  useMutation,
  useQueryData,
} from './shared';

/** Status tabs map onto the API's `status` / `overdue` filters. */
const STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partial', label: 'Partial' },
  { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
] as const;

type StatusTab = (typeof STATUS_TABS)[number]['value'];

const PAGE_SIZE = 25;

type Dialog =
  | { kind: 'none' }
  | { kind: 'record'; invoice: InvoiceRow }
  | { kind: 'transactions'; invoice: InvoiceRow }
  | { kind: 'void-payment'; invoice: InvoiceRow; payment: PaymentRow }
  | { kind: 'reason'; invoice: InvoiceRow; action: 'waive' | 'cancel' }
  | { kind: 'generate' };

/**
 * Invoice-centric money view.
 *
 * The table lists invoices (one row per student per billing period) and every
 * action hangs off a row: record a payment (prefilled from the invoice),
 * inspect the individual transactions, waive or cancel the invoice, or run the
 * idempotent monthly billing job.
 */
export function PaymentsPage() {
  const { hasPerm } = useAuth();
  const { currency, date } = useSettings();

  const canViewInvoices = hasPerm(PERMISSIONS.INVOICES_VIEW);
  const canManageInvoices = hasPerm(PERMISSIONS.INVOICES_MANAGE);
  const canManagePayments = hasPerm(PERMISSIONS.PAYMENTS_MANAGE);
  const canViewFinance = hasPerm(PERMISSIONS.FINANCE_VIEW);
  const canViewGroups = hasPerm(PERMISSIONS.GROUPS_VIEW);

  const today = toIsoDate();
  const [tab, setTab] = useState<StatusTab>('all');
  const [periodId, setPeriodId] = useState<number | ''>('');
  const [groupId, setGroupId] = useState<number | ''>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' });

  const params = useMemo<QueryParams>(
    () => ({
      page,
      page_size: PAGE_SIZE,
      status: tab === 'all' || tab === 'overdue' ? undefined : tab,
      overdue: tab === 'overdue' ? 1 : undefined,
      period: periodId === '' ? undefined : periodId,
      group: groupId === '' ? undefined : groupId,
      search: search.trim() === '' ? undefined : search.trim(),
    }),
    [page, tab, periodId, groupId, search],
  );

  const invoices = useQueryData(
    (signal) => financeApi.invoices.list(params, signal),
    [page, tab, periodId, groupId, search, refreshKey],
    canViewInvoices,
  );

  const periods = useQueryData(
    (signal) => financeApi.billingPeriods.list({ page_size: 100 }, signal),
    [refreshKey],
    canViewInvoices,
  );

  const groups = useQueryData(
    (signal) => teacherApi.groups.list({ page_size: 200 }, signal),
    [],
    canViewGroups,
  );

  const summaryRange = useMemo(() => {
    const selected = periods.data?.results.find((row) => row.id === periodId);
    if (selected !== undefined) {
      return { from: selected.period_start, to: selected.period_end };
    }
    return currentMonthRange(today);
  }, [periods.data, periodId, today]);

  const summary = useQueryData(
    (signal) => financeApi.summary.get({ from: summaryRange.from, to: summaryRange.to }, signal),
    [summaryRange.from, summaryRange.to, refreshKey],
    canViewFinance,
  );

  const outstanding = useQueryData(
    (signal) => financeApi.summary.outstanding(signal),
    [refreshKey],
    canViewFinance,
  );

  const money = (value: string | number | null | undefined): string => formatMoneyValue(value, currency);

  const periodOptions = useMemo(
    () =>
      (periods.data?.results ?? []).map((row: BillingPeriodRow) => ({
        value: row.id,
        label: `${row.label} (${date(row.period_start)} – ${date(row.period_end)})`,
      })),
    [periods.data, date],
  );

  const groupOptions = useMemo(
    () => (groups.data?.results ?? []).map((row) => ({ value: row.id, label: row.name })),
    [groups.data],
  );

  const invoiceRows = invoices.data?.results ?? [];

  const columns: ReadonlyArray<TableColumn<InvoiceRow>> = [
    {
      key: 'student',
      header: 'Student',
      render: (row) => (
        <div className="u-stack" style={{ gap: 0 }}>
          <Link to={`/students/${row.student}`} title="Open the student profile">
            {row.student_name}
          </Link>
          <span className="u-subtle u-mono">{row.student_code}</span>
        </div>
      ),
    },
    {
      key: 'period',
      header: 'Period',
      render: (row) => (
        <div className="u-stack" style={{ gap: 0 }}>
          <span>{row.period_label}</span>
          <span className="u-subtle">{row.group_name || 'No group'}</span>
        </div>
      ),
    },
    {
      key: 'amount_due',
      header: 'Amount due',
      align: 'right',
      render: (row) => money(row.amount_due),
    },
    {
      key: 'amount_paid',
      header: 'Paid',
      align: 'right',
      render: (row) => money(row.amount_paid),
    },
    {
      key: 'remaining',
      header: 'Remaining',
      align: 'right',
      render: (row) =>
        isZeroMoney(row.remaining) ? (
          <span className="u-subtle">—</span>
        ) : (
          <strong>{money(row.remaining)}</strong>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <div className="u-stack" style={{ gap: 2 }}>
          <StatusBadge status={row.display_status} />
          {!isZeroMoney(row.credit) ? (
            <Badge tone="info" title="Overpayment credit on this invoice">
              Credit {money(row.credit)}
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: 'due_date',
      header: 'Due',
      render: (row) => (
        <div className="u-stack" style={{ gap: 0 }}>
          <span>{date(row.due_date)}</span>
          {row.days_overdue > 0 ? (
            <span className="u-muted">
              {row.days_overdue === 1 ? '1 day overdue' : `${row.days_overdue} days overdue`}
            </span>
          ) : null}
        </div>
      ),
    },
  ];

  if (!canViewInvoices) {
    return (
      <div className="u-stack" style={{ gap: 'var(--space-5)' }}>
        <header className="page-header">
          <div className="page-header__heading">
            <h1 className="page-header__title">Payments</h1>
            <p className="page-header__subtitle">Invoices and payments</p>
          </div>
        </header>
        <Card title="Not available">
          <div className="alert alert--info" role="status">
            <div className="alert__content">
              Your role does not include the <code>invoices.view</code> permission.
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
          <h1 className="page-header__title">Payments</h1>
          <p className="page-header__subtitle">
            One row per student per billing period — record payments, inspect transactions and chase
            the overdue balances.
          </p>
        </div>
        <div className="page-header__actions">
          {canManageInvoices ? (
            <Button icon="plus" variant="primary" onClick={() => setDialog({ kind: 'generate' })}>
              Generate invoices
            </Button>
          ) : null}
        </div>
      </header>

      {canViewFinance ? (
        <Card
          title="Money owed and collected"
          subtitle={
            periodId === '' ? 'Current month to date' : `${date(summaryRange.from)} – ${date(summaryRange.to)}`
          }
        >
          {summary.loading && summary.data === null && outstanding.data === null ? (
            <LoadingState label="Loading invoice figures…" />
          ) : null}

          {summary.error !== null ? (
            <ErrorState error={summary.error} onRetry={summary.reload} />
          ) : null}
          {outstanding.error !== null ? (
            <ErrorState error={outstanding.error} onRetry={outstanding.reload} />
          ) : null}

          {summary.data !== null || outstanding.data !== null ? (
            <div className="kpi-grid">
              <StatCard
                label="Amount due (open invoices)"
                icon="wallet"
                loading={outstanding.data === null}
                value={outstanding.data === null ? '—' : money(outstanding.data.amount)}
                hint={
                  outstanding.data === null
                    ? undefined
                    : `${outstanding.data.count} open ${
                        outstanding.data.count === 1 ? 'invoice' : 'invoices'
                      }`
                }
              />
              <StatCard
                label="Collected in range"
                icon="checkCircle"
                loading={summary.data === null}
                value={summary.data === null ? '—' : money(summary.data.student_fees)}
                hint="Student fee payments received"
              />
              <StatCard
                label="Overdue amount"
                icon="alert"
                loading={outstanding.data === null}
                value={outstanding.data === null ? '—' : money(outstanding.data.overdue_amount)}
                hint={
                  outstanding.data === null
                    ? undefined
                    : `${outstanding.data.overdue_count} past the due date`
                }
              />
              <StatCard
                label="Collection rate"
                icon="chartLine"
                loading={summary.data === null}
                value={summary.data === null ? '—' : formatPercentValue(summary.data.collection_rate)}
                hint="Collected ÷ (collected + outstanding)"
              />
            </div>
          ) : null}

          {outstanding.data !== null ? (
            <div style={{ marginTop: 'var(--space-5)' }}>
              <Table
                caption="Overdue ageing buckets"
                paginated={false}
                dense
                rows={Object.entries(outstanding.data.buckets).map(([label, bucket]) => ({
                  label,
                  count: bucket.count,
                  amount: bucket.amount,
                }))}
                rowKey={(row) => row.label}
                columns={[
                  { key: 'bucket', header: 'Overdue ageing', render: (row) => row.label },
                  {
                    key: 'count',
                    header: 'Invoices',
                    align: 'right',
                    render: (row) =>
                      row.count === 0 ? <span className="u-subtle">0</span> : String(row.count),
                  },
                  {
                    key: 'amount',
                    header: 'Amount',
                    align: 'right',
                    render: (row) => money(row.amount),
                  },
                ]}
              />
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card flush>
        <div className="filter-bar">
          <div className="btn-group" role="tablist" aria-label="Invoice status">
            {STATUS_TABS.map((entry) => (
              <Button
                key={entry.value}
                size="sm"
                variant={tab === entry.value ? 'primary' : 'ghost'}
                role="tab"
                aria-selected={tab === entry.value}
                onClick={() => {
                  setTab(entry.value);
                  setPage(1);
                }}
              >
                {entry.label}
              </Button>
            ))}
          </div>

          <div className="filter-bar__field u-grow">
            <SearchInput
              value={search}
              onChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
              placeholder="Student name, code or period"
              label="Search invoices"
              small
            />
          </div>

          <div className="filter-bar__field">
            <Select<number>
              small
              label="Period"
              placeholder="All periods"
              options={periodOptions}
              value={periodId}
              onChange={(value) => {
                setPeriodId(value);
                setPage(1);
              }}
            />
          </div>

          {canViewGroups ? (
            <div className="filter-bar__field">
              <Select<number>
                small
                label="Group"
                placeholder="All groups"
                options={groupOptions}
                value={groupId}
                onChange={(value) => {
                  setGroupId(value);
                  setPage(1);
                }}
              />
            </div>
          ) : null}
        </div>

        <Table<InvoiceRow>
          paginated={false}
          stickyHeader
          rows={invoiceRows}
          rowKey={(row) => row.id}
          columns={columns}
          loading={invoices.loading && invoices.data === null}
          error={invoices.error}
          onRetry={invoices.reload}
          emptyIcon="wallet"
          emptyTitle="No invoices match these filters"
          emptyMessage="Adjust the status tab, period or group, or run 'Generate invoices' to bill the current period."
          actions={(row) => (
            <div className="u-row" style={{ justifyContent: 'flex-end' }}>
              {canManagePayments ? (
                <Button
                  size="sm"
                  variant="primary"
                  icon="wallet"
                  disabled={row.display_status === 'waived' || row.display_status === 'cancelled'}
                  title={
                    row.display_status === 'waived' || row.display_status === 'cancelled'
                      ? 'This invoice cannot take payments'
                      : 'Record a payment for this invoice'
                  }
                  onClick={() => setDialog({ kind: 'record', invoice: row })}
                >
                  Record payment
                </Button>
              ) : null}
              <Button
                size="sm"
                icon="eye"
                onClick={() => setDialog({ kind: 'transactions', invoice: row })}
              >
                Transactions
              </Button>
              {canManageInvoices ? (
                <>
                  <Button
                    size="sm"
                    onClick={() => setDialog({ kind: 'reason', invoice: row, action: 'waive' })}
                    disabled={row.display_status === 'waived'}
                  >
                    Waive
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setDialog({ kind: 'reason', invoice: row, action: 'cancel' })}
                    disabled={row.display_status === 'cancelled'}
                  >
                    Cancel
                  </Button>
                </>
              ) : null}
            </div>
          )}
          footer={
            invoices.data !== null && invoices.data.count > 0 ? (
              <Pagination
                page={invoices.data.page}
                totalPages={invoices.data.total_pages}
                totalItems={invoices.data.count}
                pageSize={invoices.data.page_size}
                itemLabel="invoices"
                onPageChange={setPage}
              />
            ) : undefined
          }
        />
      </Card>

      {/* --- Dialogs: exactly one at a time, so focus handling stays simple --- */}

      {dialog.kind === 'record' ? (
        <RecordPaymentDialog
          invoice={dialog.invoice}
          onClose={() => setDialog({ kind: 'none' })}
          onSaved={() => {
            setDialog({ kind: 'none' });
            setRefreshKey((value) => value + 1);
          }}
        />
      ) : null}

      {dialog.kind === 'transactions' ? (
        <InvoiceTransactionsDialog
          invoice={dialog.invoice}
          canVoid={canManagePayments}
          canRecord={canManagePayments}
          onClose={() => setDialog({ kind: 'none' })}
          onRecord={() => setDialog({ kind: 'record', invoice: dialog.invoice })}
          onVoid={(payment) => setDialog({ kind: 'void-payment', invoice: dialog.invoice, payment })}
        />
      ) : null}

      {dialog.kind === 'void-payment' ? (
        <ReasonDialog
          open
          title={`Void payment ${dialog.payment.receipt}`}
          confirmLabel="Void payment"
          reasonLabel="Void reason"
          message={
            <div className="u-stack">
              <p>
                Voiding <strong>{dialog.payment.receipt}</strong> ({money(dialog.payment.amount)},{' '}
                {dialog.payment.method_label}) returns the amount to the outstanding balance of{' '}
                {dialog.invoice.student_name}&apos;s invoice. Payments are never edited or deleted —
                the transaction stays on record, marked void.
              </p>
            </div>
          }
          onCancel={() => setDialog({ kind: 'transactions', invoice: dialog.invoice })}
          onConfirm={async (reason) => {
            await financeApi.payments.void(dialog.payment.id, reason);
            setRefreshKey((value) => value + 1);
          }}
        />
      ) : null}

      {dialog.kind === 'reason' ? (
        <ReasonDialog
          open
          title={dialog.action === 'waive' ? 'Waive this invoice' : 'Cancel this invoice'}
          confirmLabel={dialog.action === 'waive' ? 'Waive invoice' : 'Cancel invoice'}
          message={
            <p>
              {dialog.action === 'waive'
                ? `Waiving stops ${dialog.invoice.student_name}'s ${dialog.invoice.period_label} invoice from being collected. The reason is stored on the invoice and shown in the audit log.`
                : `Cancelling removes the ${dialog.invoice.period_label} charge of ${money(dialog.invoice.amount_due)} from ${dialog.invoice.student_name}. An invoice that already has payments cannot be cancelled — void those payments first.`}
            </p>
          }
          onCancel={() => setDialog({ kind: 'none' })}
          onConfirm={async (reason) => {
            if (dialog.action === 'waive') {
              await financeApi.invoices.waive(dialog.invoice.id, reason);
            } else {
              await financeApi.invoices.cancel(dialog.invoice.id, reason);
            }
            setRefreshKey((value) => value + 1);
          }}
        />
      ) : null}

      {dialog.kind === 'generate' ? (
        <GenerateInvoicesDialog
          groups={groupOptions}
          defaultDueDate={today}
          onClose={() => setDialog({ kind: 'none' })}
          onGenerated={() => setRefreshKey((value) => value + 1)}
        />
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Record payment
// --------------------------------------------------------------------------- //

interface RecordPaymentDialogProps {
  invoice: InvoiceRow;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Payment form for one invoice, prefilled with everything the system already
 * knows: the student, the invoice, the outstanding balance and today's date.
 */
function RecordPaymentDialog({ invoice, onClose, onSaved }: RecordPaymentDialogProps) {
  const { currency, date } = useSettings();
  const overpaymentId = useId();
  const [amount, setAmount] = useState(invoice.remaining);
  const [paidAt, setPaidAt] = useState(toIsoDate());
  const [method, setMethod] = useState<string>('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [allowOverpayment, setAllowOverpayment] = useState(isZeroMoney(invoice.remaining));
  const [touched, setTouched] = useState(false);
  const { busy, error, run } = useMutation();

  const errors = fieldErrorsOf(error);
  const general = messageLines(error);
  const remainingZero = isZeroMoney(invoice.remaining);

  const amountError =
    touched && amount.trim() === ''
      ? 'An amount is required.'
      : touched && !isDecimalInput(amount)
        ? 'Enter an amount like 250000 or 250000.50.'
        : touched && isZeroMoney(amount)
          ? 'A payment must be greater than zero.'
          : undefined;

  const submit = async (): Promise<void> => {
    setTouched(true);
    if (amountError !== undefined || amount.trim() === '') return;
    await run(async () => {
      await financeApi.payments.create({
        student: invoice.student,
        amount: amount.trim(),
        invoice: invoice.id,
        method,
        paid_at: paidAt === '' ? null : paidAt,
        reference: reference.trim(),
        notes: notes.trim(),
        allow_overpayment: allowOverpayment,
      });
      onSaved();
    });
  };

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      title="Record a payment"
      subtitle="The amount is checked against the invoice by the server."
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
            Record payment
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

        <div
          className="u-stack"
          style={{ gap: 'var(--space-2)', background: 'var(--color-surface-muted)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)' }}
        >
          <div className="u-row u-row--between">
            <span className="u-muted">Student</span>
            <span>
              {invoice.student_name} <span className="u-subtle u-mono">{invoice.student_code}</span>
            </span>
          </div>
          <div className="u-row u-row--between">
            <span className="u-muted">Invoice</span>
            <span>
              {invoice.period_label}
              {invoice.group_name === '' ? '' : ` · ${invoice.group_name}`}
            </span>
          </div>
          <div className="u-row u-row--between">
            <span className="u-muted">Amount due</span>
            <span>{formatMoneyValue(invoice.amount_due, currency)}</span>
          </div>
          <div className="u-row u-row--between">
            <span className="u-muted">Already paid</span>
            <span>{formatMoneyValue(invoice.amount_paid, currency)}</span>
          </div>
          <div className="u-row u-row--between">
            <span className="u-muted">Outstanding</span>
            <strong>{formatMoneyValue(invoice.remaining, currency)}</strong>
          </div>
          <div className="u-row u-row--between">
            <span className="u-muted">Due date</span>
            <span>{date(invoice.due_date)}</span>
          </div>
        </div>

        <div className="form-grid">
          <TextField
            label="Amount"
            value={amount}
            onChange={setAmount}
            required
            inputMode="decimal"
            placeholder="0.00"
            error={amountError ?? errors.amount}
            hint={`Outstanding balance: ${formatMoneyValue(invoice.remaining, currency)}`}
          />
          <DateField
            label="Paid on"
            value={paidAt}
            onChange={setPaidAt}
            required
            error={errors.paid_at}
          />
          <Select
            label="Method"
            options={PAYMENT_METHODS}
            value={method}
            onChange={(value) => setMethod(value === '' ? 'cash' : value)}
            error={errors.method}
          />
          <TextField
            label="Reference"
            value={reference}
            onChange={setReference}
            placeholder="Bank slip / receipt number"
            error={errors.reference}
          />
        </div>

        <TextField label="Notes" value={notes} onChange={setNotes} error={errors.notes} />

        <div className="field">
          <label className="field__label" htmlFor={overpaymentId}>
            <input
              id={overpaymentId}
              type="checkbox"
              checked={allowOverpayment}
              onChange={(event) => setAllowOverpayment(event.target.checked)}
            />{' '}
            Allow overpayment (prepayment)
          </label>
          <p className="field__hint">
            {remainingZero
              ? 'This invoice is already settled. Leave this ticked to record the amount as credit for the student.'
              : 'Only needed when the amount is larger than the outstanding balance. The server refuses prepayments without it.'}
          </p>
        </div>
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------------------- //
// Transactions of one invoice
// --------------------------------------------------------------------------- //

interface InvoiceTransactionsDialogProps {
  invoice: InvoiceRow;
  canVoid: boolean;
  canRecord: boolean;
  onClose: () => void;
  onRecord: () => void;
  onVoid: (payment: PaymentRow) => void;
}

/** The individual money-in transactions behind one invoice. */
function InvoiceTransactionsDialog({
  invoice,
  canVoid,
  canRecord,
  onClose,
  onRecord,
  onVoid,
}: InvoiceTransactionsDialogProps) {
  const { currency, date } = useSettings();
  const payments = useQueryData(
    (signal) => financeApi.payments.list({ invoice: invoice.id, page_size: 100 }, signal),
    [invoice.id],
  );

  const rows = payments.data?.results ?? [];

  const columns: ReadonlyArray<TableColumn<PaymentRow>> = [
    {
      key: 'receipt',
      header: 'Receipt',
      render: (row) => <span className="u-mono">{row.receipt}</span>,
    },
    { key: 'paid_at', header: 'Date', render: (row) => date(row.paid_at) },
    { key: 'method', header: 'Method', render: (row) => row.method_label },
    {
      key: 'received_by',
      header: 'Received by',
      render: (row) => row.received_by_name || <span className="u-subtle">—</span>,
    },
    {
      key: 'reference',
      header: 'Reference',
      render: (row) => row.reference || <span className="u-subtle">—</span>,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (row) => formatMoneyValue(row.amount, currency),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) =>
        row.is_void ? (
          <Badge tone="danger" title={row.void_reason}>
            Void
          </Badge>
        ) : (
          <Badge tone="success" dot>
            Received
          </Badge>
        ),
    },
  ];

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={`Transactions — ${invoice.student_name}`}
      subtitle={`${invoice.period_label} · due ${date(invoice.due_date)} · outstanding ${formatMoneyValue(
        invoice.remaining,
        currency,
      )}`}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          {canRecord ? (
            <Button variant="primary" icon="wallet" onClick={onRecord}>
              Record payment
            </Button>
          ) : null}
        </>
      }
    >
      <div className="u-stack" style={{ gap: 'var(--space-4)' }}>
        <div className="kpi-grid">
          <StatCard label="Amount due" value={formatMoneyValue(invoice.amount_due, currency)} />
          <StatCard label="Paid" value={formatMoneyValue(invoice.amount_paid, currency)} />
          <StatCard label="Outstanding" value={formatMoneyValue(invoice.remaining, currency)} />
          {isZeroMoney(invoice.credit) ? null : (
            <StatCard label="Credit" value={formatMoneyValue(invoice.credit, currency)} />
          )}
        </div>

        <Table<PaymentRow>
          dense
          rows={rows}
          rowKey={(row) => row.id}
          columns={columns}
          loading={payments.loading && payments.data === null}
          error={payments.error}
          onRetry={payments.reload}
          emptyIcon="wallet"
          emptyTitle="No payments recorded yet"
          emptyMessage="Use “Record payment” to add the first transaction for this invoice."
          paginated={false}
          actions={
            canVoid
              ? (row) =>
                  row.is_void ? (
                    <span className="u-subtle" title={row.void_reason}>
                      {row.voided_at === null ? 'void' : `void ${date(row.voided_at)}`}
                    </span>
                  ) : (
                    <Button size="sm" variant="danger" onClick={() => onVoid(row)}>
                      Void
                    </Button>
                  )
              : undefined
          }
        />
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------------------- //
// Generate invoices
// --------------------------------------------------------------------------- //

interface GenerateInvoicesDialogProps {
  groups: ReadonlyArray<{ value: number; label: string }>;
  defaultDueDate: string;
  onClose: () => void;
  onGenerated: () => void;
}

/**
 * Runs POST /billing-periods/generate/. The endpoint is idempotent: running it
 * twice for the same month creates nothing new, and the returned summary is
 * shown verbatim.
 */
function GenerateInvoicesDialog({
  groups,
  defaultDueDate,
  onClose,
  onGenerated,
}: GenerateInvoicesDialogProps) {
  const { currency, date } = useSettings();
  const today = toIsoDate();
  const [year, setYear] = useState(today.slice(0, 4));
  const [month, setMonth] = useState(today.slice(5, 7));
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [groupId, setGroupId] = useState<number | ''>('');
  const [touched, setTouched] = useState(false);
  const [result, setResult] = useState<GenerateInvoicesResult | null>(null);
  const { busy, error, run } = useMutation();

  const errors = fieldErrorsOf(error);
  const general = messageLines(error);

  const yearValue = Number.parseInt(year, 10);
  const monthValue = Number.parseInt(month, 10);
  const yearError =
    touched && (!Number.isInteger(yearValue) || yearValue < 2000 || yearValue > 2100)
      ? 'Enter a year between 2000 and 2100.'
      : undefined;

  const monthOptions = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => {
        const value = String(index + 1).padStart(2, '0');
        const label = new Intl.DateTimeFormat(undefined, { month: 'long' }).format(
          new Date(2026, index, 1),
        );
        return { value, label };
      }),
    [],
  );

  const submit = async (): Promise<void> => {
    setTouched(true);
    if (yearError !== undefined) return;
    await run(async () => {
      const generated = await financeApi.billingPeriods.generate({
        year: yearValue,
        month: monthValue,
        due_date: dueDate === '' ? undefined : dueDate,
        group: groupId === '' ? undefined : groupId,
      });
      setResult(generated);
      onGenerated();
    });
  };

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      size="lg"
      title="Generate invoices"
      subtitle="Bills every active student with a monthly fee for the chosen period."
      closeOnBackdrop={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {result === null ? 'Cancel' : 'Close'}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={result !== null}
            onClick={() => {
              void submit();
            }}
          >
            {result === null ? 'Generate invoices' : 'Generated'}
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
            This run is idempotent: students who already have an invoice for the period are skipped,
            so it is safe to press more than once.
          </div>
        </div>

        {result === null ? (
          <div className="form-grid">
            <TextField
              label="Year"
              value={year}
              onChange={setYear}
              required
              inputMode="numeric"
              error={yearError ?? errors.year}
            />
            <Select
              label="Month"
              options={monthOptions}
              value={month}
              onChange={(value) => setMonth(value === '' ? today.slice(5, 7) : value)}
              required
              error={errors.month}
            />
            <DateField
              label="Due date"
              value={dueDate}
              onChange={setDueDate}
              hint="Defaults to the centre's billing day."
              error={errors.due_date}
            />
            <Select<number>
              label="Group"
              placeholder="Every group"
              options={groups}
              value={groupId}
              onChange={setGroupId}
              hint="Optional: restrict the run to one group."
              error={errors.group}
            />
          </div>
        ) : (
          <div className="u-stack" style={{ gap: 'var(--space-3)' }}>
            <div className="kpi-grid">
              <StatCard label="Period" value={result.period} />
              <StatCard label="Invoices created" value={String(result.created)} icon="checkCircle" />
              <StatCard
                label="Skipped (already billed)"
                value={String(result.skipped_existing)}
                hint="Idempotent run"
              />
              <StatCard
                label="Skipped (no fee)"
                value={String(result.skipped_no_fee)}
                hint="Students without a monthly fee"
              />
            </div>

            {result.invoices.length === 0 ? (
              <EmptyState
                icon="checkCircle"
                title="Nothing new was billed"
                message={`Every eligible student already has an invoice for ${result.period}.`}
              />
            ) : (
              <Table
                dense
                paginated={false}
                rows={result.invoices}
                rowKey={(row) => row.id}
                caption={`Invoices created for ${result.period}`}
                columns={[
                  {
                    key: 'student',
                    header: 'Student',
                    render: (row) => (
                      <div className="u-stack" style={{ gap: 0 }}>
                        <span>{row.student_name}</span>
                        <span className="u-subtle u-mono">{row.student_code}</span>
                      </div>
                    ),
                  },
                  { key: 'group', header: 'Group', render: (row) => row.group_name || '—' },
                  {
                    key: 'flag',
                    header: 'Period',
                    render: (row) => formatPeriodRange(row.period_start, row.period_end),
                  },
                  {
                    key: 'amount_due',
                    header: 'Amount due',
                    align: 'right',
                    render: (row) => formatMoneyValue(row.amount_due, currency),
                  },
                  { key: 'due_date', header: 'Due', render: (row) => date(row.due_date) },
                ]}
              />
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

export default PaymentsPage;
