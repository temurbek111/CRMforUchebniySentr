import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AUTH_REQUIRED_EVENT } from '../api/client';
import { auth as authApi } from '../api/endpoints';
import { ApiError } from '../types';
import type { LoginCredentials, Me, NavigationItem } from '../types';

export interface AuthContextValue {
  /** Signed-in user, or null when the session is anonymous/expired. */
  user: Me | null;
  /** Convenience set built from the backend's `permission_codes`. */
  permissions: Set<string>;
  /** Role-filtered navigation exactly as returned by GET /api/auth/me. */
  navigation: NavigationItem[];
  /** True until the first /api/auth/me attempt settles. */
  loading: boolean;
  /** Set when the initial session check failed for a non-auth reason. */
  error: unknown;
  login: (credentials: LoginCredentials) => Promise<Me>;
  logout: () => Promise<void>;
  /** Re-reads /api/auth/me. Returns the user, or null when signed out. */
  refresh: () => Promise<Me | null>;
  /**
   * Client-side permission check. Purely cosmetic: hiding a button never
   * replaces the server-side RequirePerms checks.
   */
  hasPerm: (code: string) => boolean;
  /** True when at least one of the supplied codes is granted. */
  hasAnyPerm: (codes: ReadonlyArray<string>) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;

    const bootstrap = async (): Promise<void> => {
      try {
        const me = await authApi.me();
        if (!active) return;
        setUser(me);
        setError(null);
      } catch (cause) {
        if (!active) return;
        // 401 (or DRF's 403 for an unauthenticated session) simply means
        // "not signed in": clear the user and let the router redirect to
        // /login. Anything else is reported to the login screen.
        setUser(null);
        setError(cause instanceof ApiError && cause.isAuthError ? null : cause);
      } finally {
        if (active) setLoading(false);
      }
    };

    void bootstrap();
    return () => {
      active = false;
    };
  }, []);

  // The API client fires this when any request comes back "not signed in"
  // (for example after the Django session expires in another tab).
  useEffect(() => {
    const handleAuthRequired = (): void => {
      setUser(null);
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired);
  }, []);

  const refresh = useCallback(async (): Promise<Me | null> => {
    try {
      const me = await authApi.me();
      setUser(me);
      setError(null);
      return me;
    } catch (cause) {
      if (cause instanceof ApiError && cause.isAuthError) {
        setUser(null);
        setError(null);
        return null;
      }
      setError(cause);
      return null;
    }
  }, []);

  const login = useCallback(async (credentials: LoginCredentials): Promise<Me> => {
    // POST /api/auth/login returns the same payload as /me, navigation included.
    const me = await authApi.login(credentials);
    setUser(me);
    setError(null);
    return me;
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await authApi.logout();
    } catch (cause) {
      // The local session is dropped either way; a failed logout call must
      // never trap the user inside the app.
      if (!(cause instanceof ApiError)) {
        setError(cause);
      }
    } finally {
      setUser(null);
    }
  }, []);

  const permissions = useMemo(
    () => new Set<string>(user === null ? [] : user.permission_codes),
    [user],
  );

  const hasPerm = useCallback((code: string): boolean => permissions.has(code), [permissions]);

  const hasAnyPerm = useCallback(
    (codes: ReadonlyArray<string>): boolean => codes.some((code) => permissions.has(code)),
    [permissions],
  );

  const navigation = useMemo<NavigationItem[]>(
    () => (user === null ? [] : user.navigation),
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      permissions,
      navigation,
      loading,
      error,
      login,
      logout,
      refresh,
      hasPerm,
      hasAnyPerm,
    }),
    [user, permissions, navigation, loading, error, login, logout, refresh, hasPerm, hasAnyPerm],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Access the auth context; throws when used outside <AuthProvider>. */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used inside <AuthProvider>.');
  }
  return context;
}

export default AuthProvider;
