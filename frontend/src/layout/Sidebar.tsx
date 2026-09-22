import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { expandedKeysForPath } from '../navigation/routeManifest';
import type { NavigationItem } from '../types';

export interface SidebarProps {
  /** Navigation tree exactly as returned by GET /api/auth/me. */
  navigation: ReadonlyArray<NavigationItem>;
  /** Desktop collapsed (icon-only) state. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Expands the sidebar, e.g. when a group is tapped while collapsed. */
  onRequestExpand: () => void;
  /** Mobile overlay drawer state (ignored above 900px). */
  open: boolean;
  /** Called after following a link, so the drawer can close. */
  onNavigate: () => void;
  /** Centre name from /api/settings. */
  centreName: string;
}

/**
 * The navigation is never hardcoded here: it is rendered from the
 * server-provided, role-filtered tree (apps/accounts/rbac.py -> /api/auth/me).
 */
export function Sidebar({
  navigation,
  collapsed,
  onToggleCollapsed,
  onRequestExpand,
  open,
  onNavigate,
  centreName,
}: SidebarProps) {
  const location = useLocation();
  const [expanded, setExpanded] = useState<string[]>(() =>
    expandedKeysForPath(navigation, location.pathname),
  );

  // Follow the route: expand the group that owns the active page.
  useEffect(() => {
    const needed = expandedKeysForPath(navigation, location.pathname);
    if (needed.length === 0) return;
    setExpanded((current) => [...new Set([...current, ...needed])]);
  }, [navigation, location.pathname]);

  const toggleGroup = (key: string): void => {
    setExpanded((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    );
  };

  const renderLink = (item: NavigationItem, isChild: boolean) => {
    if (item.path === undefined || item.path === '') return null;
    return (
      <NavLink
        key={item.key}
        to={item.path}
        end={item.path === '/'}
        className={({ isActive }) =>
          ['nav-link', isChild ? 'nav-link--child' : '', isActive ? 'is-active' : '']
            .filter(Boolean)
            .join(' ')
        }
        onClick={onNavigate}
        title={collapsed ? item.label : undefined}
      >
        <span className="nav-link__icon" aria-hidden="true">
          <Icon name={item.icon ?? 'dot'} size={16} />
        </span>
        <span className="nav-link__label">{item.label}</span>
      </NavLink>
    );
  };

  const renderGroup = (item: NavigationItem) => {
    const isOpen = !collapsed && expanded.includes(item.key);
    const childIsActive =
      item.children?.some(
        (child) => child.path !== undefined && location.pathname.startsWith(child.path),
      ) ?? false;

    return (
      <div className="nav-group" key={item.key}>
        <button
          type="button"
          className={['nav-link', 'nav-group__button', collapsed && childIsActive ? 'is-active' : '']
            .filter(Boolean)
            .join(' ')}
          aria-expanded={isOpen}
          aria-controls={`nav-group-${item.key}`}
          onClick={() => {
            if (collapsed) {
              onRequestExpand();
              setExpanded((current) => [...new Set([...current, item.key])]);
              return;
            }
            toggleGroup(item.key);
          }}
          title={collapsed ? item.label : undefined}
        >
          <span className="nav-link__icon" aria-hidden="true">
            <Icon name={item.icon ?? 'dot'} size={16} />
          </span>
          <span className="nav-link__label">{item.label}</span>
          <span
            className={['nav-group__chevron', isOpen ? 'is-open' : ''].filter(Boolean).join(' ')}
            aria-hidden="true"
          >
            <Icon name="chevronRight" size={14} />
          </span>
        </button>

        {isOpen ? (
          <div className="nav-group__children" id={`nav-group-${item.key}`}>
            {item.children?.map((child) => renderLink(child, true))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <aside
      className={['sidebar', collapsed ? 'sidebar--collapsed' : '', open ? 'is-open' : '']
        .filter(Boolean)
        .join(' ')}
      aria-label="Main navigation"
    >
      <div className="sidebar__brand">
        <NavLink to="/" className="sidebar__brand-link" onClick={onNavigate}>
          <span className="sidebar__logo" aria-hidden="true">
            LC
          </span>
          <span className="sidebar__brand-text">
            <span className="sidebar__brand-name">{centreName === '' ? 'Learning Centre' : centreName}</span>
            <span className="sidebar__brand-sub">CRM</span>
          </span>
        </NavLink>
      </div>

      <nav className="sidebar__nav">
        {navigation.map((item) =>
          item.children !== undefined && item.children.length > 0
            ? renderGroup(item)
            : renderLink(item, false),
        )}
      </nav>

      <div className="sidebar__footer">
        <button
          type="button"
          className="sidebar__toggle"
          onClick={onToggleCollapsed}
          aria-pressed={collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <Icon name={collapsed ? 'chevronsRight' : 'chevronsLeft'} size={14} />
          <span className="sidebar__toggle-label">Collapse</span>
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
