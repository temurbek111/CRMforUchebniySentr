import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { router } from './router';
import { SettingsProvider } from './settings/SettingsContext';

/**
 * Provider stack: the auth context must wrap the settings context (settings
 * are only fetched for a signed-in user) and both must wrap the router.
 */
export function App() {
  return (
    <AuthProvider>
      <SettingsProvider>
        <RouterProvider router={router} />
      </SettingsProvider>
    </AuthProvider>
  );
}

export default App;
