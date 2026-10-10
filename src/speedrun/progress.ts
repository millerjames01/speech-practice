/**
 * Speedrun progress: lessons done with best times, the spaced-repetition
 * cards for every item seen, and viewer preferences. Kept in localStorage
 * because it is a per-viewer convenience; every access is guarded so a blocked
 * or cleared store just means starting fresh, never a broken page.
 */

import { LONG_TERM_STEP, enroll, isDue, review, type SrsCard } from './srs';

const KEY = 'sr.progress.v1';

export interface LessonRecord {
  bestMs: number;
  /** Best first-try accuracy, 0-1. */
  bestScore: number;
  runs: number;
}

export interface Prefs {
  /** Play the Catalan answer automatically after each check. */
  autoplay: boolean;
  /** Hear the Catalan and type it, instead of translating from Castellano. */
  dictation: boolean;
}

interface Store {
  lessons: Record<string, LessonRecord>;
  cards: Record<string, SrsCard>;
  prefs: Prefs;
}

/** The pre-SRS "missed items" list, migrated into due cards on read. */
interface LegacyMiss {
  lessonId: string;
  index: number;
  count: number;
}

const empty = (): Store => ({ lessons: {}, cards: {}, prefs: { autoplay: true, dictation: false } });

export const itemKey = (lessonId: string, index: number): string => `${lessonId}#${index}`;

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<Store> & { missed?: Record<string, LegacyMiss> };
    const cards = { ...(parsed.cards ?? {}) };
    for (const [k, m] of Object.entries(parsed.missed ?? {})) {
      cards[k] ??= { lessonId: m.lessonId, index: m.index, step: 0, due: 0, lapses: m.count };
    }
    return {
      lessons: parsed.lessons ?? {},
      cards,
      prefs: { ...empty().prefs, ...(parsed.prefs ?? {}) },
    };
  } catch {
    return empty();
  }
}

function write(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Storage unavailable: progress lasts for this page only.
  }
}

export function allLessonRecords(): Record<string, LessonRecord> {
  return read().lessons;
}

export function recordLesson(id: string, ms: number, score: number): LessonRecord {
  const store = read();
  const prev = store.lessons[id];
  const next: LessonRecord = {
    bestMs: prev ? Math.min(prev.bestMs, ms) : ms,
    bestScore: prev ? Math.max(prev.bestScore, score) : score,
    runs: (prev?.runs ?? 0) + 1,
  };
  store.lessons[id] = next;
  write(store);
  return next;
}

/**
 * Records a first-try answer.
 *
 * In a review (Today) it moves the card up or down the ladder. In a lesson it
 * enrolls items seen for the first time; re-running a lesson for speed never
 * pushes a card's schedule out early, but a miss still sends it back down.
 */
export function recordAnswer(
  lessonId: string,
  index: number,
  correct: boolean,
  context: 'lesson' | 'review',
  now = Date.now(),
): void {
  const store = read();
  const k = itemKey(lessonId, index);
  const card = store.cards[k];
  if (!card) store.cards[k] = enroll(lessonId, index, correct, now);
  else if (context === 'review' || !correct) store.cards[k] = review(card, correct, now);
  else return;
  write(store);
}

export function allCards(): SrsCard[] {
  return Object.values(read().cards);
}

export function cardStats(now = Date.now()): { learned: number; due: number; longTerm: number } {
  const cards = allCards();
  return {
    learned: cards.length,
    due: cards.filter((c) => isDue(c, now)).length,
    longTerm: cards.filter((c) => c.step >= LONG_TERM_STEP).length,
  };
}

export function getPrefs(): Prefs {
  return read().prefs;
}

export function setPrefs(prefs: Prefs): void {
  const store = read();
  store.prefs = prefs;
  write(store);
}

export function resetProgress(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

export function formatMs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
