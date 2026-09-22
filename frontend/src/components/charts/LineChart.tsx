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

export interface LineChartProps {
  /** Single unnamed series. Ignored when `series` is provided. */
  data?: ReadonlyArray<ChartPoint>;
  /** One or more lines; all series share the same x axis (index aligned). */
  series?: ReadonlyArray<ChartSeries>;
  /** Drawing height in viewBox units; the SVG scales to its container width. */
  height?: number;
  showGrid?: boolean;
  showPoints?: boolean;
  /** Flat translucent area under each line (never a gradient). */
  fill?: boolean;
  /** Y tick formatter, e.g. the settings-aware money formatter. */
  yFormat?: (value: number) => string;
  /** Describes the drawn values for screen readers. */
  valueLabel?: string;
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
 * Hand-rolled SVG line chart. No hardcoded series: every value, label and
 * colour comes from props, and the whole chart is drawn inside a viewBox so it
 * scales with its container.
 */
export function LineChart({
  data,
  series,
  height = 260,
  showGrid = true,
  showPoints = true,
  fill = false,
  yFormat = formatCompact,
  valueLabel = 'Value',
  emptyTitle = 'No data to chart',
  emptyHint,
  className,
}: LineChartProps) {
  const normalised = useMemo(() => normalise(data, series), [data, series]);
  const points: ReadonlyArray<ChartPoint> = normalised[0]?.points ?? [];

  const geometry = useMemo(() => {
    const values = normalised.flatMap((entry) => entry.points.map((point) => point.value));
    const finite = values.filter((value) => Number.isFinite(value));
    const min = finite.length > 0 ? Math.min(...finite) : 0;
    const max = finite.length > 0 ? Math.max(...finite) : 0;
    const scale = niceScale(min, max);
    const left = CHART_PADDING.left;
    const top = CHART_PADDING.top;
    const innerWidth = CHART_VIEWBOX_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
    const innerHeight = height - CHART_PADDING.top - CHART_PADDING.bottom;
    const count = points.length;

    const x = (index: number): number => {
      if (count <= 1) return left + innerWidth / 2;
      return left + (innerWidth * index) / (count - 1);
    };
    const y = (value: number): number => {
      const span = scale.max - scale.min || 1;
      return top + innerHeight - ((value - scale.min) / span) * innerHeight;
    };

    return { scale, left, top, innerWidth, innerHeight, x, y, count };
  }, [normalised, points.length, height]);

  if (points.length === 0) {
    return (
      <div className={['chart', className ?? ''].filter(Boolean).join(' ')}>
        <p className="empty-state__title">{emptyTitle}</p>
        {emptyHint !== undefined ? <p className="empty-state__message">{emptyHint}</p> : null}
      </div>
    );
  }

  const { scale, left, top, innerWidth, innerHeight, x, y } = geometry;
  const labelSteps = labelIndices(points.length, 8);

  return (
    <figure className={['chart', className ?? ''].filter(Boolean).join(' ')}>
      <svg
        className="chart__svg"
        viewBox={`0 0 ${CHART_VIEWBOX_WIDTH} ${height}`}
        role="img"
        aria-label={`${valueLabel} line chart with ${points.length} points`}
        preserveAspectRatio="xMidYMid meet"
      >
        {showGrid
          ? scale.ticks.map((tick) => (
              <line
                key={`grid-${tick}`}
                className="chart__grid-line"
                x1={left}
                x2={left + innerWidth}
                y1={y(tick)}
                y2={y(tick)}
              />
            ))
          : null}

        {scale.ticks.map((tick) => (
          <text
            key={`tick-${tick}`}
            className="chart__axis-label"
            x={left - 8}
            y={y(tick) + 3.5}
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

        {labelSteps.map((index) => (
          <text
            key={`xlabel-${index}`}
            className="chart__axis-label"
            x={x(index)}
            y={top + innerHeight + 16}
            textAnchor={
              index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'
            }
          >
            {points[index]?.label ?? ''}
          </text>
        ))}

        {normalised.map((entry, seriesIndex) => {
          const color = seriesColor(seriesIndex, entry.color);
          const path = entry.points
            .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point.value)}`)
            .join(' ');
          const areaPath =
            entry.points.length > 1
              ? `${path} L ${x(entry.points.length - 1)} ${top + innerHeight} L ${x(0)} ${
                  top + innerHeight
                } Z`
              : '';
          return (
            <g key={`${entry.name}-${seriesIndex}`}>
              {fill ? <path d={areaPath} fill={color} fillOpacity={0.12} stroke="none" /> : null}
              <path className="chart__series" d={path} stroke={color} />
              {showPoints
                ? entry.points.map((point, index) => (
                    <circle
                      key={`${entry.name}-${point.label}-${index}`}
                      className="chart__point"
                      cx={x(index)}
                      cy={y(point.value)}
                      r={3}
                      stroke={color}
                    >
                      <title>{`${point.label} — ${valueLabel}: ${yFormat(point.value)}`}</title>
                    </circle>
                  ))
                : null}
            </g>
          );
        })}

      </svg>

      {normalised.length > 1 ? (
        <figcaption className="chart__legend">
          {normalised.map((entry, index) => (
            <span className="chart__legend-item" key={`legend-${entry.name}-${index}`}>
              <span
                className="chart__legend-swatch chart__legend-swatch--line"
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

export default LineChart;
