/**
 * Generates the offline service worker at build time.
 *
 * Asset names carry content hashes, so the worker's precache list has to be
 * written after bundling. Everything the app needs (HTML, JS, CSS, icons,
 * manifest) is cached on install, so the app works offline from the first
 * visit onwards. Cross-origin requests (ElevenLabs, LLM APIs) are never
 * intercepted.
 */

import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';

function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? listFiles(full) : [full];
    });
  } catch {
    return [];
  }
}

export function serviceWorker(publicDir = 'public'): Plugin {
  return {
    name: 'speedrun-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const fromPublic = listFiles(publicDir).map((f) => relative(publicDir, f).split('\\').join('/'));
      const assets = [...new Set(['', 'index.html', ...built, ...fromPublic])]
        .filter((f) => f !== 'sw.js')
        .map((f) => `./${f}`);
      const version = createHash('sha256').update(assets.join('\n')).digest('hex').slice(0, 12);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: workerSource(version, assets) });
    },
  };
}

function workerSource(version: string, assets: string[]): string {
  return `// Generated at build time by scripts/sw-plugin.ts. Do not edit.
const CACHE = 'speedrun-${version}';
const ASSETS = ${JSON.stringify(assets, null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('speedrun-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  // Pages: network first so updates arrive, cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html', { ignoreSearch: true })),
    );
    return;
  }

  // Hashed assets never change: cache first.
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
`;
}
