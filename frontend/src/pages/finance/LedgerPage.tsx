import { useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DateField } from '../../components/DateField';
import { ErrorState } from '../../components/ErrorState';
import { LoadingState } from '../../components/LoadingState';
import { Modal } from '../../components/Modal';
import { SearchInput } from '../../components/SearchInput';
import { Select } from '../../components/Select';
import { Table, type TableColumn } from '../../components/Table';
import { TextField } from '../../components/TextField';
import { useSettings } from '../../settings/SettingsContext';
import { PERMISSIONS, type QueryParams } from '../../types';
import { toIsoDate } from '../../utils/format';
import { financeApi, loadAllPages, type LedgerRow, type LedgerWritePayload } from './api';
import { FinanceOverviewSection } from './FinanceOverviewSection';
import { ReasonDialog } from './ReasonDialog';
import {
  PAYMENT_METHODS,
  currentMonthRange,
  fieldErrorsOf,
  formatMoneyValue,
  isDecimalInput,
  isZeroMoney,
  labelFor,
  messageLines,
  optionsWithObserved,
  useMutation,
  useQueryData,
  type Option,
} from './shared';

/** The list API pages at 200 max; ten pages caps a ledger load at 2 000 rows. */
const LEDGER_PAGE_SIZE = 200;
const LEDGER_MAX_PAGES = 10;
const LEDGER_ROW_CAP = LEDGER_PAGE_SIZE * LEDGER_MAX_PAGES;

const VOID_FILTERS: ReadonlyArray<Option> = [
  { value: 'active', label: 'Active records' },
  { value: 'void', label: 'Voided only' },
  { value: 'all', label: 'All records' },
];

export interface LedgerPageProps {
  title: string;
  subtitle: string;
  /** Which ledger this page drives; selects the endpoint and breakdown key. */
  variant: 'income' | 'expenses';
  /** Permission required to add, edit or void a record. */
  managePermission: string;
  categories: ReadonlyArray<Option>;
  /** Singular noun used in labels and confirmations ("income"/"expense"). */
  noun: string;
  /** Extra context rendered under the filters (e.g. the payroll note). */
  footnote?: ReactNode;
}

/**
 * Income and Expense ledgers share this implementation: a filtered, paginated
 * list of real rows plus the server's per-category totals for the same range
 * (/api/finance/summary/breakdown/). Records are never deleted - only voided
 * with a reason.
 */
export function LedgerPage({
  title,
  subtitle,
  variant,
  managePermission,
  categories,
  noun,
  footnote,
}: LedgerPageProps) {
  const { hasPerm } = useAuth();
  const { currency, date } = useSettings();
  const canManage = hasPerm(managePermission);
  const canViewFinance = hasPerm(PERMISSIONS.FINANCE_VIEW);

  const today = toIsoDate();
  const [range, setRange] = useState(currentMonthRange(today));
  const [category, setCategory] = useState('');
  const [method, setMethod] = useState('');
  const [voidFilter, setVoidFilter] = useState('active');
  const [search, setSearch] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [editing, setEditing] = useState<LedgerRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<LedgerRow | null>(null);

  const endpoint = variant === 'income' ? financeApi.income : financeApi.expenses;

  const records = useQueryData(
    (signal) =>
      loadAllPages<LedgerRow>((page, pageSignal) => {
        const params: QueryParams = {
          page,
          page_size: LEDGER_PAGE_SIZE,
          category: category === '' ? undefined : category,
          method: method === '' ? undefined : method,
          is_void: voidFilter === 'all' ? undefined : voidFilter === 'void',
          search: search.trim() === '' ? undefined : search.trim(),
          ordering: '-date',
        };
        return endpoint.list(params, pageSignal);
      }, signal, LEDGER_MAX_PAGES),
    [category, method, voidFilter, search, refreshKey],
  );

  const breakdown = useQueryData(
    (signal) => financeApi.summary.breakdown({ from: range.from, to: range.to }, signal),
    [range.from, range.to, refreshKey],
    canViewFinance,
  );

  const categoryOptions = useMemo(
    () => optionsWithObserved(categories, (records.data ?? []).map((row: LedgerRow) => row.category)),
    [categories, records.data],
  );

  const loadedRows = records.data ?? [];
  // The list API only filters by exact date, so the range narrows the loaded
  // rows by comparing ISO date strings (never money arithmetic).
  const rows = useMemo(
    () =>
      loadedRows.filter((row) => {
        if (range.from !== '' && row.date < range.from) return false;
        if (range.to !== '' && row.date > range.to) return false;
        return true;
      }),
    [loadedRows, range.from, range.to],
  );
  const cappedAtLimit = loadedRows.length >= LEDGER_ROW_CAP;
  const money = (value: string | number | null | undefined): string => formatMoneyValue(value, currency);

  const breakdownRows = useMemo(() => {
    if (breakdown.data === null) return [];
    return variant === 'income'
      ? breakdown.data.income.map((row) => ({
          category: row.category,
          amount: row.amount,
          count: null as number | null,
        }))
      : breakdown.data.expenses.map((row) => ({
          category: row.category,
          amount: row.amount,
          count: row.count as number | null,
        }));
  }, [breakdown.data, variant]);

  const columns: ReadonlyArray<TableColumn<LedgerRow>> = [
    { key: 'date', header: 'Date', render: (row) => date(row.date) },
    {
      key: 'category',
      header: 'Category',
      render: (row) => (
        <div className="u-stack" style={{ gap: 0 }}>
          <span>{row.category_label_display || labelFor(categories, row.category)}</span>
          {row.category_label !== '' ? (
            <span className="u-subtle">custom label · {labelFor(categories, row.category)}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      render: (row) => row.description || <span className="u-subtle">—</span>,
    },
    { key: 'method', header: 'Method', render: (row) => row.method_label },
    {
      key: 'reference',
      header: 'Reference',
      render: (row) => row.reference || <span className="u-subtle">—</span>,
    },
    {
      key: 'created_by',
      header: 'Recorded by',
      render: (row) => row.created_by_name || <span className="u-subtle">—</span>,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (row) =>
        row.is_void ? (
          <span className="u-muted" style={{ textDecoration: 'line-through' }}>
            {money(row.amount)}
          </span>
        ) : (
          <strong>{money(row.amount)}</strong>
        ),
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
            Active
          </Badge>
        ),
    },
  ];

  return (
    <div className="u-stack" style={{ gap: 'var(--space-5)' }}>
      <header className="page-header">
        <div className="page-header__heading">
          <h1 className="page-header__title">{title}</h1>
          <p className="page-header__subtitle">{subtitle}</p>
        </div>
        <div className="page-header__actions">
          {canManage ? (
            <Button
              variant="primary"
              icon="plus"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              Add {noun}
            </Button>
          ) : null}
        </div>
      </header>

      <FinanceOverviewSection
        from={range.from}
        to={range.to}
        title={`Centre-wide figures for ${date(range.from)} – ${date(range.to)}`}
      />

      <Card
        title={`${variant === 'income' ? 'Income' : 'Expense'} by category`}
        subtitle="Totals for the selected date range, straight from /api/finance/summary/breakdown/"
      >
        {!canViewFinance ? (
          <div className="alert alert--info" role="status">
            <div className="alert__content">
              Category totals need the <code>finance.view</code> permission.
            </div>
          </div>
        ) : breakdown.loading && breakdown.data === null ? (
          <LoadingState label="Loading category totals…" />
        ) : breakdown.error !== null ? (
          <ErrorState error={breakdown.error} onRetry={breakdown.reload} />
        ) : (
          <Table
            dense
            paginated={false}
            rows={breakdownRows}
            rowKey={(row) => row.category}
            caption="Category totals"
            columns={[
              { key: 'category', header: 'Category', render: (row) => row.category },
              {
                key: 'count',
                header: 'Records',
                align: 'right',
                render: (row) => (row.count === null ? <span className="u-subtle">—</span> : String(row.count)),
              },
              {
                key: 'amount',
                header: 'Amount',
                align: 'right',
                render: (row) => money(row.amount),
              },
            ]}
            emptyTitle="Nothing recorded in this range"
            emptyMessage="No income or expense rows exist between the selected dates."
          />
        )}
      </Card>

      <Card flush>
        <div className="filter-bar">
          <div className="filter-bar__field">
            <DateField
              small
              label="From"
              value={range.from}
              hint="Applied to the loaded rows"
              onChange={(value) => {
                setRange((current) => ({ ...current, from: value }));
              }}
            />
          </div>
          <div className="filter-bar__field">
            <DateField
              small
              label="To"
              value={range.to}
              onChange={(value) => {
                setRange((current) => ({ ...current, to: value }));
              }}
            />
          </div>
          <div className="filter-bar__field">
            <Select
              small
              label="Category"
              placeholder="All categories"
              options={categoryOptions}
              value={category}
              onChange={(value) => {
                setCategory(value);
              }}
            />
          </div>
          <div className="filter-bar__field">
            <Select
              small
              label="Method"
              placeholder="All methods"
              options={PAYMENT_METHODS}
              value={method}
              onChange={(value) => {
                setMethod(value);
              }}
            />
          </div>
          <div className="filter-bar__field">
            <Select
              small
              label="Status"
              options={VOID_FILTERS}
              value={voidFilter}
              onChange={(value) => {
                setVoidFilter(value === '' ? 'active' : value);
              }}
            />
          </div>
          <div className="filter-bar__field u-grow">
            <SearchInput
              small
              value={search}
              onChange={(value) => {
                setSearch(value);
              }}
              placeholder="Description or reference"
              label={`Search ${noun}`}
            />
          </div>
        </div>

        {cappedAtLimit ? (
          <div style={{ padding: 'var(--space-3) var(--space-4)' }}>
            <div className="alert alert--warning" role="status">
              <div className="alert__content">
                Only the first {LEDGER_ROW_CAP} matching records were loaded — narrow the category,
                method or search filter for an exact list.
              </div>
            </div>
          </div>
        ) : null}

        {footnote !== undefined && footnote !== null ? (
          <div style={{ padding: 'var(--space-3) var(--space-4)' }}>
            <div className="alert alert--info" role="status">
              <div className="alert__content">{footnote}</div>
            </div>
          </div>
        ) : null}

        <Table<LedgerRow>
          initialPageSize={25}
          stickyHeader
          rows={rows}
          rowKey={(row) => row.id}
          columns={columns}
          loading={records.loading && records.data === null}
          error={records.error}
          onRetry={records.reload}
          emptyIcon="finance"
          emptyTitle={`No ${variant} found`}
          emptyMessage="Widen the date range or clear the filters. Voided records are hidden unless you switch the status filter."
          caption={`${variant} records`}
          actions={
            canManage
              ? (row) => (
                  <div className="u-row" style={{ justifyContent: 'flex-end' }}>
                    <Button
                      size="sm"
                      icon="edit"
                      disabled={row.is_void}
                      title={row.is_void ? 'Voided records cannot be edited' : `Edit this ${noun}`}
                      onClick={() => {
                        setEditing(row);
                        setFormOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={row.is_void}
                      onClick={() => setVoidTarget(row)}
                    >
                      Void
                    </Button>
                  </div>
                )
              : undefined
          }
        />
      </Card>

      {formOpen ? (
        <LedgerFormDialog
          record={editing}
          noun={noun}
          categories={categoryOptions}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSubmit={async (payload) => {
            if (editing === null) {
              await endpoint.create(payload);
            } else {
              await endpoint.update(editing.id, payload);
            }
            setRefreshKey((value) => value + 1);
          }}
        />
      ) : null}

      {voidTarget !== null ? (
        <ReasonDialog
          open
          title={`Void this ${noun}`}
          confirmLabel={`Void ${noun}`}
          message={
            <p>
              Voiding {money(voidTarget.amount)} recorded on {date(voidTarget.date)} (
              {voidTarget.category_label_display}) removes it from every total. The record stays in
              the ledger, marked void, with your reason.
            </p>
          }
          onCancel={() => setVoidTarget(null)}
          onConfirm={async (reason) => {
            await endpoint.void(voidTarget.id, reason);
            setRefreshKey((value) => value + 1);
          }}
        />
      ) : null}
    </div>
  );
}

interface LedgerFormDialogProps {
  record: LedgerRow | null;
  noun: string;
  categories: ReadonlyArray<Option>;
  onClose: () => void;
  onSubmit: (payload: LedgerWritePayload) => Promise<void>;
}

/** Add / edit form. Amounts are sent as the exact decimal string typed. */
function LedgerFormDialog({ record, noun, categories, onClose, onSubmit }: LedgerFormDialogProps) {
  const isEdit = record !== null;
  const [category, setCategory] = useState(record?.category ?? '');
  const [categoryLabel, setCategoryLabel] = useState(record?.category_label ?? '');
  const [amount, setAmount] = useState(record?.amount ?? '');
  const [dateValue, setDateValue] = useState(record?.date ?? toIsoDate());
  const [description, setDescription] = useState(record?.description ?? '');
  const [method, setMethod] = useState(record?.method ?? 'cash');
  const [reference, setReference] = useState(record?.reference ?? '');
  const [touched, setTouched] = useState(false);
  const { busy, error, run } = useMutation();

  const errors = fieldErrorsOf(error);
  const general = messageLines(error);

  const categoryError = touched && category === '' ? 'Choose a category.' : undefined;
  const amountError =
    touched && amount.trim() === ''
      ? 'An amount is required.'
      : touched && !isDecimalInput(amount)
        ? 'Enter an amount like 250000 or 250000.50.'
        : touched && isZeroMoney(amount)
          ? 'The amount must be greater than zero.'
          : undefined;

  const submit = async (): Promise<void> => {
    setTouched(true);
    if (category === '' || amountError !== undefined || amount.trim() === '') return;
    await run(async () => {
      await onSubmit({
        category,
        category_label: categoryLabel.trim(),
        amount: amount.trim(),
        date: dateValue,
        description: description.trim(),
        method,
        reference: reference.trim(),
      });
      onClose();
    });
  };

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      title={isEdit ? `Edit ${noun}` : `Add ${noun}`}
      subtitle={
        isEdit
          ? 'Corrections are audited. Void a record instead of editing it once money has moved.'
          : 'The server validates the category and the amount.'
      }
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
            {isEdit ? 'Save changes' : `Add ${noun}`}
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
          <Select
            label="Category"
            required
            placeholder="Choose a category"
            options={categories}
            value={category}
            onChange={setCategory}
            error={categoryError ?? errors.category}
          />
          <TextField
            label="Amount"
            required
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={setAmount}
            error={amountError ?? errors.amount}
          />
          <DateField
            label="Date"
            required
            value={dateValue}
            onChange={setDateValue}
            error={errors.date}
          />
          <Select
            label="Method"
            options={PAYMENT_METHODS}
            value={method}
            onChange={(value) => setMethod(value === '' ? 'cash' : value)}
            error={errors.method}
          />
          <TextField
            label="Custom category label"
            value={categoryLabel}
            onChange={setCategoryLabel}
            hint="Optional free text that overrides the category name in reports."
            error={errors.category_label}
          />
          <TextField
            label="Reference"
            value={reference}
            onChange={setReference}
            placeholder="Slip / document number"
            error={errors.reference}
          />
        </div>

        <TextField
          label="Description"
          value={description}
          onChange={setDescription}
          error={errors.description}
        />
      </div>
    </Modal>
  );
}

export default LedgerPage;
