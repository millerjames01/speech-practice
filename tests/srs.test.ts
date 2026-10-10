import { beforeEach, describe, expect, it } from 'vitest';
import { DAY, INTERVALS, enroll, planToday, review, startOfDay, type SrsCard } from '../src/speedrun/srs';

const NOW = new Date(2026, 9, 10, 21, 0).getTime(); // 21:00, to test day boundaries
const today = startOfDay(NOW);

describe('scheduling', () => {
  it('enrolls new items at the bottom, due tomorrow morning', () => {
    const c = enroll('a2-01', 0, true, NOW);
    expect(c.step).toBe(0);
    expect(c.due).toBe(today + DAY);
    expect(enroll('a2-01', 1, false, NOW).lapses).toBe(1);
  });

  it('climbs one step per hit, capped at the top interval', () => {
    let c = enroll('a2-01', 0, true, NOW);
    const steps: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      c = review(c, true, NOW);
      steps.push(c.step);
    }
    expect(steps).toEqual([1, 2, 3, 4, 5, 5, 5, 5]);
    expect(c.due).toBe(today + INTERVALS[5]! * DAY);
  });

  it('drops to the bottom on a miss and counts the lapse', () => {
    const c = review({ lessonId: 'b1-04', index: 2, step: 4, due: 0, lapses: 0 }, false, NOW);
    expect(c).toMatchObject({ step: 0, lapses: 1, due: today + DAY });
  });
});

describe('planToday', () => {
  const card = (index: number, due: number, step = 0): SrsCard => ({ lessonId: 'a2-05', index, step, due, lapses: 0 });

  it('takes due cards most overdue first, and caps them', () => {
    const cards = [card(0, today - 2 * DAY), card(1, today - 5 * DAY), card(2, today)];
    const plan = planToday(cards, NOW, { maxDue: 2, mix: 0 });
    expect(plan.due.map((c) => c.index)).toEqual([1, 0]);
    expect(plan.overflow).toBe(1);
  });

  it('mixes in not-yet-due cards from the lowest steps', () => {
    const cards = [card(0, today + 9 * DAY, 4), card(1, today + 3 * DAY, 1), card(2, today + DAY, 0), card(3, today - DAY)];
    const plan = planToday(cards, NOW, { mix: 2, random: () => 0.5 });
    expect(plan.due.map((c) => c.index)).toEqual([3]);
    expect(plan.mix.map((c) => c.step)).toEqual([0, 1]);
  });
});

describe('recordAnswer', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });

  it('enrolls in lessons, does not push schedules on lesson re-runs, and reviews in Today', async () => {
    const { recordAnswer, allCards } = await import('../src/speedrun/progress');
    recordAnswer('a2-01', 0, true, 'lesson', NOW);
    recordAnswer('a2-01', 0, true, 'lesson', NOW); // re-run for speed: no change
    expect(allCards()[0]!.step).toBe(0);
    recordAnswer('a2-01', 0, true, 'review', NOW);
    expect(allCards()[0]!.step).toBe(1);
    recordAnswer('a2-01', 0, false, 'lesson', NOW); // a miss anywhere sends it back
    expect(allCards()[0]).toMatchObject({ step: 0, lapses: 1 });
  });

  it('migrates the old missed-items list into due cards', async () => {
    store.set('sr.progress.v1', JSON.stringify({ missed: { 'b1-02#3': { lessonId: 'b1-02', index: 3, count: 2, last: 1 } } }));
    const { allCards, cardStats } = await import('../src/speedrun/progress');
    expect(allCards()).toEqual([{ lessonId: 'b1-02', index: 3, step: 0, due: 0, lapses: 2 }]);
    expect(cardStats(NOW).due).toBe(1);
  });
});
