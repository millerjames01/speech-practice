/** The running build, set at build time (see vite.config.ts). */
declare const __APP_VERSION__: string;
declare const __BUILT_AT__: string;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
export const BUILT_AT = typeof __BUILT_AT__ === 'string' ? __BUILT_AT__ : '';

/** "Version 0afa2b2 · built 25 Oct, 09:43", in the reader's own time zone. */
export function versionLabel(): string {
  const when = BUILT_AT ? new Date(BUILT_AT) : null;
  const built =
    when && !Number.isNaN(when.getTime())
      ? ` · built ${when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
      : '';
  return `Version ${APP_VERSION}${built}`;
}
