/**
 * Progress views derived from the review schedule. Nothing here is stored:
 * grades, level percentages and due counts are all read off the item cards
 * and verb-form streaks, so every practice mode feeds one source of truth.
 */

import { FORM_REST_MINUTES, conjugationPool, type SprintCard } from './sprint';
import { isDue, type SrsCard } from './srs';
import { SPEEDRUN_LEVELS, type SpeedrunLesson, type SpeedrunLevel } from './types';
import type { VocabPack } from './vocab';

/** Lesson items, as opposed to vocab-builder words, which live on their own track. */
export const isLessonCard = (c: SrsCard): boolean => /^(a2|b1|b2|c1)-\d{2}$/.test(c.lessonId);

export type CardIndex = Map<string, SrsCard>;

export function indexCards(cards: SrsCard[]): CardIndex {
  return new Map(cards.map((c) => [`${c.lessonId}#${c.index}`, c]));
}

const lessonCards = (lesson: SpeedrunLesson, cards: CardIndex): (SrsCard | undefined)[] =>
  lesson.items.map((_, i) => cards.get(`${lesson.id}#${i}`));

/* ---------- grades ----------
 * Every item is in one of four grades once met: hardened, settling, new, or
 * fading (due for review now). Lessons, vocab and verb forms all use them, so
 * one bar shape works everywhere: strongest on the left, then the space not
 * yet met.
 */

export const GRADES = ['hard', 'settling', 'new', 'fading'] as const;
export type Grade = (typeof GRADES)[number];

export const GRADE_INFO: Record<Grade, { label: string; rule: string }> = {
  hard: { label: 'Hardened', rule: 'Recalled after a week or more' },
  settling: { label: 'Settling', rule: 'Recalled after a day or more' },
  new: { label: 'New', rule: 'Learned, not yet recalled after a gap' },
  fading: { label: 'Fading', rule: 'Due for review now' },
};

/** Verb forms rest less than phrases between steps, so their grades have their own rules. */
export const FORM_GRADE_RULES: Record<Grade, string> = {
  hard: 'Right again after 4 days or more',
  settling: 'Right again after a day',
  new: 'Answered, not yet right again after a rest',
  fading: 'Missed, or due again now',
};

/** Review card: due now is fading; otherwise by step (step 3 = survived a week's gap). */
export function cardGrade(card: SrsCard, now: number): Grade {
  if (isDue(card, now)) return 'fading';
  if (card.step >= 3) return 'hard';
  if (card.step >= 1) return 'settling';
  return 'new';
}

/** Verb form by streak: missed or rested long enough is fading; 3+ in a row (after a 4-day rest) hardened. */
export function formGrade(streak: number | undefined, seenMinute: number | undefined, now: number): Grade | null {
  if (streak === undefined) return null;
  if (streak === 0) return 'fading';
  const rest = FORM_REST_MINUTES[Math.min(streak, FORM_REST_MINUTES.length - 1)]!;
  if (seenMinute !== undefined && Math.floor(now / 60_000) - seenMinute >= rest) return 'fading';
  if (streak >= 3) return 'hard';
  if (streak >= 2) return 'settling';
  return 'new';
}

export interface Tally {
  hard: number;
  settling: number;
  new: number;
  fading: number;
  /** Everything at this scope, met or not. */
  total: number;
}

export const emptyTally = (): Tally => ({ hard: 0, settling: 0, new: 0, fading: 0, total: 0 });

export const met = (t: Tally): number => t.hard + t.settling + t.new + t.fading;

export function addTallies(...ts: Tally[]): Tally {
  const out = emptyTally();
  for (const t of ts) {
    out.hard += t.hard;
    out.settling += t.settling;
    out.new += t.new;
    out.fading += t.fading;
    out.total += t.total;
  }
  return out;
}

export function tallyCards(items: (SrsCard | undefined)[], now: number): Tally {
  const t = emptyTally();
  t.total = items.length;
  for (const c of items) if (c) t[cardGrade(c, now)] += 1;
  return t;
}

export function tallyForms(cards: SprintCard[], forms: Record<string, number>, seen: Record<string, number>, now: number): Tally {
  const t = emptyTally();
  t.total = cards.length;
  for (const c of cards) {
    const g = formGrade(forms[c.key], seen[c.key], now);
    if (g) t[g] += 1;
  }
  return t;
}

export const tallyLessons = (lessons: SpeedrunLesson[], cards: CardIndex, now: number): Tally =>
  tallyCards(lessons.flatMap((l) => lessonCards(l, cards)), now);

export const tallySets = (sets: VocabPack['sets'], cards: CardIndex, now: number): Tally =>
  tallyCards(sets.flatMap((s) => s.words.map((_, i) => cards.get(`${s.id}#${i}`))), now);

/** What each grade is worth toward a level: hardened in full; fading still counts as met. */
const GRADE_CREDIT: Record<Grade, number> = { hard: 1, settling: 0.6, new: 0.3, fading: 0.3 };

/** How much of a scope is held, 0-1. */
export const heldShare = (t: Tally): number => (t.total ? GRADES.reduce((n, g) => n + t[g] * GRADE_CREDIT[g], 0) / t.total : 0);

/** A perfect run: every item right on the first try, at least once. */
export const isPerfect = (record: { bestScore: number } | undefined): boolean => !!record && record.bestScore >= 1;

export function lessonDue(lesson: SpeedrunLesson, cards: CardIndex, now: number): number {
  return lessonCards(lesson, cards).filter((c) => c && isDue(c, now)).length;
}

/* ---------- ratings ----------
 * Three strands, each rated on the same A2-C1 scale: Structures (lessons),
 * Words (vocab) and Forms (conjugation). A strand sits at the first level not
 * yet RATING_PASS-held; the learner's level is the lowest of the three.
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

/** Forms: each level's verb forms (a form's level is the higher of its verb's and its tense's). */
export function formsRating(forms: Record<string, number>, seen: Record<string, number>, now: number, pool: SprintCard[] = conjugationPool()): Rating {
  const byLevel = perLevelList((level) => tallyForms(pool.filter((c) => c.level === level), forms, seen, now));
  return toRating(perLevel((level) => heldShare(byLevel[level])), perLevel((level) => byLevel[level].total));
}

/** Words: each level's vocab sets. */
export function wordsRating(cards: CardIndex, pack: VocabPack, now: number): Rating {
  const byLevel = perLevelList((level) => tallySets(pack.sets.filter((s) => s.level === level), cards, now));
  return toRating(perLevel((level) => heldShare(byLevel[level])), perLevel((level) => byLevel[level].total));
}

/** Structures: each level's lessons. */
export function structuresRating(byLevel: Record<SpeedrunLevel, SpeedrunLesson[]>, cards: CardIndex, now: number): Rating {
  const tallies = perLevelList((level) => tallyLessons(byLevel[level], cards, now));
  return toRating(perLevel((level) => heldShare(tallies[level])), perLevel((level) => tallies[level].total));
}

/** Where a side track stands against the main level: -1 behind, 0 level, 1 ahead. */
export function compareLevels(track: SpeedrunLevel, main: SpeedrunLevel): -1 | 0 | 1 {
  const d = SPEEDRUN_LEVELS.indexOf(track) - SPEEDRUN_LEVELS.indexOf(main);
  return d < 0 ? -1 : d > 0 ? 1 : 0;
}
