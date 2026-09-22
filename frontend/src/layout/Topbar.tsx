import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { LoadingState } from '../components/LoadingState';
import { notifications as notificationsApi } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { useSettings } from '../settings/SettingsContext';
import { dispatchGlobalSearch } from '../utils/events';
import { formatRelativeTime, initials } from '../utils/format';
import { useEscapeKey, useOutsideClick } from '../utils/hooks';
import type { Notification } from '../types';
import { ProfileDialog } from './ProfileDialog';

export interface TopbarProps {
  /** Opens the sidebar drawer on small screens. */
  onOpenSidebar: () => void;
}

function severityClass(severity: string): string {
  if (severity === 'critical') return 'notification-dot notification-dot--critical';
  if (severity === 'warning') return 'notification-dot notification-dot--warning';
  return 'notification-dot notification-dot--info';
}

/**
 * Topbar: centre identity from /api/settings, a global search box that
 * announces queries to the current page, the notification bell fed by
 * /api/notifications, and the user menu with profile + logout.
 */
export function Topbar({ onOpenSidebar }: TopbarProps) {
  const { user, logout } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const location = useLocation();

  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);

  const [bellOpen, setBellOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Notification[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);

  const bellRef = useRef<HTMLDivElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  useOutsideClick(bellRef, () => setBellOpen(false), bellOpen);
  useOutsideClick(userMenuRef, () => setUserMenuOpen(false), userMenuOpen);
  useEscapeKey(() => {
    setBellOpen(false);
    setUserMenuOpen(false);
  });

  const refreshUnread = useCallback(async (): Promise<void> => {
    try {
      const result = await notificationsApi.unreadCount();
      setUnread(result.unread);
    } catch {
      // The bell is decoration around real data: a failure just leaves the
      // last known count in place rather than blocking the page.
    }
  }, []);

  // Refresh the badge whenever the route changes.
  useEffect(() => {
    void refreshUnread();
  }, [refreshUnread, location.pathname]);

  // "/" focuses the search box, the way most admin tools behave.
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement;
      const typing =
        active instanceof HTMLElement &&
        (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
      if (typing) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);

  const submitSearch = (event: FormEvent): void => {
    event.preventDefault();
    dispatchGlobalSearch(query);
  };

  const openBell = async (): Promise<void> => {
    const next = !bellOpen;
    setBellOpen(next);
    setUserMenuOpen(false);
    if (!next) return;
    setLoadingItems(true);
    setNotificationsError(null);
    try {
      const page = await notificationsApi.unread(8);
      setItems(page.results);
      setUnread(page.count);
    } catch {
      setItems([]);
      setNotificationsError('Notifications could not be loaded.');
    } finally {
      setLoadingItems(false);
    }
  };

  const markRead = async (notification: Notification): Promise<void> => {
    try {
      await notificationsApi.markRead(notification.id);
      setItems((current) => current.filter((entry) => entry.id !== notification.id));
      setUnread((current) => Math.max(0, current - 1));
      if (notification.link !== '') {
        setBellOpen(false);
        navigate(notification.link);
      }
    } catch {
      setNotificationsError('That notification could not be updated.');
    }
  };

  const markAllRead = async (): Promise<void> => {
    try {
      await notificationsApi.markAllRead();
      setItems([]);
      setUnread(0);
    } catch {
      setNotificationsError('Notifications could not be updated.');
    }
  };

  const signOut = async (): Promise<void> => {
    setUserMenuOpen(false);
    await logout();
    navigate('/login', { replace: true });
  };

  const displayName = user === null ? '' : user.full_name || user.username;

  return (
    <header className="topbar">
      <div className="topbar__left">
        <button
          type="button"
          className="icon-button topbar__menu"
          onClick={onOpenSidebar}
          aria-label="Open navigation"
        >
          <Icon name="menu" size={18} />
        </button>

        <div className="topbar__centre">
          <span className="topbar__centre-name">
            {settings.centre_name === '' ? 'Learning Centre' : settings.centre_name}
          </span>
          {user !== null ? <span className="topbar__centre-sub">{user.role_name}</span> : null}
        </div>
      </div>

      <div className="topbar__right">
        <form className="topbar__search" role="search" onSubmit={submitSearch}>
          <span className="topbar__search-icon" aria-hidden="true">
            <Icon name="search" size={15} />
          </span>
          <input
            ref={searchRef}
            className="input"
            type="search"
            value={query}
            placeholder="Search…"
            aria-label="Global search"
            onChange={(event) => setQuery(event.target.value)}
          />
          <span className="topbar__kbd" aria-hidden="true">
            /
          </span>
        </form>

        <div className="user-menu" ref={bellRef}>
          <button
            type="button"
            className="icon-button"
            onClick={() => {
              void openBell();
            }}
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            aria-expanded={bellOpen}
            aria-haspopup="true"
          >
            <Icon name="bell" size={18} />
            {unread > 0 ? (
              <span className="icon-button__badge">{unread > 99 ? '99+' : unread}</span>
            ) : null}
          </button>

          {bellOpen ? (
            <div className="dropdown dropdown--wide" role="dialog" aria-label="Notifications">
              <div className="dropdown__header">
                <span>Notifications</span>
                {items.length > 0 ? (
                  <Button size="sm" variant="ghost" onClick={() => void markAllRead()}>
                    Mark all read
                  </Button>
                ) : null}
              </div>

              <div className="dropdown__scroll">
                {loadingItems ? <LoadingState inline label="Loading notifications…" /> : null}

                {!loadingItems && notificationsError !== null ? (
                  <div className="alert alert--error" role="alert" style={{ margin: 12 }}>
                    <div className="alert__content">{notificationsError}</div>
                  </div>
                ) : null}

                {!loadingItems && notificationsError === null && items.length === 0 ? (
                  <p className="u-muted" style={{ padding: 16 }}>
                    You have no unread notifications.
                  </p>
                ) : null}

                {items.map((notification) => (
                  <button
                    type="button"
                    key={notification.id}
                    className="notification-item is-unread"
                    onClick={() => {
                      void markRead(notification);
                    }}
                  >
                    <span className={severityClass(notification.severity)} aria-hidden="true" />
                    <span className="notification-item__body">
                      <span className="notification-item__title">{notification.title}</span>
                      {notification.body !== '' ? (
                        <span className="notification-item__text">{notification.body}</span>
                      ) : null}
                      <span className="notification-item__time">
                        {formatRelativeTime(notification.created_at)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="user-menu" ref={userMenuRef}>
          <button
            type="button"
            className="user-menu__trigger"
            onClick={() => {
              setUserMenuOpen((current) => !current);
              setBellOpen(false);
            }}
            aria-expanded={userMenuOpen}
            aria-haspopup="true"
          >
            <span className="user-menu__avatar" aria-hidden="true">
              {initials(user?.first_name, user?.last_name, user?.username)}
            </span>
            <span className="user-menu__meta">
              <span className="user-menu__name">{displayName}</span>
              <span className="user-menu__role">{user?.role_name ?? ''}</span>
            </span>
          </button>

          {userMenuOpen ? (
            <div className="dropdown" role="menu">
              <div className="dropdown__section">{user?.username ?? ''}</div>
              <button
                type="button"
                className="dropdown__item"
                role="menuitem"
                onClick={() => {
                  setUserMenuOpen(false);
                  setProfileOpen(true);
                }}
              >
                <Icon name="user" size={15} />
                Profile &amp; password
              </button>
              <div className="dropdown__divider" />
              <button
                type="button"
                className="dropdown__item dropdown__item--danger"
                role="menuitem"
                onClick={() => {
                  void signOut();
                }}
              >
                <Icon name="logout" size={15} />
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} />
    </header>
  );
}

export default Topbar;
