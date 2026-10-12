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
  /**
   * Epoch ms of the last right answer given early (as a filler item, before the
   * card was due). It doesn't move the schedule, but it rests the card from
   * being picked as a filler again for a while. Kept on this device only.
   */
  practiced?: number;
}

/** How long a card answered right as an early filler stays out of the filler picks. */
export const FILLER_REST_MS = 20 * 3_600_000;

/** Fillers: not-due cards, weakest first, the least recently practised first, none practised in the last FILLER_REST_MS. */
function fillers(cards: SrsCard[], now: number): SrsCard[] {
  const seenAt = (c: SrsCard) => Math.max(c.practiced ?? 0, c.last ?? 0);
  return cards
    .filter((c) => !isDue(c, now) && !(c.practiced !== undefined && now - c.practiced < FILLER_REST_MS))
    .sort((a, b) => a.step - b.step || seenAt(a) - seenAt(b));
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

/**
 * A first-try answer in review: climb one step, or drop to the bottom.
 *
 * Gaps of a week and longer are jittered ±15%, so a lesson's items, all
 * learned on the same day, drift apart instead of returning as one block.
 */
export function review(card: SrsCard, correct: boolean, now: number, random: () => number = Math.random): SrsCard {
  if (!correct) return { ...card, step: 0, due: dueIn(INTERVALS[0]!, now), lapses: card.lapses + 1, last: now };
  const step = Math.min(card.step + 1, INTERVALS.length - 1);
  const base = INTERVALS[step]!;
  const days = base >= 7 ? Math.max(1, Math.round(base * (0.85 + 0.3 * random()))) : base;
  return { ...card, step, due: dueIn(days, now), last: now };
}

export const isDue = (card: SrsCard, now: number): boolean => card.due <= now;

export interface TodayPlan {
  due: SrsCard[];
  mix: SrsCard[];
  /** Due cards left for another day because of the cap. */
  overflow: number;
}

/** Days overdue plus three per past miss: the weakest items come first. */
export const priority = (card: SrsCard, now: number): number =>
  Math.max(0, (now - card.due) / DAY) + card.lapses * 3;

/** Orders cards so consecutive ones come from different lessons, keeping each lesson's own order. */
export function interleave(cards: SrsCard[]): SrsCard[] {
  const byLesson = new Map<string, SrsCard[]>();
  for (const c of cards) byLesson.set(c.lessonId, [...(byLesson.get(c.lessonId) ?? []), c]);
  const queues = [...byLesson.values()];
  const out: SrsCard[] = [];
  while (out.length < cards.length) {
    for (const q of queues) {
      const next = q.shift();
      if (next) out.push(next);
    }
  }
  return out;
}

/**
 * Today's mixed review: the weakest due cards first (capped, so a missed week
 * does not become a wall), interleaved across lessons, plus a few not-yet-due
 * cards from the lowest steps for variety.
 */
export function planToday(
  cards: SrsCard[],
  now: number,
  { maxDue = 30, mix = 6, random = Math.random }: { maxDue?: number; mix?: number; random?: () => number } = {},
): TodayPlan {
  const dueAll = cards.filter((c) => isDue(c, now)).sort((a, b) => priority(b, now) - priority(a, now));
  const due = interleave(dueAll.slice(0, maxDue));
  // Shuffled first, so cards with equal step and history come in varying order.
  const rest = fillers(shuffle(cards, random), now);
  return { due, mix: rest.slice(0, mix), overflow: dueAll.length - due.length };
}

/**
 * One lesson's review: everything due in it, topped up with its weakest
 * not-yet-due items, so a short targeted session always has something to do.
 */
export function planLessonReview(cards: SrsCard[], now: number, size = 8): TodayPlan {
  const due = cards.filter((c) => isDue(c, now)).sort((a, b) => priority(b, now) - priority(a, now));
  const weakest = fillers(
    [...cards].sort((a, b) => b.lapses - a.lapses || a.due - b.due),
    now,
  );
  return { due, mix: weakest.slice(0, Math.max(0, size - due.length)), overflow: 0 };
}

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
