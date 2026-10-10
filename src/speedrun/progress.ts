/**
 * Speedrun progress: which lessons are done, best times, and the items you
 * missed (for the review deck). Kept in localStorage because it is a per-viewer
 * convenience; every access is guarded so a blocked or cleared store just
 * means starting fresh, never a broken page.
 */

const KEY = 'sr.progress.v1';

export interface LessonRecord {
  bestMs: number;
  /** Best first-try accuracy, 0-1. */
  bestScore: number;
  runs: number;
}

export interface MissRecord {
  lessonId: string;
  index: number;
  count: number;
  last: number;
}

export interface Prefs {
  /** Play the Catalan answer automatically after each check. */
  autoplay: boolean;
}

interface Store {
  lessons: Record<string, LessonRecord>;
  missed: Record<string, MissRecord>;
  prefs: Prefs;
}

const empty = (): Store => ({ lessons: {}, missed: {}, prefs: { autoplay: true } });

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<Store>;
    return {
      lessons: parsed.lessons ?? {},
      missed: parsed.missed ?? {},
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

export const itemKey = (lessonId: string, index: number): string => `${lessonId}#${index}`;

export function getLessonRecord(id: string): LessonRecord | undefined {
  return read().lessons[id];
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

export function recordMiss(lessonId: string, index: number): void {
  const store = read();
  const key = itemKey(lessonId, index);
  const prev = store.missed[key];
  store.missed[key] = { lessonId, index, count: (prev?.count ?? 0) + 1, last: Date.now() };
  write(store);
}

/** A first-try hit on a missed item clears it from the review deck. */
export function clearMiss(lessonId: string, index: number): void {
  const store = read();
  delete store.missed[itemKey(lessonId, index)];
  write(store);
}

/** Most recently and most often missed first. */
export function missedItems(limit: number): MissRecord[] {
  return Object.values(read().missed)
    .sort((a, b) => b.last - a.last || b.count - a.count)
    .slice(0, limit);
}

export function missedCount(): number {
  return Object.keys(read().missed).length;
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
