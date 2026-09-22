import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { LoadingState } from '../components/LoadingState';
import { useAuth } from './AuthContext';

export interface RequireAuthProps {
  children: ReactNode;
}

/**
 * Route guard: renders nothing but a full-page spinner while the initial
 * /api/auth/me call is in flight, and redirects anonymous visitors to /login
 * remembering where they wanted to go. The server still enforces every
 * permission - this only decides what the browser shows.
 */
export function RequireAuth({ children }: RequireAuthProps) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="app-content">
        <LoadingState label="Checking your session…" />
      </div>
    );
  }

  if (user === null) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }

  return <>{children}</>;
}

export default RequireAuth;
