/**
 * What older progress needs to fit the current content. The storage layer
 * (progress.ts) applies the plan; this module knows the content: the lessons'
 * tables the first sprint drilled, the translation sprint's forms, and the
 * first vocab pack.
 */

import legacyVocab from '../../speedrun/vocab/legacy-v1.json';
import { indexCards } from './mastery';
import { expand } from './pattern';
import type { LessonRecord, MigrationPlan } from './progress';
import { conjugationPool, legacyTablePool, type SprintCard } from './sprint';
import type { SrsCard } from './srs';
import type { SpeedrunLesson } from './types';
import { vocab, type VocabPack } from './vocab';

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Every accepted answer of every current form → the forms' keys. */
function answerIndex(pool: SprintCard[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const c of pool) {
    for (const a of expand(c.pattern)) {
      const k = norm(a);
      const list = out.get(k) ?? [];
      if (!list.includes(c.key)) list.push(c.key);
      out.set(k, list);
    }
  }
  return out;
}

/** A table cell may list several forms ("he de / haig de"). */
const cellForms = (answer: string) => answer.split(/\s*\/\s*|,\s+/).filter(Boolean);

export function buildMigrationPlan(
  lessons: SpeedrunLesson[],
  records: Record<string, LessonRecord>,
  cards: SrsCard[],
  pool: SprintCard[] = conjugationPool(),
  pack: VocabPack = vocab,
  legacy: { sets: Record<string, string[]> } = legacyVocab,
): MigrationPlan {
  const byAnswer = answerIndex(pool);
  const current = new Set(pool.map((c) => c.key));
  const legacyForms = new Map(legacyTablePool(lessons).map((c) => [c.key, c.answer]));
  const keysFor = (answer: string) => cellForms(answer).flatMap((a) => byAnswer.get(norm(a)) ?? []);

  const index = indexCards(cards);
  // Lessons held a week or more (every item at step 2+) seed their forms.
  const held = new Set(
    lessons.filter((l) => !!records[l.id] && l.items.every((_, i) => (index.get(`${l.id}#${i}`)?.step ?? -1) >= 2)).map((l) => l.id),
  );
  const seedForms = [
    ...new Set(legacyTablePool(lessons.filter((l) => held.has(l.id))).flatMap((c) => keysFor(c.answer))),
  ];

  const wordAt = new Map<string, { id: string; index: number }>();
  for (const set of pack.sets) set.words.forEach(([ca], i) => wordAt.set(ca, { id: set.id, index: i }));

  return {
    seedForms,
    mapForms: (old) => {
      const out: Record<string, number> = {};
      const raise = (k: string, n: number) => {
        out[k] = Math.max(out[k] ?? 0, n);
      };
      for (const [k, n] of Object.entries(old)) {
        if (current.has(k)) raise(k, n);
        else {
          const answer = legacyForms.get(k);
          if (answer) for (const nk of keysFor(answer)) raise(nk, n);
        }
      }
      return out;
    },
    mapCard: (card) => {
      if (!/^v\d{2}$/.test(card.lessonId)) return card;
      const word = legacy.sets[card.lessonId]?.[card.index];
      const to = word ? wordAt.get(word) : undefined;
      return to ? { ...card, lessonId: to.id, index: to.index } : null;
    },
  };
}
