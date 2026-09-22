import { useMemo } from 'react';
import { CHART_COLORS, type ChartPoint, arcPath, formatCompact, formatPercent, sumValues } from './chartUtils';

export interface DonutChartProps {
  /** Slice values; negative values are clamped to zero. */
  data: ReadonlyArray<ChartPoint>;
  /** Overall size of the drawing square in viewBox units. */
  size?: number;
  /** Ring thickness in viewBox units. */
  thickness?: number;
  /** Small caption under the centre value. */
  centerLabel?: string;
  /** Overrides the centre value (already formatted by the caller). */
  centerValue?: string;
  showLegend?: boolean;
  /** Formats slice values in the legend (money, counts, ...). */
  formatValue?: (value: number) => string;
  /** Overrides the palette per slice. */
  colors?: ReadonlyArray<string>;
  emptyTitle?: string;
  emptyHint?: string;
  className?: string;
}

interface Segment {
  label: string;
  value: number;
  color: string;
  path: string;
  share: number;
}

/**
 * Hand-rolled SVG donut chart with a legend. All slices, colours and labels
 * come from props; percentages are computed from the supplied values.
 */
export function DonutChart({
  data,
  size = 200,
  thickness = 26,
  centerLabel = 'Total',
  centerValue,
  showLegend = true,
  formatValue = formatCompact,
  colors,
  emptyTitle = 'No data to chart',
  emptyHint,
  className,
}: DonutChartProps) {
  const total = useMemo(() => sumValues(data), [data]);

  const segments = useMemo<Segment[]>(() => {
    const positive = data.map((point) => ({
      label: point.label,
      value: Number.isFinite(point.value) ? Math.max(0, point.value) : 0,
    }));
    const sum = positive.reduce((accumulator, point) => accumulator + point.value, 0);
    if (sum <= 0) return [];

    const center = size / 2;
    const outerRadius = size / 2 - 2;
    const innerRadius = Math.max(4, outerRadius - thickness);
    // A hairline gap between slices keeps adjacent segments legible.
    const gap = positive.length > 1 ? 0.8 : 0;

    let cursor = 0;
    return positive.map((point, index) => {
      const sweep = (point.value / sum) * 360;
      const startAngle = cursor + gap / 2;
      const endAngle = cursor + sweep - gap / 2;
      cursor += sweep;
      const palette = colors ?? CHART_COLORS;
      return {
        label: point.label,
        value: point.value,
        color: palette[index % palette.length] ?? CHART_COLORS[0] ?? '#2f5bff',
        share: point.value / sum,
        path: arcPath(center, center, outerRadius, innerRadius, startAngle, Math.max(startAngle + 0.1, endAngle)),
      };
    });
  }, [data, size, thickness, colors]);

  if (segments.length === 0) {
    return (
      <div className={['chart', className ?? ''].filter(Boolean).join(' ')}>
        <p className="empty-state__title">{emptyTitle}</p>
        {emptyHint !== undefined ? <p className="empty-state__message">{emptyHint}</p> : null}
      </div>
    );
  }

  return (
    <figure className={['chart donut', className ?? ''].filter(Boolean).join(' ')}>
      <div className="donut__figure" style={{ width: size, maxWidth: '100%' }}>
        <svg
          className="chart__svg"
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`${centerLabel} donut chart with ${segments.length} categories`}
          preserveAspectRatio="xMidYMid meet"
        >
          {segments.map((segment) => (
            <path key={segment.label} d={segment.path} fill={segment.color} stroke="none">
              <title>{`${segment.label}: ${formatValue(segment.value)} (${formatPercent(
                segment.share * 100,
              )})`}</title>
            </path>
          ))}
        </svg>
        <div className="donut__center">
          <span className="donut__center-value">{centerValue ?? formatValue(total)}</span>
          <span className="donut__center-label">{centerLabel}</span>
        </div>
      </div>

      {showLegend ? (
        <figcaption className="donut__legend">
          {segments.map((segment) => (
            <span className="donut__legend-row" key={`legend-${segment.label}`}>
              <span className="chart__legend-swatch" style={{ background: segment.color }} />
              <span className="donut__legend-label" title={segment.label}>
                {segment.label}
              </span>
              <span className="donut__legend-value">
                {formatValue(segment.value)} · {formatPercent(segment.share * 100, 0)}
              </span>
            </span>
          ))}
        </figcaption>
      ) : null}
    </figure>
  );
}

export default DonutChart;
