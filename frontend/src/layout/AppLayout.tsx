import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useSettings } from '../settings/SettingsContext';
import { useEscapeKey, useLocalStorageState } from '../utils/hooks';
import { useGlobalSearch } from '../utils/events';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

const COLLAPSE_STORAGE_KEY = 'lcrm.sidebar.collapsed';

/**
 * Application shell: server-driven sidebar, topbar and the routed page area.
 *
 * Below 900px the sidebar becomes an overlay drawer (see global.css), which is
 * what `drawerOpen` controls; above that width the sidebar is permanent and
 * only the collapsed/expanded state applies.
 */
export function AppLayout(): ReactNode {
  const { navigation } = useAuth();
  const { settings } = useSettings();
  const location = useLocation();
  const navigate = useNavigate();

  const [collapsed, setCollapsed] = useLocalStorageState<boolean>(COLLAPSE_STORAGE_KEY, false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // The topbar search box announces a query; the shell turns it into a real,
  // bookmarkable results route instead of letting the event go unanswered.
  useGlobalSearch(
    useCallback(
      (query: string) => {
        navigate(`/search?q=${encodeURIComponent(query)}`);
      },
      [navigate],
    ),
  );

  // Following a link always closes the mobile drawer.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEscapeKey(() => setDrawerOpen(false), drawerOpen);

  return (
    <div className={['app-shell', collapsed ? 'app-shell--collapsed' : ''].filter(Boolean).join(' ')}>
      {/* Keyboard users can jump past the 26-item navigation straight to the page. */}
      <a className="skipLink" href="#main-content">
        Skip to content
      </a>
      <Sidebar
        navigation={navigation}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed(!collapsed)}
        onRequestExpand={() => setCollapsed(false)}
        open={drawerOpen}
        onNavigate={() => setDrawerOpen(false)}
        centreName={settings.centre_name}
      />

      {drawerOpen ? (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setDrawerOpen(false)}
        />
      ) : null}

      <div className="app-main">
        <Topbar onOpenSidebar={() => setDrawerOpen(true)} />
        <main className="app-content" id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default AppLayout;
