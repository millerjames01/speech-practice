/**
 * Theme choice. Light is the default - this is a reading app - but the choice
 * follows the system on first visit and is remembered per browser afterwards.
 *
 * localStorage is fine here where it is not for keys: a theme is not a secret,
 * and losing it costs nothing.
 */

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'ct.theme';

function preferred(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // Storage blocked; fall through to the system preference.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

let current: Theme = 'light';

export function applyTheme(theme: Theme): void {
  current = theme;
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Not worth surfacing.
  }
}

export function initTheme(): Theme {
  applyTheme(preferred());
  return current;
}

export function toggleTheme(): Theme {
  applyTheme(current === 'dark' ? 'light' : 'dark');
  return current;
}

export const currentTheme = (): Theme => current;
