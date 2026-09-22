/**
 * Student profile - Payments tab.
 *
 * GET /api/students/{id}/payments/ returns the balance, the invoice history and
 * the (append-only) payment history. Voided payments stay visible with a
 * marker - nothing is ever hidden or deleted from the ledger.
 */

import { useMemo } from 'react';
import { Badge, Card, StatCard, StatusBadge, Table, type TableColumn } from '../../components';
import { useSettings } from '../../settings/SettingsContext';
import { studentsApi, toNumber, type InvoiceSummary, type PaymentRow } from './api';
import { useAsyncResource } from './hooks';
import { AsyncSection } from './ui';

export interface StudentPaymentsTabProps {
  studentId: number;
}

export function StudentPaymentsTab({ studentId }: StudentPaymentsTabProps) {
  const settings = useSettings();
  const resource = useAsyncResource(
    () => studentsApi.payments(studentId),
    `payments:${studentId}`,
  );
  const data = resource.data;

  const invoiceColumns = useMemo<ReadonlyArray<TableColumn<InvoiceSummary>>>(
    () => [
      {
        key: 'period',
        header: 'Period',
        render: (row) => <span className="u-nowrap">{row.period}</span>,
      },
      {
        key: 'due_date',
        header: 'Due',
        width: '120px',
        render: (row) => <span className="u-nowrap">{settings.date(row.due_date)}</span>,
      },
      {
        key: 'amount_due',
        header: 'Due amount',
        align: 'right',
        render: (row) => settings.money(toNumber(row.amount_due)),
      },
      {
        key: 'amount_paid',
        header: 'Paid',
        align: 'right',
        render: (row) => settings.money(toNumber(row.amount_paid)),
      },
      {
        key: 'remaining',
        header: 'Remaining',
        align: 'right',
        render: (row) => settings.money(toNumber(row.remaining)),
      },
      {
        key: 'status',
        header: 'Status',
        width: '120px',
        render: (row) => <StatusBadge status={row.status} />,
      },
    ],
    [settings],
  );

  const paymentColumns = useMemo<ReadonlyArray<TableColumn<PaymentRow>>>(
    () => [
      {
        key: 'receipt',
        header: 'Receipt',
        width: '130px',
        render: (row) => <span className="u-mono u-nowrap">{row.receipt}</span>,
      },
      {
        key: 'amount',
        header: 'Amount',
        align: 'right',
        render: (row) => (
          <span className={row.is_void ? 'void-marker u-nowrap' : 'u-nowrap'}>
            {settings.money(toNumber(row.amount))}
          </span>
        ),
      },
      {
        key: 'paid_at',
        header: 'Date',
        width: '120px',
        render: (row) => <span className="u-nowrap">{settings.date(row.paid_at)}</span>,
      },
      {
        key: 'method',
        header: 'Method',
        render: (row) => row.method_label || row.method || '—',
      },
      {
        key: 'period',
        header: 'For period',
        render: (row) => row.period || <span className="u-subtle">Unallocated</span>,
      },
      {
        key: 'received_by',
        header: 'Received by',
        render: (row) => row.received_by || <span className="u-subtle">—</span>,
      },
      {
        key: 'void',
        header: 'Status',
        width: '140px',
        render: (row) =>
          row.is_void ? (
            <Badge tone="danger" dot title={row.void_reason}>
              Void{row.void_reason ? ` — ${row.void_reason}` : ''}
            </Badge>
          ) : (
            <Badge tone="success" dot>
              Recorded
            </Badge>
          ),
      },
    ],
    [settings],
  );

  return (
    <AsyncSection
      loading={resource.loading}
      error={resource.error}
      onRetry={resource.reload}
      isEmpty={data !== null && data.invoices.length === 0 && data.payments.length === 0}
      emptyIcon="wallet"
      emptyTitle="No billing history"
      emptyMessage="Invoices and payments recorded for this student will appear here."
      loadingRows={5}
    >
      {data === null ? null : (
        <div className="section-stack">
          <div className="kpi-grid">
            <StatCard
              label="Total billed"
              icon="finance"
              value={settings.money(toNumber(data.balance.total_due))}
              hint={`${settings.number(data.balance.invoice_count)} invoices`}
            />
            <StatCard
              label="Total paid"
              icon="wallet"
              value={settings.money(toNumber(data.balance.total_paid))}
            />
            <StatCard
              label="Outstanding"
              icon="alert"
              value={settings.money(toNumber(data.balance.outstanding))}
              footer={<StatusBadge status={data.balance.status} />}
            />
            <StatCard
              label="Credit"
              icon="arrowUp"
              value={settings.money(toNumber(data.balance.credit))}
            />
            <StatCard
              label="Open invoices"
              icon="clipboard"
              value={settings.number(data.balance.open_invoices)}
              hint={
                data.balance.days_overdue > 0
                  ? `${settings.number(data.balance.days_overdue)} days overdue`
                  : 'Nothing overdue'
              }
            />
          </div>

          <Card title="Invoices" subtitle={`${settings.number(data.invoices.length)} billing periods`} flush>
            <Table<InvoiceSummary>
              columns={invoiceColumns}
              rows={data.invoices}
              rowKey={(row) => row.id}
              paginated
              initialPageSize={25}
              dense
              emptyIcon="clipboard"
              emptyTitle="No invoices"
              emptyMessage="No invoice has been raised for this student yet."
            />
          </Card>

          <Card title="Payments" subtitle={`${settings.number(data.payments.length)} recorded payments`} flush>
            <Table<PaymentRow>
              columns={paymentColumns}
              rows={data.payments}
              rowKey={(row) => row.id}
              paginated
              initialPageSize={25}
              dense
              emptyIcon="wallet"
              emptyTitle="No payments"
              emptyMessage="Payments received from this student will appear here."
            />
          </Card>
        </div>
      )}
    </AsyncSection>
  );
}

export default StudentPaymentsTab;
