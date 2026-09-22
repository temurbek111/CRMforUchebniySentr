import { useEffect, useState } from 'react';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { TextField } from '../components/TextField';
import { auth as authApi } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { ApiError, errorMessage } from '../types';

export interface ProfileDialogProps {
  open: boolean;
  onClose: () => void;
}

type Tab = 'profile' | 'password';

/**
 * Account dialog for the signed-in user: PATCH /api/auth/me for the personal
 * details and POST /api/auth/password for a password change. Both endpoints
 * exist in backend/apps/accounts/urls_auth.py.
 */
export function ProfileDialog({ open, onClose }: ProfileDialogProps) {
  const { user, refresh } = useAuth();
  const [tab, setTab] = useState<Tab>('profile');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [profileError, setProfileError] = useState<unknown>(null);
  const [profileSaved, setProfileSaved] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<unknown>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  // Re-seed the form whenever the dialog opens or the user changes.
  useEffect(() => {
    if (!open) return;
    setTab('profile');
    setFirstName(user?.first_name ?? '');
    setLastName(user?.last_name ?? '');
    setEmail(user?.email ?? '');
    setPhone(user?.phone ?? '');
    setProfileError(null);
    setProfileSaved(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError(null);
    setPasswordSaved(false);
  }, [open, user]);

  const fieldErrors = (error: unknown, field: string): string[] => {
    if (error instanceof ApiError) return error.fieldMessages(field);
    return [];
  };

  const saveProfile = async (): Promise<void> => {
    setSavingProfile(true);
    setProfileError(null);
    setProfileSaved(false);
    try {
      await authApi.updateProfile({
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
      });
      await refresh();
      setProfileSaved(true);
    } catch (cause) {
      setProfileError(cause);
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (): Promise<void> => {
    if (newPassword !== confirmPassword) {
      setPasswordError(new ApiError(400, 'The new passwords do not match.'));
      return;
    }
    setSavingPassword(true);
    setPasswordError(null);
    setPasswordSaved(false);
    try {
      await authApi.changePassword({ current_password: currentPassword, new_password: newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordSaved(true);
    } catch (cause) {
      setPasswordError(cause);
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Your account"
      subtitle={user === null ? undefined : `${user.username} · ${user.role_name}`}
      size="md"
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          {tab === 'profile' ? (
            <Button
              variant="primary"
              loading={savingProfile}
              onClick={() => {
                void saveProfile();
              }}
            >
              Save changes
            </Button>
          ) : (
            <Button
              variant="primary"
              loading={savingPassword}
              onClick={() => {
                void savePassword();
              }}
            >
              Change password
            </Button>
          )}
        </>
      }
    >
      <div className="u-stack">
        <div className="btn-group" role="tablist" aria-label="Account sections">
          <Button
            size="sm"
            variant={tab === 'profile' ? 'primary' : 'secondary'}
            role="tab"
            aria-selected={tab === 'profile'}
            onClick={() => setTab('profile')}
          >
            Profile
          </Button>
          <Button
            size="sm"
            variant={tab === 'password' ? 'primary' : 'secondary'}
            role="tab"
            aria-selected={tab === 'password'}
            onClick={() => setTab('password')}
          >
            Password
          </Button>
        </div>

        {profileSaved ? (
          <div className="alert alert--success" role="status">
            <div className="alert__content">Your details were saved.</div>
          </div>
        ) : null}

        {profileError !== null ? (
          <div className="alert alert--error" role="alert">
            <div className="alert__content">{errorMessage(profileError)}</div>
          </div>
        ) : null}

        {tab === 'profile' ? (
          <div className="form-grid">
            <TextField
              label="First name"
              value={firstName}
              onChange={setFirstName}
              autoComplete="given-name"
              error={fieldErrors(profileError, 'first_name')}
            />
            <TextField
              label="Last name"
              value={lastName}
              onChange={setLastName}
              autoComplete="family-name"
              error={fieldErrors(profileError, 'last_name')}
            />
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
              error={fieldErrors(profileError, 'email')}
            />
            <TextField
              label="Phone"
              type="tel"
              value={phone}
              onChange={setPhone}
              autoComplete="tel"
              error={fieldErrors(profileError, 'phone')}
            />
            <TextField label="Username" value={user?.username ?? ''} onChange={() => undefined} disabled />
            <TextField label="Role" value={user?.role_name ?? ''} onChange={() => undefined} disabled />
          </div>
        ) : (
          <div className="u-stack">
            {passwordSaved ? (
              <div className="alert alert--success" role="status">
                <div className="alert__content">Your password was updated.</div>
              </div>
            ) : null}

            {passwordError !== null ? (
              <div className="alert alert--error" role="alert">
                <div className="alert__content">{errorMessage(passwordError)}</div>
              </div>
            ) : null}

            <TextField
              label="Current password"
              type="password"
              value={currentPassword}
              onChange={setCurrentPassword}
              autoComplete="current-password"
              required
              error={fieldErrors(passwordError, 'current_password')}
            />
            <TextField
              label="New password"
              type="password"
              value={newPassword}
              onChange={setNewPassword}
              autoComplete="new-password"
              required
              hint="At least 8 characters, not too similar to your details and not a common password."
              error={fieldErrors(passwordError, 'new_password')}
            />
            <TextField
              label="Confirm new password"
              type="password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
              required
            />
          </div>
        )}
      </div>
    </Modal>
  );
}

export default ProfileDialog;
