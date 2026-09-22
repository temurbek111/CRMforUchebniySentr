import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { health as healthApi } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { ApiError, errorMessage, errorMessages } from '../types';

interface LocationState {
  from?: string;
}

/**
 * Sign-in screen. Posts real credentials to POST /api/auth/login (session
 * cookie + CSRF handled by the API client) and surfaces the backend's uniform
 * error body inline: `{detail, errors: {field: [messages]}}`.
 */
export function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const state = location.state as unknown as LocationState | null;
  const redirectTo = state?.from !== undefined && state.from !== '' ? state.from : '/';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [centreName, setCentreName] = useState('');

  // Public endpoint: lets the login card show the centre's real name.
  useEffect(() => {
    let active = true;
    healthApi
      .get()
      .then((result) => {
        if (active) setCentreName(result.centre);
      })
      .catch(() => {
        // Offline or backend down: the generic title is used instead.
      });
    return () => {
      active = false;
    };
  }, []);

  if (!loading && user !== null) {
    return <Navigate to={redirectTo} replace />;
  }

  const fieldErrors = (field: string): string[] =>
    error instanceof ApiError ? error.fieldMessages(field) : [];

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login({ username, password });
      navigate(redirectTo, { replace: true });
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };

  const generalErrors =
    error === null
      ? []
      : errorMessages(error).filter((message) => !fieldErrors('username').includes(message) && !fieldErrors('password').includes(message));

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__brand">
          <span className="auth-card__logo" aria-hidden="true">
            LC
          </span>
          <div>
            <h1 className="auth-card__title">
              {centreName === '' ? 'Learning Centre CRM' : centreName}
            </h1>
            <p className="auth-card__subtitle">Sign in to continue</p>
          </div>
        </div>

        {generalErrors.length > 0 ? (
          <div className="alert alert--error" role="alert" style={{ marginBottom: 16 }}>
            <span className="alert__icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5" />
                <path d="M12 16.4v.1" />
              </svg>
            </span>
            <div className="alert__content">
              {generalErrors.length === 1 ? (
                <span>{generalErrors[0]}</span>
              ) : (
                <ul className="alert__list">
                  {generalErrors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}

        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          <TextField
            label="Username"
            value={username}
            onChange={setUsername}
            autoComplete="username"
            autoFocus
            required
            error={fieldErrors('username')}
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            required
            error={fieldErrors('password')}
          />
          <Button type="submit" variant="primary" block loading={busy}>
            Sign in
          </Button>
        </form>

        <p className="auth-card__footer">
          {error === null
            ? 'Sessions are managed by the server; access follows the permissions of your role.'
            : errorMessage(error)}
        </p>
      </div>
    </div>
  );
}

export default LoginPage;
