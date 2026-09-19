import { defineConfig } from 'vite';

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

export default defineConfig({
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
