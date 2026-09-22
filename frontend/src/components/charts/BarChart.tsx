import { useMemo } from 'react';
import {
  CHART_PADDING,
  CHART_VIEWBOX_WIDTH,
  type ChartPoint,
  type ChartSeries,
  formatCompact,
  labelIndices,
  niceScale,
  seriesColor,
} from './chartUtils';

export interface BarChartProps {
  /** Single unnamed series. Ignored when `series` is provided. */
  data?: ReadonlyArray<ChartPoint>;
  /** Multiple series render as grouped bars sharing the x axis. */
  series?: ReadonlyArray<ChartSeries>;
  /** Drawing height in viewBox units; the SVG scales to its container width. */
  height?: number;
  showGrid?: boolean;
  /** Y tick formatter, e.g. the settings-aware money formatter. */
  yFormat?: (value: number) => string;
  valueLabel?: string;
  /** Horizontal bars instead of vertical ones (good for long labels). */
  horizontal?: boolean;
  maxBarWidth?: number;
  emptyTitle?: string;
  emptyHint?: string;
  className?: string;
}

function normalise(
  data: ReadonlyArray<ChartPoint> | undefined,
  series: ReadonlyArray<ChartSeries> | undefined,
): ChartSeries[] {
  if (series !== undefined && series.length > 0) return [...series];
  if (data !== undefined && data.length > 0) return [{ name: '', points: data }];
  return [];
}

/**
 * Hand-rolled SVG bar chart with grouped series and an optional horizontal
 * layout for long category names. Responsive via viewBox, always anchored to a
 * zero baseline.
 */
export function BarChart({
  data,
  series,
  height = 260,
  showGrid = true,
  yFormat = formatCompact,
  valueLabel = 'Value',
  horizontal = false,
  maxBarWidth = 46,
  emptyTitle = 'No data to chart',
  emptyHint,
  className,
}: BarChartProps) {
  const normalised = useMemo(() => normalise(data, series), [data, series]);
  const points: ReadonlyArray<ChartPoint> = normalised[0]?.points ?? [];

  const geometry = useMemo(() => {
    const values = normalised.flatMap((entry) => entry.points.map((point) => point.value));
    const finite = values.filter((value) => Number.isFinite(value));
    const extentMin = finite.length > 0 ? Math.min(...finite) : 0;
    const extentMax = finite.length > 0 ? Math.max(...finite) : 0;
    // Bars must start at zero so their lengths stay proportional.
    const scale = niceScale(Math.min(0, extentMin), Math.max(0, extentMax));
    const left = CHART_PADDING.left;
    const top = CHART_PADDING.top;
    const innerWidth = CHART_VIEWBOX_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
    const innerHeight = height - CHART_PADDING.top - CHART_PADDING.bottom;
    const zeroPosition = (value: number): number => {
      const span = scale.max - scale.min || 1;
      return innerHeight - ((value - scale.min) / span) * innerHeight;
    };
    return { scale, left, top, innerWidth, innerHeight, zero: zeroPosition(0) };
  }, [normalised, height]);

  if (points.length === 0) {
    return (
      <div className={['chart', className ?? ''].filter(Boolean).join(' ')}>
        <p className="empty-state__title">{emptyTitle}</p>
        {emptyHint !== undefined ? <p className="empty-state__message">{emptyHint}</p> : null}
      </div>
    );
  }

  const { scale, left, top, innerWidth, innerHeight, zero } = geometry;
  const categoryCount = points.length;
  const groupWidth = innerWidth / categoryCount;
  const seriesCount = Math.max(1, normalised.length);
  const barWidth = Math.min(maxBarWidth, (groupWidth * 0.68) / seriesCount);
  const labelSteps = labelIndices(categoryCount, 10);

  return (
    <figure className={['chart', className ?? ''].filter(Boolean).join(' ')}>
      <svg
        className="chart__svg"
        viewBox={`0 0 ${CHART_VIEWBOX_WIDTH} ${height}`}
        role="img"
        aria-label={`${valueLabel} bar chart with ${categoryCount} categories`}
        preserveAspectRatio="xMidYMid meet"
      >
        {showGrid
          ? scale.ticks.map((tick) => (
              <line
                key={`grid-${tick}`}
                className="chart__grid-line"
                x1={left}
                x2={left + innerWidth}
                y1={top + innerHeight - ((tick - scale.min) / (scale.max - scale.min || 1)) * innerHeight}
                y2={top + innerHeight - ((tick - scale.min) / (scale.max - scale.min || 1)) * innerHeight}
              />
            ))
          : null}

        {scale.ticks.map((tick) => (
          <text
            key={`tick-${tick}`}
            className="chart__axis-label"
            x={left - 8}
            y={top + innerHeight - ((tick - scale.min) / (scale.max - scale.min || 1)) * innerHeight + 3.5}
            textAnchor="end"
          >
            {yFormat(tick)}
          </text>
        ))}

        <line
          className="chart__axis-line"
          x1={left}
          x2={left + innerWidth}
          y1={top + innerHeight}
          y2={top + innerHeight}
        />

        {points.map((point, categoryIndex) => {
          const groupStart = left + groupWidth * categoryIndex;
          return normalised.map((entry, seriesIndex) => {
            const value = entry.points[categoryIndex]?.value ?? 0;
            const color = seriesColor(seriesIndex, entry.color);
            const x =
              groupStart +
              (groupWidth - barWidth * seriesCount) / 2 +
              seriesIndex * barWidth +
              (seriesCount > 1 ? 1 : 0);
            const y = top + innerHeight - ((value - scale.min) / (scale.max - scale.min || 1)) * innerHeight;
            const rectHeight = Math.max(1, top + innerHeight - y);

            if (horizontal) {
              // Horizontal mode reuses the same scale on the x axis.
              const barLength = ((value - scale.min) / (scale.max - scale.min || 1)) * innerWidth;
              const rowHeight = innerHeight / categoryCount;
              const rowTop = top + rowHeight * categoryIndex + (rowHeight - barWidth * seriesCount) / 2;
              return (
                <rect
                  key={`${entry.name}-${point.label}-${seriesIndex}`}
                  className="chart__bar"
                  fill={color}
                  x={left}
                  y={rowTop + seriesIndex * barWidth}
                  width={Math.max(1, barLength)}
                  height={barWidth}
                >
                  <title>{`${point.label} — ${entry.name !== '' ? `${entry.name}: ` : ''}${yFormat(value)}`}</title>
                </rect>
              );
            }

            return (
              <rect
                key={`${entry.name}-${point.label}-${seriesIndex}`}
                className="chart__bar"
                fill={color}
                x={x}
                y={Math.min(y, zero)}
                width={barWidth}
                height={rectHeight}
              >
                <title>{`${point.label} — ${entry.name !== '' ? `${entry.name}: ` : ''}${yFormat(value)}`}</title>
              </rect>
            );
          });
        })}

        {!horizontal
          ? labelSteps.map((index) => (
              <text
                key={`xlabel-${index}`}
                className="chart__axis-label"
                x={left + groupWidth * index + groupWidth / 2}
                y={top + innerHeight + 16}
                textAnchor="middle"
              >
                {points[index]?.label ?? ''}
              </text>
            ))
          : null}
      </svg>

      {normalised.length > 1 || horizontal ? (
        <figcaption className="chart__legend">
          {horizontal
            ? points.map((point, index) => (
                <span className="chart__legend-item" key={`row-${point.label}-${index}`}>
                  <span className="u-muted u-truncate">{point.label}</span>
                </span>
              ))
            : normalised.map((entry, index) => (
                <span className="chart__legend-item" key={`legend-${entry.name}-${index}`}>
                  <span
                    className="chart__legend-swatch"
                    style={{ background: seriesColor(index, entry.color) }}
                  />
                  {entry.name}
                </span>
              ))}
        </figcaption>
      ) : null}
    </figure>
  );
}

export default BarChart;
