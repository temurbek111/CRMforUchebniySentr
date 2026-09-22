/**
 * Shared helpers for the hand-rolled SVG charts.
 *
 * The palette mirrors the --chart-* design tokens as literal hex values
 * because SVG presentation attributes cannot reliably resolve CSS variables in
 * every browser; keep the two lists in sync.
 */

export const CHART_COLORS: ReadonlyArray<string> = [
  '#2f5bff', // --chart-1
  '#0f9d8b', // --chart-2
  '#b26a00', // --chart-3
  '#7c4dbd', // --chart-4
  '#b3261e', // --chart-5
  '#4b5563', // --chart-6
];

export const CHART_GRID_COLOR = '#e9ebf0';
export const CHART_AXIS_COLOR = '#98a2b3';

/** Default drawing area in viewBox units; the SVG scales to its container. */
export const CHART_VIEWBOX_WIDTH = 720;
export const CHART_VIEWBOX_HEIGHT = 260;

export interface ChartPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const CHART_PADDING: ChartPadding = { top: 16, right: 16, bottom: 30, left: 56 };

export interface ChartPoint {
  /** Category label shown on the x axis. */
  label: string;
  value: number;
}

export interface ChartSeries {
  name: string;
  points: ReadonlyArray<ChartPoint>;
  /** Overrides the palette colour for this series. */
  color?: string;
}

export function seriesColor(index: number, override?: string): string {
  if (override !== undefined && override !== '') return override;
  return CHART_COLORS[index % CHART_COLORS.length] ?? CHART_COLORS[0] ?? '#2f5bff';
}

export interface NiceScale {
  min: number;
  max: number;
  step: number;
  ticks: number[];
}

/** Round an axis range up to human-friendly tick values. */
export function niceScale(inputMin: number, inputMax: number, tickCount = 5): NiceScale {
  let min = inputMin;
  let max = inputMax;

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 1, step: 0.5, ticks: [0, 0.5, 1] };
  }

  if (min === max) {
    if (min === 0) return { min: 0, max: 1, step: 0.5, ticks: [0, 0.5, 1] };
    const padding = Math.abs(min) * 0.2;
    min -= padding;
    max += padding;
  }

  const rawStep = (max - min) / Math.max(1, tickCount);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalised = rawStep / magnitude;
  const stepMultiple = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  const step = stepMultiple * magnitude;

  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;

  const ticks: number[] = [];
  for (let value = niceMin; value <= niceMax + step / 2; value += step) {
    ticks.push(Number(value.toFixed(10)));
  }
  return { min: niceMin, max: niceMax, step, ticks };
}

const compactFormatter = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** 1234 -> "1.2K"; used for axis ticks unless the caller formats itself. */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '–';
  return compactFormatter.format(value);
}

export function formatPercent(value: number, fractionDigits = 1): string {
  if (!Number.isFinite(value)) return '–';
  return `${value.toFixed(fractionDigits)}%`;
}

/** Sum a series, used by the donut chart's centre label. */
export function sumValues(points: ReadonlyArray<ChartPoint>): number {
  return points.reduce((total, point) => total + (Number.isFinite(point.value) ? point.value : 0), 0);
}

/**
 * Thin out x axis labels so they never overlap: return the indices that
 * should be drawn.
 */
export function labelIndices(count: number, maxLabels = 8): number[] {
  if (count <= 0) return [];
  const step = Math.max(1, Math.ceil(count / maxLabels));
  const indices: number[] = [];
  for (let index = 0; index < count; index += step) indices.push(index);
  const last = count - 1;
  if (indices[indices.length - 1] !== last) indices.push(last);
  return indices;
}

/**
 * Coordinates of a pie/donut arc, drawn as a path.
 * Angles are degrees, clockwise, starting at 12 o'clock.
 */
export function arcPath(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  const startOuter = polarToCartesian(cx, cy, outerRadius, endAngle);
  const endOuter = polarToCartesian(cx, cy, outerRadius, startAngle);
  const startInner = polarToCartesian(cx, cy, innerRadius, startAngle);
  const endInner = polarToCartesian(cx, cy, innerRadius, endAngle);
  const largeArc = endAngle - startAngle <= 180 ? '0' : '1';

  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 0 ${endOuter.x} ${endOuter.y}`,
    `L ${startInner.x} ${startInner.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 1 ${endInner.x} ${endInner.y}`,
    'Z',
  ].join(' ');
}

function polarToCartesian(
  cx: number,
  cy: number,
  radius: number,
  angleInDegrees: number,
): { x: number; y: number } {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angleInRadians),
    y: cy + radius * Math.sin(angleInRadians),
  };
}
