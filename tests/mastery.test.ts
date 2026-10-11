import { describe, expect, it } from 'vitest';
import { availableStars, compareLevels, conjugationRating, courseRating, indexCards, isPerfect, nextStarOpensIn, itemCredit, lessonDue, lessonStars, levelProgress, toRating, vocabRating } from '../src/speedrun/mastery';
import { DAY, interleave, planLessonReview, planToday, startOfDay, type SrsCard } from '../src/speedrun/srs';
import { formKey, sprintPool, sprintRound, uniqueForms } from '../src/speedrun/sprint';
import { loadSpeedrun } from '../src/speedrun/content';
import { isVocabCard, planVocab, unlockedSets, vocab, vocabPattern, vocabStats } from '../src/speedrun/vocab';
import { checkAnswer } from '../src/speedrun/check';
import type { SpeedrunLesson } from '../src/speedrun/types';

const NOW = new Date(2026, 9, 11, 10, 0).getTime();
const today = startOfDay(NOW);
const lesson = (id: string, n: number): SpeedrunLesson =>
  ({ id, level: 'A2', title: id, goal: '', note: '', items: Array.from({ length: n }, (_, i) => [`es${i}`, `ca${i}`]) }) as SpeedrunLesson;
const card = (lessonId: string, index: number, step: number, due = today + 5 * DAY, lapses = 0): SrsCard => ({
  lessonId, index, step, due, lapses,
});

describe('stars and level progress', () => {
  const l = lesson('a2-01', 3);

  it('earns stars from the schedule, not from replaying', () => {
    expect(lessonStars(l, false, indexCards([]))).toBe(0);
    expect(lessonStars(l, true, indexCards([card('a2-01', 0, 4), card('a2-01', 1, 4)]))).toBe(1); // an item never enrolled
    expect(lessonStars(l, true, indexCards([0, 1, 2].map((i) => card('a2-01', i, 1))))).toBe(1);
    expect(lessonStars(l, true, indexCards([0, 1, 2].map((i) => card('a2-01', i, 2))))).toBe(2);
    expect(lessonStars(l, true, indexCards([0, 1, 2].map((i) => card('a2-01', i, i === 0 ? 2 : 4))))).toBe(2);
    expect(lessonStars(l, true, indexCards([0, 1, 2].map((i) => card('a2-01', i, 4))))).toBe(3);
  });

  it('fades: a miss drops the lesson back down', () => {
    const cs = [card('a2-01', 0, 4), card('a2-01', 1, 4), card('a2-01', 2, 0, today, 1)];
    expect(lessonStars(l, true, indexCards(cs))).toBe(1);
    expect(lessonDue(l, indexCards(cs), NOW)).toBe(1);
  });

  it('measures a level by what is held long-term', () => {
    expect(itemCredit(undefined)).toBe(0);
    expect(itemCredit(card('a2-01', 0, 0))).toBeCloseTo(0.2);
    expect(itemCredit(card('a2-01', 0, 5))).toBe(1);
    const lessons = [l, lesson('a2-02', 2)];
    expect(levelProgress(lessons, indexCards([]))).toBe(0);
    expect(levelProgress(lessons, indexCards([0, 1, 2].map((i) => card('a2-01', i, 4))))).toBeCloseTo(3 / 5);
  });
});

describe('review plans', () => {
  it('interleaves lessons so neighbours differ', () => {
    const cs = [card('a', 0, 0), card('a', 1, 0), card('a', 2, 0), card('b', 0, 0), card('c', 0, 0)];
    expect(interleave(cs).map((c) => c.lessonId).join('')).toBe('abcaa');
  });

  it('puts the weakest due items first in Today', () => {
    const cs = [card('a2-01', 0, 1, today - DAY), card('a2-02', 0, 0, today - DAY, 3), card('a2-03', 0, 0, today - 9 * DAY)];
    expect(planToday(cs, NOW, { mix: 0 }).due.map((c) => c.lessonId)).toEqual(['a2-02', 'a2-03', 'a2-01']);
  });

  it('targets one lesson: everything due, topped up with its weakest', () => {
    const cs = [card('a2-01', 0, 3, today - DAY), card('a2-01', 1, 4), card('a2-01', 2, 1), card('a2-01', 3, 1, today + 9 * DAY, 2)];
    const plan = planLessonReview(cs, NOW, 3);
    expect(plan.due.map((c) => c.index)).toEqual([0]);
    expect(plan.mix.map((c) => c.index)).toEqual([3, 2]);
  });
});

describe('vocab builder', () => {
  it('ships a frequency-ordered pack with no duplicates and keeps its own track', () => {
    expect(vocab.sets).toHaveLength(24);
    expect(vocab.sets.every((s) => s.words.length === 20)).toBe(true);
    for (const level of ['A2', 'B1', 'B2', 'C1'] as const) expect(vocab.sets.filter((s) => s.level === level)).toHaveLength(6);
    expect(isVocabCard(card('v03', 1, 0))).toBe(true);
    expect(isVocabCard(card('a2-03', 1, 0))).toBe(false);
  });

  it('accepts a noun with or without its article, but shows it with', () => {
    expect(vocabPattern('el cor')).toBe('[el cor|cor]');
    expect(vocabPattern("l'amor")).toBe("[l'amor|amor]");
    expect(vocabPattern('salvar')).toBe('salvar');
    expect(checkAnswer(vocabPattern('la paraula'), 'paraula').verdict).toBe('exact');
  });

  it('plans due words first, then new ones in order', () => {
    const plan = planVocab([card('v01', 4, 1, today - DAY)], NOW, { fresh: 3 });
    expect(plan.map((e) => `${e.lessonId}#${e.index}`)).toEqual(['v01#4', 'v01#0', 'v01#1', 'v01#2']);
    expect(vocabStats([card('v01', 4, 2), card('a2-01', 0, 4)], NOW, vocab, 'A2')).toMatchObject({ seen: 1, known: 1, total: 480, unlocked: 120 });
  });

  it('unlocks sets level by level, and only offers new words from open sets', () => {
    expect(unlockedSets('A2').map((s) => s.id)).toEqual(['v01', 'v02', 'v03', 'v04', 'v05', 'v06']);
    expect(unlockedSets('B2')).toHaveLength(18);
    const seenA2 = vocab.sets.filter((s) => s.level === 'A2').flatMap((s) => s.words.map((_, i) => card(s.id, i, 1)));
    expect(planVocab(seenA2, NOW, { maxLevel: 'A2' })).toEqual([]);
    expect(planVocab(seenA2, NOW, { maxLevel: 'B1', fresh: 2 }).map((e) => e.lessonId)).toEqual(['v07', 'v07']);
  });

  it('does not repeat any word the lessons already teach', () => {
    const taught = new Set<string>();
    for (const l of loadSpeedrun().lessons) {
      for (const [, ca] of l.items) for (const w of ca.toLowerCase().split(/[^a-zàèéíïòóúüç·]+/)) taught.add(w);
    }
    const heads = vocab.sets.flatMap((s) => s.words.map(([ca]) => ca.replace(/^(el|la|els|les) |^l'/, '').replace(/-se$/, '')));
    expect(heads.filter((h) => taught.has(h))).toEqual([]);
  });
});

describe('conjugation sprint', () => {
  const lessons = loadSpeedrun().lessons;

  it('turns reference tables into prompts, with every listed form accepted', () => {
    const pool = sprintPool(lessons.filter((l) => l.id === 'a2-01'));
    expect(pool.find((c) => c.prompt === 'nosaltres')).toMatchObject({ context: 'ser — present', answer: 'som' });
    const multi = sprintPool(lessons).find((c) => c.answer.includes(' / '));
    expect(multi && checkAnswer(multi.pattern, multi.answer.split(' / ')[1]!).verdict).toBe('exact');
  });

  it('labels multi-column tables with the column', () => {
    const pool = sprintPool(lessons.filter((l) => l.title.startsWith('-ar verbs')));
    expect(pool.find((c) => c.prompt === 'menjar · tu')?.answer).toBe('menges');
  });

  it('skips non-lookup tables and falls back to early lessons when little is finished', () => {
    expect(sprintPool(lessons).some((c) => c.context === 'conversions')).toBe(false);
    const round = sprintRound(lessons, new Set(), () => 0.3);
    expect(round.length).toBeGreaterThanOrEqual(30);
    expect(new Set(round.map((c) => `${c.context}|${c.prompt}`)).size).toBe(round.length);
  });
});

describe('ratings', () => {
  const content = loadSpeedrun();

  it('sits at the first level not yet 80% held', () => {
    expect(toRating({ A2: 0.5, B1: 0, B2: 0, C1: 0 })).toMatchObject({ level: 'A2', pct: 0.5 });
    expect(toRating({ A2: 0.85, B1: 0.3, B2: 0, C1: 0 })).toMatchObject({ level: 'B1', pct: 0.3 });
    expect(toRating({ A2: 1, B1: 1, B2: 1, C1: 0.9 })).toMatchObject({ level: 'C1', pct: 0.9 });
    expect(compareLevels('A2', 'B1')).toBe(-1);
    expect(compareLevels('B1', 'B1')).toBe(0);
  });

  it('rates conjugation by the forms in each level, two right in a row for full credit', () => {
    expect(conjugationRating(content.byLevel, {})).toMatchObject({ level: 'A2', pct: 0 });
    const a2 = uniqueForms(sprintPool(content.byLevel.A2));
    const half = conjugationRating(content.byLevel, Object.fromEntries(a2.map((c) => [c.key, 1])));
    expect(half.byLevel.A2).toBeCloseTo(0.5);
    const all = conjugationRating(content.byLevel, Object.fromEntries(a2.map((c) => [c.key, 2])));
    expect(all.byLevel.A2).toBe(1);
    expect(all.level).toBe('B1');
  });

  it('weights the whole-course figure by each level\'s size', () => {
    expect(toRating({ A2: 1, B1: 0, B2: 0, C1: 0 }, { A2: 1, B1: 3, B2: 0, C1: 0 }).overall).toBeCloseTo(0.25);
    const a2 = content.byLevel.A2.flatMap((l) => l.items.map((_, i) => card(l.id, i, 4)));
    const course = courseRating(content.byLevel, indexCards(a2));
    const items = (lv: 'A2' | 'B1' | 'B2' | 'C1') => content.byLevel[lv].reduce((n, l) => n + l.items.length, 0);
    expect(course).toMatchObject({ level: 'B1', pct: 0 });
    expect(course.overall).toBeCloseTo(items('A2') / (items('A2') + items('B1') + items('B2') + items('C1')));
  });

  it('rates vocab per level with the lesson credit rule', () => {
    const a2 = vocab.sets.filter((s) => s.level === 'A2').flatMap((s) => s.words.map((_, i) => card(s.id, i, 4)));
    expect(vocabRating(indexCards(a2), vocab)).toMatchObject({ level: 'B1', pct: 0 });
  });

  it('keys forms stably and compactly', () => {
    expect(formKey('ser — present', 'jo')).toBe(formKey('ser — present', 'jo'));
    expect(formKey('ser — present', 'jo')).not.toBe(formKey('ser — present', 'tu'));
    expect(formKey('ser — present', 'jo')).toMatch(/^[a-z0-9]{1,7}$/);
  });

  it('serves forms not yet known first in a sprint', () => {
    const pool = uniqueForms(sprintPool(content.lessons.slice(0, 6)));
    const known = Object.fromEntries(pool.slice(0, pool.length - 5).map((c) => [c.key, 2]));
    const round = sprintRound(content.lessons.slice(0, 6), new Set(content.lessons.slice(0, 6).map((l) => l.id)), () => 0.4, known);
    expect(round.slice(0, 5).every((c) => !known[c.key])).toBe(true);
  });
});

describe('stars open over time', () => {
  const l = lesson('a2-01', 2);
  const at = (days: number) => today - days * DAY;

  it('offers one star until the ladder could reach a week, then two, then three', () => {
    const cs = indexCards([card('a2-01', 0, 0), card('a2-01', 1, 0)]);
    expect(availableStars(l, undefined, cs, NOW)).toBe(1); // not finished: finishing is open
    expect(availableStars(l, { firstAt: at(1) }, cs, NOW)).toBe(1);
    expect(nextStarOpensIn(l, { firstAt: at(1) }, cs, NOW)).toBe(3);
    expect(availableStars(l, { firstAt: at(4) }, cs, NOW)).toBe(2);
    expect(nextStarOpensIn(l, { firstAt: at(4) }, cs, NOW)).toBe(21);
    expect(availableStars(l, { firstAt: at(25) }, cs, NOW)).toBe(3);
    expect(nextStarOpensIn(l, { firstAt: at(25) }, cs, NOW)).toBeNull();
  });

  it('estimates the start for older records from the cards, and never shows fewer than held', () => {
    // Step 2 means at least 4 days since learning, so two stars are open.
    const cs = indexCards([{ ...card('a2-01', 0, 2), last: at(0) }, { ...card('a2-01', 1, 2), last: at(0) }]);
    expect(availableStars(l, {}, cs, NOW)).toBe(2);
    expect(availableStars(l, { firstAt: NOW }, indexCards([card('a2-01', 0, 4), card('a2-01', 1, 4)]), NOW)).toBe(3);
  });

  it('marks a perfect run from the best score', () => {
    expect(isPerfect({ bestScore: 1 })).toBe(true);
    expect(isPerfect({ bestScore: 0.92 })).toBe(false);
    expect(isPerfect(undefined)).toBe(false);
  });
});
