import type { ReactElement } from 'react';

/**
 * Hand-rolled inline SVG icon set.
 *
 * Names come from the backend navigation (`icon` keys in
 * apps/accounts/rbac.py: dashboard, crm, students, academic, schedule,
 * finance, teachers, reports, settings, audit) plus the UI icons the shell
 * needs. Unknown names fall back to a neutral dot so a new backend icon can
 * never break rendering.
 */

type IconShape = {
  /** SVG path `d` attributes, drawn with the current stroke colour. */
  paths?: string[];
  /** Optional circles as [cx, cy, r]. */
  circles?: Array<[number, number, number]>;
};

const ICONS: Record<string, IconShape> = {
  dashboard: {
    paths: ['M3.5 3.5h6.5v6.5H3.5z', 'M14 3.5h6.5v4H14z', 'M14 11h6.5v9.5H14z', 'M3.5 13.5h6.5v6.5H3.5z'],
  },
  crm: {
    paths: ['M3.5 4.5h17l-6.5 7.6v5.4l-4 2.2v-7.6z'],
  },
  students: {
    paths: [
      'M15.5 20v-1.4a3.4 3.4 0 0 0-3.4-3.4H6.9a3.4 3.4 0 0 0-3.4 3.4V20',
      'M14.9 4.7a3.4 3.4 0 0 1 0 6.6',
      'M20.5 20v-1.4a3.4 3.4 0 0 0-2.6-3.3',
    ],
    circles: [[9.5, 8, 3.4]],
  },
  academic: {
    paths: ['M4 6a2.5 2.5 0 0 1 2.5-2.5H19.5V18H6.5A2.5 2.5 0 0 0 4 20.5z', 'M19.5 18v3.5H6.5A2.5 2.5 0 0 1 4 19'],
  },
  schedule: {
    paths: ['M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v10A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5z', 'M4 9.5h16', 'M8.5 3.5v3', 'M15.5 3.5v3'],
  },
  finance: {
    paths: ['M3.5 9A2.5 2.5 0 0 1 6 6.5h12a2.5 2.5 0 0 1 2.5 2.5v8A2.5 2.5 0 0 1 18 19.5H6A2.5 2.5 0 0 1 3.5 17z', 'M3.5 10h17'],
    circles: [[16.5, 14.5, 1.2]],
  },
  teachers: {
    paths: ['M3.5 9.5 12 5.5l8.5 4-8.5 4z', 'M7 11.6V16c0 1.9 2.2 3.4 5 3.4s5-1.5 5-3.4v-4.4'],
  },
  reports: {
    paths: ['M6 20V11', 'M12 20V4.5', 'M18 20v-6.5', 'M3.5 20h17'],
  },
  settings: {
    paths: ['M4 7.5h9', 'M17 7.5h3', 'M4 16.5h4', 'M12 16.5h8'],
    circles: [[15, 7.5, 2], [10, 16.5, 2]],
  },
  audit: {
    paths: ['M8.5 3.5h7v3h-7z', 'M15.5 5h2A2.5 2.5 0 0 1 20 7.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5v-11A2.5 2.5 0 0 1 6.5 5h2', 'M8 11.5h8', 'M8 15.5h5'],
  },
  home: {
    paths: ['M4 10.5 12 4l8 6.5', 'M6 9.5V20h12V9.5', 'M10 20v-5h4v5'],
  },
  search: {
    paths: ['M16 16.5 20.5 21'],
    circles: [[11, 11, 6.5]],
  },
  bell: {
    paths: ['M18.5 8.5a6.5 6.5 0 1 0-13 0c0 5-2 6.5-2 6.5h17s-2-1.5-2-6.5', 'M10.2 19.5a2.2 2.2 0 0 0 3.6 0'],
  },
  menu: {
    paths: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  },
  close: {
    paths: ['M6 6l12 12', 'M18 6 6 18'],
  },
  chevronRight: { paths: ['M9.5 6l6 6-6 6'] },
  chevronLeft: { paths: ['M14.5 6l-6 6 6 6'] },
  chevronDown: { paths: ['M6 9.5l6 6 6-6'] },
  chevronUp: { paths: ['M6 14.5l6-6 6 6'] },
  chevronsLeft: { paths: ['M12 6l-6 6 6 6', 'M18 6l-6 6 6 6'] },
  chevronsRight: { paths: ['M12 6l6 6-6 6', 'M6 6l6 6-6 6'] },
  user: {
    paths: ['M19 20v-1.5a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4V20'],
    circles: [[12, 8, 3.6]],
  },
  users: {
    paths: ['M15.5 20v-1.4a3.4 3.4 0 0 0-3.4-3.4H6.9a3.4 3.4 0 0 0-3.4 3.4V20', 'M20.5 20v-1.4a3.4 3.4 0 0 0-2.6-3.3'],
    circles: [[9.5, 8, 3.4]],
  },
  logout: {
    paths: ['M15 17l5-5-5-5', 'M20 12H9.5', 'M12 20H6.5A2.5 2.5 0 0 1 4 17.5v-11A2.5 2.5 0 0 1 6.5 4H12'],
  },
  plus: {
    paths: ['M12 5v14', 'M5 12h14'],
  },
  edit: {
    paths: ['M12 20h8', 'M16.5 3.9a2 2 0 0 1 2.8 2.8L8.6 17.4 4.5 19.5l2.1-4.1z'],
  },
  trash: {
    paths: ['M4.5 7h15', 'M9.5 7V4.8h5V7', 'M6.5 7l.9 12.2A1.9 1.9 0 0 0 9.3 21h5.4a1.9 1.9 0 0 0 1.9-1.8L17.5 7', 'M10.5 11v6', 'M13.5 11v6'],
  },
  check: {
    paths: ['M5 12.5 9.5 17 19 6.5'],
  },
  checkCircle: {
    paths: ['M8.5 12.2l2.6 2.6 4.6-5.2'],
    circles: [[12, 12, 8.5]],
  },
  alert: {
    paths: ['M12 4.5 21 20H3z', 'M12 10v4.5', 'M12 17.2v.1'],
  },
  alertCircle: {
    paths: ['M12 8v5', 'M12 16.4v.1'],
    circles: [[12, 12, 8.5]],
  },
  info: {
    paths: ['M12 11v5.5', 'M12 7.6v.1'],
    circles: [[12, 12, 8.5]],
  },
  inbox: {
    paths: ['M4 13.5 6.5 5h11L20 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z', 'M4 13.5h4l1 2.5h6l1-2.5h4'],
  },
  calendar: {
    paths: ['M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v10A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5z', 'M4 9.5h16', 'M8.5 3.5v3', 'M15.5 3.5v3'],
  },
  download: {
    paths: ['M12 4v10', 'M8 10.5l4 4 4-4', 'M4.5 19.5h15'],
  },
  upload: {
    paths: ['M12 15V5', 'M8 8.5l4-4 4 4', 'M4.5 19.5h15'],
  },
  refresh: {
    paths: ['M20 12a8 8 0 1 1-2.6-5.9', 'M20 4v4.5h-4.5'],
  },
  filter: {
    paths: ['M3.5 5.5h17l-6.6 7.6v5.2l-3.8 2.2v-7.4z'],
  },
  eye: {
    paths: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z'],
    circles: [[12, 12, 2.8]],
  },
  lock: {
    paths: ['M5.5 10.5h13v9h-13z', 'M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5'],
  },
  shield: {
    paths: ['M12 3.5 19 6v6c0 4.3-3 7.4-7 9-4-1.6-7-4.7-7-9V6z'],
  },
  arrowUp: { paths: ['M12 19V6', 'M6.5 11.5 12 6l5.5 5.5'] },
  arrowDown: { paths: ['M12 5v13', 'M6.5 12.5 12 18l5.5-5.5'] },
  arrowUpDown: { paths: ['M8 8.5 11 5.5l3 3', 'M16 15.5l-3 3-3-3'] },
  sort: { paths: ['M8 5.5v13', 'M4.5 15 8 18.5 11.5 15', 'M16 18.5v-13', 'M12.5 9 16 5.5 19.5 9'] },
  chartBar: { paths: ['M6 20V11', 'M12 20V4.5', 'M18 20v-6.5', 'M3.5 20h17'] },
  chartLine: { paths: ['M4 16.5 9 11l3.5 3.5L20 6.5', 'M4 20.5h16'] },
  chartPie: {
    paths: ['M12 3.5V12h8.5A8.5 8.5 0 0 0 12 3.5z', 'M11 4.6A8.5 8.5 0 1 0 19.4 13H11z'],
  },
  table: {
    paths: ['M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5z', 'M4 10h16', 'M4 14h16', 'M10 10v10'],
  },
  externalLink: {
    paths: ['M14 4.5h5.5V10', 'M19.5 4.5 12 12', 'M17 14.5v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h4'],
  },
  clipboard: {
    paths: ['M9 4.5h6v3H9z', 'M15 6h1.5A2.5 2.5 0 0 1 19 8.5v10a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 18.5v-10A2.5 2.5 0 0 1 7.5 6H9'],
  },
  wallet: {
    paths: ['M3.5 9A2.5 2.5 0 0 1 6 6.5h12A2.5 2.5 0 0 1 20.5 9v8A2.5 2.5 0 0 1 18 19.5H6A2.5 2.5 0 0 1 3.5 17z', 'M3.5 10.5h17'],
    circles: [[16.3, 14.8, 1.2]],
  },
  dot: { circles: [[12, 12, 3.5]] },
  more: { circles: [[6, 12, 1.3], [12, 12, 1.3], [18, 12, 1.3]] },
};

export type IconName = keyof typeof ICONS;

export const FALLBACK_ICON = 'dot';

export interface IconProps {
  /** Icon key, typically straight from the backend navigation. */
  name: string;
  /** Rendered square size in pixels (the SVG scales via viewBox). */
  size?: number;
  className?: string;
  /** Accessible label. Omit for decorative icons (the default). */
  title?: string;
  strokeWidth?: number;
}

export function Icon({
  name,
  size = 18,
  className,
  title,
  strokeWidth = 1.7,
}: IconProps): ReactElement {
  const shape: IconShape = ICONS[name] ?? ICONS[FALLBACK_ICON];
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title === undefined ? true : undefined}
      role={title === undefined ? undefined : 'img'}
      focusable="false"
    >
      {title !== undefined ? <title>{title}</title> : null}
      {(shape.paths ?? []).map((d) => (
        <path key={d} d={d} />
      ))}
      {(shape.circles ?? []).map(([cx, cy, r]) => (
        <circle key={`${cx}-${cy}-${r}`} cx={cx} cy={cy} r={r} />
      ))}
    </svg>
  );
}

/** True when the backend sent an icon key this build knows how to draw. */
export function hasIcon(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(ICONS, name);
}

export default Icon;
