import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The Django backend is the only origin that may speak to the API: REST_FRAMEWORK
 * is configured with Django *session* authentication, so every request must be
 * same-origin, cookies included, with the CSRF token echoed in X-CSRFToken.
 *
 * The dev server therefore proxies /api (and /media) to the Django process and
 * keeps `changeOrigin: false` so the Host header - and therefore the CSRF
 * origin check and the session cookie domain - stay identical to what the
 * browser sees. Never point the SPA at an absolute API URL.
 */
const DJANGO_ORIGIN = 'http://127.0.0.1:8000';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: DJANGO_ORIGIN,
        changeOrigin: false,
      },
      '/media': {
        target: DJANGO_ORIGIN,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    // Asset URLs are emitted as /static/assets/... so the bundle is served by
    // WhiteNoise from STATIC_ROOT in production (Django's `static/` mount).
    // With the default base ('/') the built index.html requests /assets/...,
    // which the SPA catch-all route answers with index.html - the browser ends
    // up with HTML where it expects JavaScript, and the app never boots.
    assetsDir: 'assets',
  },
  // The dev server keeps serving from '/', because Vite serves the module
  // graph itself; only the production bundle needs the static prefix.
  base: mode === 'production' ? '/static/' : '/',
}));
