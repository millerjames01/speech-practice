/**
 * Spaced repetition for Speedrun items, kept pure so it can be tested.
 *
 * Deliberately simple (a Leitner ladder, no ease factors): an item climbs one
 * step per first-try hit and drops to the bottom on a miss. Intervals are in
 * whole days from the start of today, so an item learned at 21:00 is due
 * tomorrow morning, not tomorrow at 21:00.
 */

export const DAY = 86_400_000;

/** Days until the next review, per step. */
export const INTERVALS = [1, 3, 7, 14, 30, 60];

/** Items at or above this step (two weeks and up) count as long-term. */
export const LONG_TERM_STEP = 3;

export interface SrsCard {
  lessonId: string;
  index: number;
  step: number;
  /** Epoch ms when the card is next due. */
  due: number;
  lapses: number;
  /** Epoch ms of the last answer; lets two devices' progress merge newest-first. */
  last?: number;
}

export function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const dueIn = (days: number, now: number): number => startOfDay(now) + days * DAY;

/** First sighting of an item, in a lesson: it enters the ladder at the bottom. */
export function enroll(lessonId: string, index: number, correct: boolean, now: number): SrsCard {
  return { lessonId, index, step: 0, due: dueIn(INTERVALS[0]!, now), lapses: correct ? 0 : 1, last: now };
}

/** A first-try answer in review: climb one step, or drop to the bottom. */
export function review(card: SrsCard, correct: boolean, now: number): SrsCard {
  if (!correct) return { ...card, step: 0, due: dueIn(INTERVALS[0]!, now), lapses: card.lapses + 1, last: now };
  const step = Math.min(card.step + 1, INTERVALS.length - 1);
  return { ...card, step, due: dueIn(INTERVALS[step]!, now), last: now };
}

export const isDue = (card: SrsCard, now: number): boolean => card.due <= now;

export interface TodayPlan {
  due: SrsCard[];
  mix: SrsCard[];
  /** Due cards left for another day because of the cap. */
  overflow: number;
}

/**
 * Today's review: due cards (most overdue first, capped so a missed week does
 * not become a wall), plus a few not-yet-due cards from the lowest steps, so
 * the session interleaves material from different lessons.
 */
export function planToday(
  cards: SrsCard[],
  now: number,
  { maxDue = 30, mix = 6, random = Math.random }: { maxDue?: number; mix?: number; random?: () => number } = {},
): TodayPlan {
  const dueAll = cards.filter((c) => isDue(c, now)).sort((a, b) => a.due - b.due);
  const due = dueAll.slice(0, maxDue);
  const rest = shuffle(cards.filter((c) => !isDue(c, now)), random).sort((a, b) => a.step - b.step);
  return { due, mix: rest.slice(0, mix), overflow: dueAll.length - due.length };
}

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
