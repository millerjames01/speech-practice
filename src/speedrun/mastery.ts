/**
 * Progress views derived from the review schedule. Nothing here is stored:
 * stars, level percentages and due counts are all read off the item cards,
 * so every practice mode feeds one source of truth.
 */

import { FORM_KNOWN, sprintPool, uniqueForms } from './sprint';
import { isDue, type SrsCard } from './srs';
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
}

export function toRating(byLevel: Record<SpeedrunLevel, number>): Rating {
  for (const level of SPEEDRUN_LEVELS) if (byLevel[level] < RATING_PASS) return { level, pct: byLevel[level], byLevel };
  const top = SPEEDRUN_LEVELS[SPEEDRUN_LEVELS.length - 1]!;
  return { level: top, pct: byLevel[top], byLevel };
}

const perLevel = (f: (level: SpeedrunLevel) => number) =>
  Object.fromEntries(SPEEDRUN_LEVELS.map((l) => [l, f(l)])) as Record<SpeedrunLevel, number>;

/** Conjugation: the forms in each level's tables, a form fully credited after two right answers in a row. */
export function conjugationRating(byLevel: Record<SpeedrunLevel, SpeedrunLesson[]>, forms: Record<string, number>): Rating {
  return toRating(
    perLevel((level) => {
      const pool = uniqueForms(sprintPool(byLevel[level]));
      if (pool.length === 0) return 0;
      return pool.reduce((n, c) => n + Math.min(1, (forms[c.key] ?? 0) / FORM_KNOWN), 0) / pool.length;
    }),
  );
}

/** Vocab: each level's words, credited the same way as lesson items. */
export function vocabRating(cards: CardIndex, pack: VocabPack): Rating {
  return toRating(
    perLevel((level) => {
      const words = pack.sets.filter((s) => s.level === level).flatMap((s) => s.words.map((_, i) => cards.get(`${s.id}#${i}`)));
      return words.length ? words.reduce((n, c) => n + itemCredit(c), 0) / words.length : 0;
    }),
  );
}

/** Where a side track stands against the main level: -1 behind, 0 level, 1 ahead. */
export function compareLevels(track: SpeedrunLevel, main: SpeedrunLevel): -1 | 0 | 1 {
  const d = SPEEDRUN_LEVELS.indexOf(track) - SPEEDRUN_LEVELS.indexOf(main);
  return d < 0 ? -1 : d > 0 ? 1 : 0;
}
