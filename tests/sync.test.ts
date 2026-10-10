import { describe, expect, it } from 'vitest';
import { DAY, enroll, review, startOfDay, type SrsCard } from '../src/speedrun/srs';
import { decodeSync, encodeSync, extractCode, mergeLessons, newerCard } from '../src/speedrun/sync';

const NOW = new Date(2026, 9, 10, 21, 30).getTime();

describe('sync codes', () => {
  it('round-trips lessons and cards (times rounded to days, best times to seconds)', async () => {
    const card = review(enroll('b1-04', 7, true, NOW - 3 * DAY), true, NOW);
    const code = await encodeSync({ 'a2-01': { bestMs: 61_400, bestScore: 0.917, runs: 3 } }, [card], NOW);
    expect(code).toMatch(/^ca1\.[A-Za-z0-9_-]+$/);

    const back = await decodeSync(`https://example.com/speech-practice/#sync=${code}`);
    expect(back.createdAt).toBe(startOfDay(NOW));
    expect(back.lessons['a2-01']).toEqual({ bestMs: 61_000, bestScore: 0.92, runs: 3 });
    expect(back.cards).toEqual([{ ...card, last: startOfDay(NOW) + 21 * 3_600_000 }]);
  });

  it('keeps a whole completed course short enough for a link', async () => {
    const cards: SrsCard[] = [];
    for (let l = 1; l <= 103; l += 1) {
      for (let i = 0; i < 12; i += 1) {
        cards.push(review(enroll(`a2-${String(l).padStart(2, '0')}`, i, true, NOW - 9 * DAY), i % 3 !== 0, NOW - (i % 5) * DAY));
      }
    }
    const code = await encodeSync({}, cards, NOW);
    expect(code.length).toBeLessThan(12_000);
    expect((await decodeSync(code)).cards).toHaveLength(cards.length);
  });

  it('finds the code inside whatever was pasted', () => {
    expect(extractCode('look: https://x.io/#sync=ca1.AbC_-9 thanks')).toBe('ca1.AbC_-9');
    expect(extractCode('nothing here')).toBeNull();
  });

  it('rejects damaged or foreign input with a readable error', async () => {
    await expect(decodeSync('hello')).rejects.toThrow(/not a Speedrun sync/);
    const code = await encodeSync({}, [enroll('a2-01', 0, true, NOW)], NOW);
    await expect(decodeSync(code.slice(0, code.length - 6))).rejects.toThrow(/incomplete or damaged/);
  });
});

describe('merging', () => {
  it('prefers the most recently answered state of a card', () => {
    const phone = review(enroll('a2-01', 0, true, NOW - 5 * DAY), true, NOW - 2 * DAY);
    const pc = review(phone, false, NOW);
    expect(newerCard(phone, pc)).toBe(pc);
    expect(newerCard(pc, phone)).toBe(pc);
  });

  it('falls back to the furthest schedule for cards without timestamps', () => {
    const a: SrsCard = { lessonId: 'a2-01', index: 0, step: 1, due: NOW + 3 * DAY, lapses: 0 };
    const b: SrsCard = { ...a, step: 3, due: NOW + 14 * DAY };
    expect(newerCard(a, b)).toBe(b);
  });

  it('keeps the best of both lesson records', () => {
    expect(mergeLessons({ bestMs: 90_000, bestScore: 1, runs: 2 }, { bestMs: 70_000, bestScore: 0.8, runs: 5 })).toEqual({
      bestMs: 70_000,
      bestScore: 1,
      runs: 5,
    });
  });

  it('converges: syncing both ways leaves both devices identical', async () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    const { mergeProgress, allCards, allLessonRecords, resetProgress, recordAnswer, recordLesson } = await import(
      '../src/speedrun/progress'
    );
    const snapshot = () => ({ lessons: allLessonRecords(), cards: allCards() });

    // Device A
    resetProgress();
    recordLesson('a2-01', 80_000, 0.9);
    recordAnswer('a2-01', 0, true, 'lesson', NOW - 2 * DAY);
    recordAnswer('a2-01', 1, true, 'lesson', NOW - 2 * DAY);
    const a = snapshot();
    // Device B: same lesson earlier, plus a newer miss on item 1 and a new lesson
    resetProgress();
    recordLesson('a2-01', 95_000, 1);
    recordAnswer('a2-01', 1, true, 'lesson', NOW - 4 * DAY);
    recordAnswer('a2-01', 1, false, 'review', NOW - DAY);
    recordLesson('a2-02', 60_000, 0.8);
    recordAnswer('a2-02', 0, true, 'lesson', NOW - DAY);
    const b = snapshot();

    // B receives A, then A receives B's merged state.
    mergeProgress(a);
    const bMerged = snapshot();
    resetProgress();
    mergeProgress(a);
    mergeProgress(bMerged);
    const aMerged = snapshot();

    const sortCards = (cs: SrsCard[]) => [...cs].sort((x, y) => `${x.lessonId}#${x.index}`.localeCompare(`${y.lessonId}#${y.index}`));
    expect(aMerged.lessons).toEqual(bMerged.lessons);
    expect(sortCards(aMerged.cards)).toEqual(sortCards(bMerged.cards));
    expect(bMerged.lessons['a2-01']).toEqual({ bestMs: 80_000, bestScore: 1, runs: 1 });
    expect(bMerged.cards.find((c) => c.lessonId === 'a2-01' && c.index === 1)).toMatchObject({ step: 0, lapses: 1 });
    expect(b.cards).toHaveLength(2);
  });
});
