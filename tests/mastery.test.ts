import { describe, expect, it } from 'vitest';
import { availableStars, compareLevels, conjugationRating, courseRating, indexCards, isPerfect, nextStarOpensIn, itemCredit, lessonDue, lessonStars, levelProgress, toRating, vocabRating } from '../src/speedrun/mastery';
import { DAY, interleave, planLessonReview, planToday, startOfDay, type SrsCard } from '../src/speedrun/srs';
import { conjugation, conjugationPool, formKey, openTenses, sprintQueue, sprintRound } from '../src/speedrun/sprint';
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
  it('ships topic sets per level, no duplicates, no verbs, on its own track', () => {
    const perLevel = { A2: 20, B1: 25, B2: 25, C1: 30 } as const;
    expect(vocab.sets).toHaveLength(100);
    expect(vocab.sets.every((s) => s.words.length === 20)).toBe(true);
    for (const [level, n] of Object.entries(perLevel)) expect(vocab.sets.filter((s) => s.level === level)).toHaveLength(n);
    const sprintVerbs = new Set(conjugation.verbs.map((v) => v.ca));
    expect(vocab.sets.flatMap((s) => s.words.map(([ca]) => ca)).filter((ca) => sprintVerbs.has(ca) || / -?se$|-se$/.test(ca))).toEqual([]);
    expect(isVocabCard(card('w003', 1, 0))).toBe(true);
    expect(isVocabCard(card('v03', 1, 0))).toBe(false);
    expect(isVocabCard(card('a2-03', 1, 0))).toBe(false);
  });

  it('accepts a noun with or without its article, but shows it with', () => {
    expect(vocabPattern('el cor')).toBe('[el cor|cor]');
    expect(vocabPattern("l'amor")).toBe("[l'amor|amor]");
    expect(vocabPattern('salvar')).toBe('salvar');
    expect(checkAnswer(vocabPattern('la paraula'), 'paraula').verdict).toBe('exact');
  });

  it('plans due words first, then new ones in order', () => {
    const plan = planVocab([card('w001', 4, 1, today - DAY)], NOW, { size: 4 });
    expect(planVocab([], NOW)).toHaveLength(20);
    expect(plan.map((e) => `${e.lessonId}#${e.index}`)).toEqual(['w001#4', 'w001#0', 'w001#1', 'w001#2']);
    expect(vocabStats([card('w001', 4, 2), card('a2-01', 0, 4)], NOW, vocab, 'A2')).toMatchObject({ seen: 1, known: 1, total: 2000, unlocked: 400 });
  });

  it('unlocks sets level by level, and only offers new words from open sets', () => {
    expect(unlockedSets('A2').map((s) => s.id)).toEqual(Array.from({ length: 20 }, (_, i) => `w${String(i + 1).padStart(3, '0')}`));
    expect(unlockedSets('B2')).toHaveLength(70);
    const seenA2 = vocab.sets.filter((s) => s.level === 'A2').flatMap((s) => s.words.map((_, i) => card(s.id, i, 1)));
    expect(planVocab(seenA2, NOW, { maxLevel: 'A2' })).toEqual([]);
    expect(planVocab(seenA2, NOW, { maxLevel: 'B1', size: 2 }).map((e) => e.lessonId)).toEqual(['w021', 'w021']);
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
  const pool = conjugationPool();
  const find = (context: string, prompt: string) => pool.find((c) => c.context === context && c.prompt === prompt);

  it('translates Castellano forms into Catalan across 45 verbs and 12 tenses', () => {
    expect(conjugation.verbs).toHaveLength(45);
    expect(conjugation.tenses).toHaveLength(12);
    expect(pool.length).toBe(3060);
    expect(new Set(pool.map((c) => c.key)).size).toBe(pool.length);
    expect(find('tenir · present', 'nosotros tenemos')).toMatchObject({ answer: 'tenim', level: 'A2' });
    expect(find('anar · present', 'nosotros vamos')?.answer).toBe('anem');
    expect(find('anar · passat', 'nosotros fuimos')?.answer).toBe('vam anar');
  });

  it('accepts every standard variant, a subject pronoun, and que in the subjunctive', () => {
    const past = find('fer · passat', 'yo hice')!;
    for (const a of ['vaig fer', 'fiu', 'jo vaig fer']) expect(checkAnswer(past.pattern, a).verdict).toBe('exact');
    const subj = find('ser · subjuntiu present', 'que nosotros seamos')!;
    for (const a of ['siguem', 'que siguem']) expect(checkAnswer(subj.pattern, a).verdict).toBe('exact');
    const imper = find('tenir · imperatiu', '¡ten! (tú)')!;
    expect(imper.answer).toBe('tingues');
    expect(checkAnswer(imper.pattern, 'té').verdict).toBe('exact');
  });

  it('opens tenses with the lessons that teach them', () => {
    expect([...openTenses(new Set())]).toEqual(['pres']);
    expect([...openTenses(new Set(['a2-21', 'b1-14']))]).toEqual(['pres', 'perif', 'subj']);
    const round = sprintRound(new Set(), {}, {}, NOW);
    expect(round.every((c) => c.tense === 'pres')).toBe(true);
    expect(round).toHaveLength(45 * 6);
  });

  it('drills verbs from their level on, and counts each form at the higher of verb and tense', () => {
    const a2 = sprintRound(new Set(), {}, {}, NOW, { maxLevel: 'A2' });
    expect(new Set(a2.map((c) => c.verb)).size).toBe(19);
    expect(conjugation.verbs.filter((v) => v.level === 'A2')).toHaveLength(19);
    expect(pool.filter((c) => c.level === 'A2')).toHaveLength(19 * 32);
    expect(find('donar · present', 'yo doy')?.level).toBe('B1');
    expect(find('tenir · condicional', 'yo tendría')?.level).toBe('B1');
    expect(find('caure · present', 'yo caigo')?.level).toBe('C1');
  });

  it('mixes new forms from the five most common verbs, across tenses, never the same verb twice running', () => {
    // Seeded, so the test does not depend on luck.
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const round = sprintRound(new Set(['a2-21', 'a2-23']), {}, {}, NOW, { maxLevel: 'A2', random });
    const first = round.slice(0, 20);
    expect(new Set(first.map((c) => c.verb))).toEqual(new Set(['ser', 'estar', 'tenir', 'fer', 'anar']));
    expect(new Set(first.map((c) => c.tense)).size).toBe(3);
    // Far beyond a 60-second round, the same verb never comes twice running.
    const head = round.slice(0, 100);
    expect(head.every((c, i) => i === 0 || c.verb !== head[i - 1]!.verb)).toBe(true);
    // Once a verb's forms are all seen, the next most common verb joins.
    const ser = round.filter((c) => c.verb === 'ser').map((c) => c.key);
    expect(ser).toHaveLength(18);
    const seen = Object.fromEntries(ser.map((k) => [k, Math.floor(NOW / 60_000)]));
    const forms = Object.fromEntries(ser.map((k) => [k, 2]));
    const next = sprintRound(new Set(['a2-21', 'a2-23']), forms, seen, NOW, { maxLevel: 'A2' }).slice(0, 20);
    expect(new Set(next.map((c) => c.verb))).toEqual(new Set(['estar', 'tenir', 'fer', 'anar', 'venir']));
  });

  it('mixes due reviews in among new forms', () => {
    const pres = pool.filter((c) => c.tense === 'pres' && c.verb === 'parlar');
    const forms = Object.fromEntries(pres.map((c) => [c.key, 1]));
    const round = sprintRound(new Set(), forms, {}, NOW, { maxLevel: 'A2' });
    const at = round.map((c, i) => (forms[c.key] ? i : -1)).filter((i) => i >= 0);
    expect(at).toHaveLength(6);
    expect(at[0]).toBeGreaterThan(0);
    expect(at.at(-1)).toBeLessThan(25);
  });

  it('brings misses straight back but rests right answers, so the next round is new', () => {
    const minute = Math.floor(NOW / 60_000);
    const first = sprintRound(new Set(), {}, {}, NOW).slice(0, 14);
    const forms: Record<string, number> = {};
    const seen: Record<string, number> = {};
    first.forEach((c, i) => {
      forms[c.key] = i === 3 ? 0 : 1;
      seen[c.key] = minute;
    });
    const next = sprintRound(new Set(), forms, seen, NOW + 60_000).slice(0, 14);
    expect(next[0]?.key).toBe(first[3]?.key);
    expect(next.slice(1).filter((c) => first.some((f) => f.key === c.key))).toEqual([]);
    // A day later the right answers are due for review, ahead of new forms.
    const later = sprintQueue(new Set(), forms, seen, NOW + 25 * 3_600_000);
    expect(later.review).toHaveLength(13);
    expect(later.missed).toHaveLength(1);
  });

  it('keys forms stably and compactly', () => {
    expect(formKey('tenir|pres', '3')).toBe(formKey('tenir|pres', '3'));
    expect(formKey('tenir|pres', '3')).toMatch(/^[a-z0-9]{1,7}$/);
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

  it('rates conjugation by each level\'s tenses, two right in a row for full credit', () => {
    const pool = conjugationPool();
    expect(conjugationRating({})).toMatchObject({ level: 'A2', pct: 0 });
    const a2 = pool.filter((c) => c.level === 'A2');
    expect(conjugationRating(Object.fromEntries(a2.map((c) => [c.key, 1]))).byLevel.A2).toBeCloseTo(0.5);
    const all = conjugationRating(Object.fromEntries(a2.map((c) => [c.key, 2])));
    expect(all).toMatchObject({ level: 'B1', pct: 0 });
    expect(all.overall).toBeCloseTo(a2.length / pool.length);
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
