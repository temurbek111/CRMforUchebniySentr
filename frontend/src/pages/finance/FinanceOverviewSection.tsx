import type { ReactNode } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { BarChart, LineChart, type ChartPoint, type ChartSeries } from '../../components/charts';
import { Card } from '../../components/Card';
import { ErrorState } from '../../components/ErrorState';
import { Icon } from '../../components/Icon';
import { LoadingState } from '../../components/LoadingState';
import { StatCard, type StatDelta } from '../../components/StatCard';
import { useSettings } from '../../settings/SettingsContext';
import { PERMISSIONS } from '../../types';
import { financeApi } from './api';
import { formatMoneyValue, formatPercentValue, toChartNumber, useQueryData } from './shared';

export interface FinanceOverviewSectionProps {
  /** Inclusive ISO date range for the summary figures. */
  from: string;
  to: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Renders the monthly income/expense charts from /finance/summary/series/. */
  showChart?: boolean;
  /** Year for the series endpoint; defaults to the `to` year. */
  year?: number;
  className?: string;
}

/**
 * Reusable money summary used at the top of the finance pages.
 *
 * Every figure comes from GET /api/finance/summary (and the monthly series),
 * so gross income, the payroll/other-expense split, the net result, the
 * outstanding balance and the collection rate always match the server.
 */
export function FinanceOverviewSection({
  from,
  to,
  title = 'Financial summary',
  subtitle,
  showChart = true,
  year,
  className,
}: FinanceOverviewSectionProps) {
  const { hasPerm } = useAuth();
  const { currency, date } = useSettings();
  const allowed = hasPerm(PERMISSIONS.FINANCE_VIEW);

  const parsedYear = Number(to.slice(0, 4));
  const seriesYear = year ?? (Number.isFinite(parsedYear) && parsedYear > 0 ? parsedYear : new Date().getFullYear());

  const summary = useQueryData(
    (signal) => financeApi.summary.get({ from, to }, signal),
    [from, to],
    allowed,
  );
  const series = useQueryData(
    (signal) => financeApi.summary.series({ year: seriesYear }, signal),
    [seriesYear],
    allowed && showChart,
  );

  const money = (value: string | number | null | undefined): string => formatMoneyValue(value, currency);
  const yFormat = (value: number): string => formatMoneyValue(value, currency);

  if (!allowed) {
    return (
      <Card title={title} subtitle={subtitle} className={className}>
        <div className="alert alert--info" role="status">
          <span className="alert__icon" aria-hidden="true">
            <Icon name="info" size={16} />
          </span>
          <div className="alert__content">
            <span className="alert__title">Financial totals are hidden</span>
            <p className="u-muted">
              Your role does not include the <code>finance.view</code> permission, so the centre-wide
              figures cannot be loaded.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const data = summary.data;
  const netDelta: StatDelta = {
    value: 'result for the selected range',
    direction:
      data === null ? 'flat' : data.net_result.trim().startsWith('-') ? 'down' : 'up',
  };

  const chartPoints = series.data?.series ?? [];
  const incomeSeries: ChartSeries = {
    name: 'Income',
    points: chartPoints.map<ChartPoint>((point) => ({
      label: point.label,
      value: toChartNumber(point.income),
    })),
  };
  const expenseSeries: ChartSeries = {
    name: 'Expenses',
    points: chartPoints.map<ChartPoint>((point) => ({
      label: point.label,
      value: toChartNumber(point.expenses),
    })),
  };
  const netPoints: ChartPoint[] = chartPoints.map((point) => ({
    label: point.label,
    value: toChartNumber(point.net),
  }));

  return (
    <Card
      title={title}
      subtitle={subtitle ?? `${date(from)} – ${date(to)}`}
      className={className}
    >
      {summary.loading && data === null ? <LoadingState label="Loading financial summary…" /> : null}

      {summary.error !== null ? (
        <ErrorState error={summary.error} onRetry={summary.reload} />
      ) : null}

      {data !== null ? (
        <>
          <div className="kpi-grid">
            <StatCard
              label="Gross income"
              icon="chartBar"
              value={money(data.gross_income)}
              hint="Student fees + other income collected in the range"
            />
            <StatCard
              label="Student fees collected"
              icon="wallet"
              value={money(data.student_fees)}
              hint="Payments received in the range"
            />
            <StatCard
              label="Other income"
              icon="chartPie"
              value={money(data.other_income)}
              hint="Registration, exam fees and other entries"
            />
            <StatCard
              label="Payroll"
              icon="teachers"
              value={money(data.payroll)}
              hint="Paid teacher salaries booked as expenses"
            />
            <StatCard
              label="Other expenses"
              icon="finance"
              value={money(data.other_expenses)}
              hint="Everything except teacher salaries"
            />
            <StatCard
              label="Total expenses"
              icon="download"
              value={money(data.total_expenses)}
              hint="Payroll + other expenses"
            />
            <StatCard label="Net result" icon="checkCircle" value={money(data.net_result)} delta={netDelta} />
            <StatCard
              label="Outstanding"
              icon="alert"
              value={money(data.outstanding)}
              hint={
                data.overdue_count === 1
                  ? '1 invoice overdue'
                  : `${data.overdue_count} invoices overdue`
              }
            />
            <StatCard
              label="Collection rate"
              icon="chartLine"
              value={formatPercentValue(data.collection_rate)}
              hint="Collected ÷ (collected + outstanding)"
            />
          </div>

          {showChart ? (
            <div className="u-stack" style={{ marginTop: 'var(--space-6)' }}>
              <div>
                <h3 className="card__title">
                  Monthly income vs expenses — {seriesYear}
                </h3>
                <p className="card__subtitle">
                  Twelve months of real figures from <code>/api/finance/summary/series/</code>
                </p>
              </div>

              {series.loading && series.data === null ? (
                <LoadingState label="Loading the monthly series…" inline />
              ) : null}
              {series.error !== null ? (
                <ErrorState error={series.error} onRetry={series.reload} />
              ) : null}

              {series.data !== null ? (
                <>
                  <BarChart
                    series={[incomeSeries, expenseSeries]}
                    yFormat={yFormat}
                    valueLabel="Amount"
                  />
                  <LineChart
                    data={netPoints}
                    yFormat={yFormat}
                    fill
                    showPoints
                    valueLabel="Net result"
                  />
                </>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

export default FinanceOverviewSection;
