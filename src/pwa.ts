/**
 * Registers the offline service worker in production builds. The dev server
 * never gets one, so a stale cache can't hide work in progress.
 *
 * Updates: the worker is checked again whenever the app comes back to the
 * front (an installed app can stay open in the background for days). When a
 * new version takes over, updateReady() turns true, and the map reloads the
 * page the next time it is shown, never in the middle of a session.
 */
let ready = false;

export const updateReady = (): boolean => ready;

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  // A worker already in charge means a later change of worker is an update, not the first install.
  const hadController = navigator.serviceWorker.controller !== null;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) ready = true;
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((reg) => {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void reg.update().catch(() => {});
        });
      })
      .catch(() => {
        // Offline support is a bonus; the app works without it.
      });
  });
}
