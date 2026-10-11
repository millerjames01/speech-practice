/**
 * Progress views derived from the review schedule. Nothing here is stored:
 * stars, level percentages and due counts are all read off the item cards,
 * so every practice mode feeds one source of truth.
 */

import { FORM_KNOWN, conjugationPool, type SprintCard } from './sprint';
import { DAY, INTERVALS, isDue, type SrsCard } from './srs';
import { SPEEDRUN_LEVELS, type SpeedrunLesson, type SpeedrunLevel } from './types';
import type { VocabPack } from './vocab';

/** Lesson items, as opposed to vocab-builder words, which live on their own track. */
export const isLessonCard = (c: SrsCard): boolean => /^(a2|b1|b2|c1)-\d{2}$/.test(c.lessonId);

/** An item's share of "held long-term": full credit once it lasts a month (step 4). */
export const itemCredit = (card: SrsCard | undefined): number => (card ? Math.min(1, (card.step + 1) / 5) : 0);

export type Stars = 0 | 1 | 2 | 3;

export const STAR_RULES = [
  'Finish the lesson once',
  'Recall every item after a week',
  'Hold every item at a month',
] as const;

export type CardIndex = Map<string, SrsCard>;

export function indexCards(cards: SrsCard[]): CardIndex {
  return new Map(cards.map((c) => [`${c.lessonId}#${c.index}`, c]));
}

const lessonCards = (lesson: SpeedrunLesson, cards: CardIndex): (SrsCard | undefined)[] =>
  lesson.items.map((_, i) => cards.get(`${lesson.id}#${i}`));

/** ★ finished · ★★ every item recalled after a week · ★★★ every item held at a month. Stars can fade. */
export function lessonStars(lesson: SpeedrunLesson, finished: boolean, cards: CardIndex): Stars {
  if (!finished) return 0;
  const cs = lessonCards(lesson, cards);
  if (cs.some((c) => !c)) return 1;
  if (cs.every((c) => c!.step >= 4)) return 3;
  if (cs.every((c) => c!.step >= 2)) return 2;
  return 1;
}

/** Steps each star tier needs: ★ none (finishing), ★★ step 2, ★★★ step 4. */
const STAR_STEPS: readonly number[] = [0, 2, 4];

/** The fewest days the ladder takes to reach a step: 1 + 3 = 4 days for step 2, 25 for step 4. */
export const daysToStep = (step: number): number => INTERVALS.slice(0, step).reduce((a, b) => a + b, 0);

/** Minimal shape of a lesson record, so this module needs nothing from storage. */
interface Finished {
  firstAt?: number;
}

/**
 * When the lesson was first learned. Records from before that date was kept
 * estimate it from the cards: an item at step s was learned at least
 * daysToStep(s) before its last answer, so the earliest such bound wins.
 */
export function learnedAt(lesson: SpeedrunLesson, record: Finished | undefined, cards: CardIndex, now: number): number {
  if (record?.firstAt !== undefined) return record.firstAt;
  let earliest = now;
  for (const c of lessonCards(lesson, cards)) {
    if (!c) continue;
    const last = c.last ?? c.due - (INTERVALS[c.step] ?? 1) * DAY;
    earliest = Math.min(earliest, last - daysToStep(c.step) * DAY);
  }
  return earliest;
}

/**
 * Stars a lesson can hold right now. Finishing is always open; ★★ opens once
 * enough days have passed for its items to reach a week's gap, ★★★ a month's.
 * Never fewer than the stars already held.
 */
export function availableStars(lesson: SpeedrunLesson, record: Finished | undefined, cards: CardIndex, now: number): 1 | 2 | 3 {
  if (!record) return 1;
  const age = now - learnedAt(lesson, record, cards, now);
  const open = STAR_STEPS.filter((step) => age >= daysToStep(step) * DAY).length as 1 | 2 | 3;
  return Math.max(open, lessonStars(lesson, true, cards)) as 1 | 2 | 3;
}

/** Days until the next star tier opens, or null when all three are open. */
export function nextStarOpensIn(lesson: SpeedrunLesson, record: Finished | undefined, cards: CardIndex, now: number): number | null {
  if (!record) return null;
  const available = availableStars(lesson, record, cards, now);
  if (available >= 3) return null;
  const opensAt = learnedAt(lesson, record, cards, now) + daysToStep(STAR_STEPS[available]!) * DAY;
  return Math.max(1, Math.ceil((opensAt - now) / DAY));
}

/** A perfect run: every item right on the first try, at least once. */
export const isPerfect = (record: { bestScore: number } | undefined): boolean => !!record && record.bestScore >= 1;

export function lessonDue(lesson: SpeedrunLesson, cards: CardIndex, now: number): number {
  return lessonCards(lesson, cards).filter((c) => c && isDue(c, now)).length;
}

/** The level's main indicator: how much of its material is held long-term, 0-1. */
export function levelProgress(lessons: SpeedrunLesson[], cards: CardIndex): number {
  const total = lessons.reduce((n, l) => n + l.items.length, 0);
  if (total === 0) return 0;
  const held = lessons.reduce((n, l) => n + lessonCards(l, cards).reduce((m, c) => m + itemCredit(c), 0), 0);
  return held / total;
}

/* ---------- ratings ----------
 * Lessons, conjugation and vocab are each rated on the same A2-C1 scale, so a
 * side track reads against the main level ("Conjugation B1 · 40%" next to
 * "A2 · 72%"). A rating sits at the first level not yet RATING_PASS-held.
 */

export const RATING_PASS = 0.8;

export interface Rating {
  level: SpeedrunLevel;
  /** Progress within that level, 0-1. */
  pct: number;
  byLevel: Record<SpeedrunLevel, number>;
  /** The whole track across every level, weighted by size, 0-1. */
  overall: number;
}

export function toRating(byLevel: Record<SpeedrunLevel, number>, weights?: Record<SpeedrunLevel, number>): Rating {
  const w = (l: SpeedrunLevel) => weights?.[l] ?? 1;
  const total = SPEEDRUN_LEVELS.reduce((n, l) => n + w(l), 0);
  const overall = total ? SPEEDRUN_LEVELS.reduce((n, l) => n + byLevel[l] * w(l), 0) / total : 0;
  for (const level of SPEEDRUN_LEVELS) if (byLevel[level] < RATING_PASS) return { level, pct: byLevel[level], byLevel, overall };
  const top = SPEEDRUN_LEVELS[SPEEDRUN_LEVELS.length - 1]!;
  return { level: top, pct: byLevel[top], byLevel, overall };
}

const perLevelList = <T>(f: (level: SpeedrunLevel) => T): Record<SpeedrunLevel, T> =>
  Object.fromEntries(SPEEDRUN_LEVELS.map((l) => [l, f(l)])) as Record<SpeedrunLevel, T>;
const perLevel = (f: (level: SpeedrunLevel) => number) => perLevelList(f);

/** Conjugation: each level's tenses across all verbs, a form fully credited after two right answers in a row. */
export function conjugationRating(forms: Record<string, number>, pool: SprintCard[] = conjugationPool()): Rating {
  const byLevel = perLevelList((level) => pool.filter((c) => c.level === level));
  return toRating(
    perLevel((level) => {
      const cards = byLevel[level];
      if (cards.length === 0) return 0;
      return cards.reduce((n, c) => n + Math.min(1, (forms[c.key] ?? 0) / FORM_KNOWN), 0) / cards.length;
    }),
    perLevel((level) => byLevel[level].length),
  );
}

/** Vocab: each level's words, credited the same way as lesson items. */
export function vocabRating(cards: CardIndex, pack: VocabPack): Rating {
  const words = perLevelList((level) =>
    pack.sets.filter((s) => s.level === level).flatMap((s) => s.words.map((_, i) => cards.get(`${s.id}#${i}`))),
  );
  return toRating(
    perLevel((level) => (words[level].length ? words[level].reduce((n, c) => n + itemCredit(c), 0) / words[level].length : 0)),
    perLevel((level) => words[level].length),
  );
}

/** The course itself as a rating: each level's held share, weighted by its item count. */
export function courseRating(byLevel: Record<SpeedrunLevel, SpeedrunLesson[]>, cards: CardIndex): Rating {
  return toRating(
    perLevel((level) => levelProgress(byLevel[level], cards)),
    perLevel((level) => byLevel[level].reduce((n, l) => n + l.items.length, 0)),
  );
}

/** Where a side track stands against the main level: -1 behind, 0 level, 1 ahead. */
export function compareLevels(track: SpeedrunLevel, main: SpeedrunLevel): -1 | 0 | 1 {
  const d = SPEEDRUN_LEVELS.indexOf(track) - SPEEDRUN_LEVELS.indexOf(main);
  return d < 0 ? -1 : d > 0 ? 1 : 0;
}
