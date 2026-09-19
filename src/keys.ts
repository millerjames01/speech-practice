/**
 * In-memory key store.
 *
 * Keys live in a module-level variable for the life of the page. A "remember
 * for this tab" checkbox (unchecked by default) copies them to sessionStorage,
 * which dies with the tab. Keys never reach .env, localStorage, logs or cached
 * payloads, and are never included in anything written to IndexedDB.
 */

import { config } from './config';

export type LlmProvider = 'openrouter' | 'anthropic';

export interface Settings {
  elevenLabsKey: string;
  llmProvider: LlmProvider;
  llmKey: string;
  llmModel: string;
  /** Optional third key for a per-word classifier. Unused by ThresholdJudge. */
  jevKey: string;
  /** Route API calls through the Vite dev proxy instead of direct fetch. */
  useProxy: boolean;
}

const SESSION_KEY = 'ct.settings';

const empty = (): Settings => ({
  elevenLabsKey: '',
  llmProvider: 'openrouter',
  llmKey: '',
  llmModel: config.llm.openrouter.defaultModel,
  jevKey: '',
  useProxy: false,
});

let settings: Settings = empty();
let remember = false;

export function getSettings(): Settings {
  return { ...settings };
}

export function setSettings(next: Settings, rememberForTab: boolean): void {
  settings = { ...next };
  remember = rememberForTab;
  if (remember) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(settings));
    } catch {
      // Storage unavailable (private mode, blocked). Keys stay in memory only.
    }
  } else {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // Nothing to clear.
    }
  }
}

/** Restore keys the user chose to remember for this tab, if any. */
export function loadRemembered(): boolean {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    settings = { ...empty(), ...(JSON.parse(raw) as Partial<Settings>) };
    remember = true;
    return true;
  } catch {
    return false;
  }
}

export function isRemembering(): boolean {
  return remember;
}

export function clearKeys(): void {
  settings = empty();
  remember = false;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing to clear.
  }
}

export function hasElevenLabsKey(): boolean {
  return settings.elevenLabsKey.trim().length > 0;
}

export function hasLlmKey(): boolean {
  return settings.llmKey.trim().length > 0;
}

/** Throws with an actionable message rather than letting a 401 surface raw. */
export function requireElevenLabsKey(): string {
  const key = settings.elevenLabsKey.trim();
  if (!key) throw new Error('No ElevenLabs key set. Open Settings to add one.');
  return key;
}

export function requireLlmKey(): string {
  const key = settings.llmKey.trim();
  if (!key) throw new Error('No LLM key set. Open Settings to add one.');
  return key;
}
