/**
 * Speedrun progress: lessons done with best times, the spaced-repetition
 * cards for every item seen, and viewer preferences. Kept in localStorage
 * because it is a per-viewer convenience; every access is guarded so a blocked
 * or cleared store just means starting fresh, never a broken page.
 */

import { DAY, INTERVALS, LONG_TERM_STEP, enroll, isDue, review, type SrsCard } from './srs';
import { mergeLessons, newerCard, type SyncPayload } from './sync';

const KEY = 'sr.progress.v1';

export interface LessonRecord {
  bestMs: number;
  /** Best first-try accuracy, 0-1. */
  bestScore: number;
  runs: number;
  /** When the lesson was first finished; later star tiers open counting from here. */
  firstAt?: number;
}

export interface Prefs {
  /** Play the Catalan answer automatically after each check. */
  autoplay: boolean;
  /** Hear the Catalan and type it, instead of translating from Castellano. */
  dictation: boolean;
  /** Say the Catalan answer (speech recognition) instead of typing it. */
  voiceAnswers: boolean;
  /** In voice mode, start listening by itself a moment after each new phrase. */
  autoListen: boolean;
  /** Voice: with nothing said yet, keep the mic open past the first pause. */
  holdOpen: boolean;
  /** Voice: after a pause in an answer that is right so far, wait for the rest. */
  waitForRest: boolean;
  /** Voice: after a wrong try, clear and listen again without a tap. */
  autoRetry: boolean;
  /** After a perfect answer, move on by itself after a short countdown. */
  autoAdvance: boolean;
  /** Chosen browser voice (voiceURI); empty picks the best Catalan voice available. */
  voice: string;
  /** The "get a better voice" tip was dismissed. */
  voiceTipHidden: boolean;
}

interface Store {
  lessons: Record<string, LessonRecord>;
  cards: Record<string, SrsCard>;
  prefs: Prefs;
  /** XP earned per local day ("2026-10-11": 140); the streak is read off this. */
  xp: Record<string, number>;
  /** Best conjugation-sprint score. */
  sprintBest: number;
  /** Conjugation forms by key: consecutive right answers, 0-3. Two in a row counts as known. */
  forms: Record<string, number>;
  /**
   * When each form was last answered, in epoch minutes, so the sprint can space
   * them. Kept per device (not in sync codes): on another device a form is
   * simply treated as due.
   */
  formsSeen: Record<string, number>;
  /** Store layout; anything older than STORE_VERSION is converted once by migrateProgress. */
  version: number;
}

/** 2: XP, streak and conjugation forms. 3: translation sprint keys and the topic vocab pack. */
export const STORE_VERSION = 3;

/** The pre-SRS "missed items" list, migrated into due cards on read. */
interface LegacyMiss {
  lessonId: string;
  index: number;
  count: number;
}

const empty = (): Store => ({ lessons: {}, cards: {}, prefs: { autoplay: true, dictation: false, voiceAnswers: false, autoListen: false, holdOpen: true, waitForRest: true, autoRetry: true, autoAdvance: false, voice: '', voiceTipHidden: false }, xp: {}, sprintBest: 0, forms: {}, formsSeen: {}, version: STORE_VERSION });

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
      xp: parsed.xp ?? {},
      sprintBest: parsed.sprintBest ?? 0,
      forms: parsed.forms ?? {},
      formsSeen: parsed.formsSeen ?? {},
      version: parsed.version ?? 1,
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

export function recordLesson(id: string, ms: number, score: number, now = Date.now()): LessonRecord {
  const store = read();
  const prev = store.lessons[id];
  const next: LessonRecord = {
    bestMs: prev ? Math.min(prev.bestMs, ms) : ms,
    bestScore: prev ? Math.max(prev.bestScore, score) : score,
    runs: (prev?.runs ?? 0) + 1,
    // Records from before firstAt existed keep going without one; their date is estimated from the cards.
    ...(prev ? (prev.firstAt !== undefined ? { firstAt: prev.firstAt } : {}) : { firstAt: now }),
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

const FILE_KIND = 'catalan-speedrun-progress';

/** Everything needed to restore progress on another device, as JSON. */
export function exportProgress(now = new Date()): string {
  return JSON.stringify({ kind: FILE_KIND, version: 1, exportedAt: now.toISOString(), data: read() }, null, 2);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Replaces progress with an exported file. Validates every record first, so a
 * wrong or damaged file changes nothing.
 */
export function importProgress(text: string): { lessons: number; cards: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!isRecord(parsed) || parsed.kind !== FILE_KIND || !isRecord(parsed.data)) {
    throw new Error('That is not a Speedrun progress file.');
  }
  const { lessons = {}, cards = {}, prefs = {}, xp = {}, sprintBest = 0, forms = {} } = parsed.data;
  if (!isRecord(lessons) || !isRecord(cards) || !isRecord(prefs) || !isRecord(xp) || !isNum(sprintBest) || !isRecord(forms)) {
    throw new Error('The progress file is damaged.');
  }
  if (!Object.values(xp).every(isNum)) throw new Error('The progress file has damaged XP records.');
  if (!Object.values(forms).every(isNum)) throw new Error('The progress file has damaged conjugation records.');
  for (const r of Object.values(lessons)) {
    if (!isRecord(r) || !isNum(r.bestMs) || !isNum(r.bestScore) || !isNum(r.runs) || (r.firstAt !== undefined && !isNum(r.firstAt))) {
      throw new Error('The progress file has a damaged lesson record.');
    }
  }
  for (const c of Object.values(cards)) {
    if (!isRecord(c) || typeof c.lessonId !== 'string' || !isNum(c.index) || !isNum(c.step) || !isNum(c.due) || !isNum(c.lapses)) {
      throw new Error('The progress file has a damaged review card.');
    }
  }
  write({
    lessons: lessons as Record<string, LessonRecord>,
    cards: cards as Record<string, SrsCard>,
    prefs: { ...empty().prefs, ...(prefs as Partial<Prefs>) },
    xp: xp as Record<string, number>,
    sprintBest,
    forms: forms as Record<string, number>,
    formsSeen: isRecord(parsed.data.formsSeen) && Object.values(parsed.data.formsSeen).every(isNum) ? (parsed.data.formsSeen as Record<string, number>) : {},
    version: isNum(parsed.data.version) ? parsed.data.version : 1,
  });
  return { lessons: Object.keys(lessons).length, cards: Object.keys(cards).length };
}

/** Merges another device's progress into this one, newest state of every item wins. */
export function mergeProgress(
  incoming: Pick<SyncPayload, 'lessons' | 'cards'> & Partial<Pick<SyncPayload, 'xp' | 'sprintBest' | 'forms'>>,
): { lessons: number; cards: number } {
  const store = read();
  let lessons = 0;
  let cards = 0;
  for (const [id, rec] of Object.entries(incoming.lessons)) {
    const merged = mergeLessons(store.lessons[id], rec);
    if (JSON.stringify(merged) !== JSON.stringify(store.lessons[id])) lessons += 1;
    store.lessons[id] = merged;
  }
  for (const card of incoming.cards) {
    const k = itemKey(card.lessonId, card.index);
    const mine = store.cards[k];
    const winner = mine ? newerCard(mine, card) : card;
    if (winner !== mine) cards += 1;
    store.cards[k] = winner;
  }
  // Per day the larger tally wins: syncing twice never double-counts.
  for (const [day, n] of Object.entries(incoming.xp ?? {})) store.xp[day] = Math.max(store.xp[day] ?? 0, n);
  store.sprintBest = Math.max(store.sprintBest, incoming.sprintBest ?? 0);
  // Forms carry no timestamp; the better of the two counts wins.
  for (const [k, n] of Object.entries(incoming.forms ?? {})) store.forms[k] = Math.max(store.forms[k] ?? 0, n);
  write(store);
  return { lessons, cards };
}

/* ---------- XP and side quests ---------- */

export function dayKey(t: number): string {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addXp(amount: number, now = Date.now()): void {
  if (amount <= 0) return;
  const store = read();
  const k = dayKey(now);
  store.xp[k] = (store.xp[k] ?? 0) + amount;
  write(store);
}

export function allXp(): Record<string, number> {
  return read().xp;
}

/** Total XP, today's XP, and the run of consecutive practice days ending today (or yesterday). */
export function xpStats(now = Date.now()): { total: number; today: number; streak: number } {
  const xp = read().xp;
  const total = Object.values(xp).reduce((a, b) => a + b, 0);
  const today = xp[dayKey(now)] ?? 0;
  let streak = 0;
  const day = new Date(now);
  if (!today) day.setDate(day.getDate() - 1); // today not started yet: the streak is still alive
  while ((xp[dayKey(day.getTime())] ?? 0) > 0) {
    streak += 1;
    day.setDate(day.getDate() - 1);
  }
  return { total, today, streak };
}

export function getSprintBest(): number {
  return read().sprintBest;
}

/** Records a sprint score; returns true when it beats the best. */
export function recordSprint(score: number): boolean {
  const store = read();
  if (score <= store.sprintBest) return false;
  store.sprintBest = score;
  write(store);
  return true;
}

/** True when this device holds progress from before XP and ratings existed. */
export function needsMigration(): boolean {
  return read().version < STORE_VERSION;
}

/** XP a backfilled answer is worth: the same as a first-try lesson answer. */
const BACKFILL_XP = 10;

/** What the content layer supplies for a migration; storage knows nothing of lessons or packs. */
export interface MigrationPlan {
  /** Current conjugation keys to credit with one right answer (forms from lessons already held). */
  seedForms: string[];
  /** Rewrites conjugation progress onto the current form keys. */
  mapForms: (old: Record<string, number>) => Record<string, number>;
  /** Moves a card onto the current content, or drops it (null) when its item no longer exists. */
  mapCard: (card: SrsCard) => SrsCard | null;
}

/**
 * Converts older progress, once. Lessons and lesson cards need nothing
 * (stars and percentages are read off them); the rest gets a fair start:
 * - v1: XP and streak are backfilled from when each item was last answered
 *   (estimated from its schedule for cards older than the "last" field);
 * - v1-2: conjugation progress moves onto the current forms, and forms from
 *   lessons already held are credited with one right answer;
 * - v1-2: vocab cards move to the same word in the current pack, or go.
 * Never lowers a lesson or conjugation record, so running it on merged or
 * imported data is safe.
 */
export function migrateProgress(plan: MigrationPlan, now = Date.now()): { xp: number; forms: number; words: number } {
  const store = read();
  let xp = 0;
  if (Object.keys(store.xp).length === 0) {
    for (const c of Object.values(store.cards)) {
      const at = c.last ?? c.due - (INTERVALS[c.step] ?? 1) * DAY;
      if (!Number.isFinite(at) || at <= 0 || at > now) continue;
      const k = dayKey(at);
      store.xp[k] = (store.xp[k] ?? 0) + BACKFILL_XP;
      xp += BACKFILL_XP;
    }
  }
  const forms = plan.mapForms(store.forms);
  for (const k of plan.seedForms) forms[k] = Math.max(forms[k] ?? 0, 1);
  store.forms = forms;

  const cards: Record<string, SrsCard> = {};
  let words = 0;
  for (const c of Object.values(store.cards)) {
    const moved = plan.mapCard(c);
    if (!moved) continue;
    const k = itemKey(moved.lessonId, moved.index);
    const existing = cards[k];
    cards[k] = existing ? newerCard(existing, moved) : moved;
    if (moved !== c) words += 1;
  }
  store.cards = cards;
  store.version = STORE_VERSION;
  write(store);
  return { xp, forms: Object.values(forms).filter((n) => n > 0).length, words };
}

/** Conjugation forms answered in sprints: key → consecutive right answers. */
export function allForms(): Record<string, number> {
  return read().forms;
}

/** When each form was last answered on this device (epoch minutes). */
export function allFormsSeen(): Record<string, number> {
  return read().formsSeen;
}

/** Records sprint answers in one write: a right answer climbs (to 3), a miss resets. */
export function recordForms(results: [key: string, correct: boolean][], now = Date.now()): void {
  if (results.length === 0) return;
  const store = read();
  const minute = Math.floor(now / 60_000);
  for (const [k, correct] of results) {
    store.forms[k] = correct ? Math.min(3, (store.forms[k] ?? 0) + 1) : 0;
    store.formsSeen[k] = minute;
  }
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
