import { defineConfig } from 'vite';
import { serviceWorker } from './scripts/sw-plugin';

/**
 * The brief flags CORS as a week-one unknown: if any ElevenLabs or LLM call is
 * blocked from the browser, the fix is a dev-server proxy rather than a real
 * backend. These routes are always mounted but unused unless the settings modal
 * turns the proxy on, so switching is a setting, not a rebuild.
 */
const proxyTarget = (target: string, prefix: string) => ({
  target,
  changeOrigin: true,
  secure: true,
  rewrite: (path: string) => path.replace(prefix, ''),
});

/** Which build is running, shown in the app: the commit (GitHub Actions sets GITHUB_SHA) and when it was built. */
const version = (process.env.GITHUB_SHA ?? 'dev').slice(0, 7);
const builtAt = new Date().toISOString();

export default defineConfig({
  // GitHub Pages serves the site from /<repo>/; the deploy workflow sets this.
  base: process.env.BASE_PATH ?? '/',
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILT_AT__: JSON.stringify(builtAt),
  },
  plugins: [serviceWorker()],
  server: {
    port: 5173,
    proxy: {
      '/proxy/elevenlabs': proxyTarget('https://api.elevenlabs.io', '/proxy/elevenlabs'),
      '/proxy/openrouter': proxyTarget('https://openrouter.ai', '/proxy/openrouter'),
      '/proxy/anthropic': proxyTarget('https://api.anthropic.com', '/proxy/anthropic'),
    },
  },
  build: { target: 'es2022' },
});
