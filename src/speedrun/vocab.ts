/**
 * Vocab builder: breadth the lessons deliberately skip. A curated pack of
 * frequent single words (speedrun/vocab/words.json), on its own review track
 * so it never floods the lesson queue or moves the level percentages.
 */

import raw from '../../speedrun/vocab/words.json';
import { isDue, priority, type SrsCard } from './srs';
import { SPEEDRUN_LEVELS, type SpeedrunItem, type SpeedrunLevel } from './types';

export interface VocabSet {
  id: string;
  /** Unlocks when the course reaches this level. */
  level: SpeedrunLevel;
  title: string;
  /** [catalan, castellano]; nouns carry their article. */
  words: [ca: string, es: string][];
}

export interface VocabPack {
  reviewed: boolean;
  sets: VocabSet[];
}

export const isVocabCard = (c: SrsCard): boolean => /^w\d{3}$/.test(c.lessonId);

export function parseVocab(input: unknown): VocabPack {
  const fail = (m: string): never => {
    throw new Error(`vocab: ${m}`);
  };
  const data = input as Partial<VocabPack> | null;
  if (!data || typeof data.reviewed !== 'boolean' || !Array.isArray(data.sets)) fail('bad file');
  const seen = new Set<string>();
  for (const set of data!.sets!) {
    if (!/^w\d{3}$/.test(set.id) || typeof set.title !== 'string' || !Array.isArray(set.words)) fail(`bad set ${set.id}`);
    if (!SPEEDRUN_LEVELS.includes(set.level)) fail(`bad level in ${set.id}`);
    for (const w of set.words) {
      if (!Array.isArray(w) || w.length !== 2 || !w[0]?.trim() || !w[1]?.trim()) fail(`bad word in ${set.id}`);
      if (/[()[\]|]/.test(w[0])) fail(`pattern characters in "${w[0]}"`);
      if (seen.has(w[0])) fail(`duplicate word "${w[0]}"`);
      seen.add(w[0]);
    }
  }
  return data as VocabPack;
}

export const vocab: VocabPack = parseVocab(raw);

/** The article is optional when answering ("cor" passes), but the shown answer keeps it ("el cor"). */
export function vocabPattern(ca: string): string {
  const m = ca.match(/^(?:(?:el|la|els|les) |l')(.+)$/);
  return m ? `[${ca}|${m[1]}]` : ca;
}

export const vocabItem = ([ca, es]: [string, string]): SpeedrunItem => [es, vocabPattern(ca)];

export interface VocabEntry {
  lessonId: string;
  index: number;
  item: SpeedrunItem;
  due: boolean;
}

/** Sets open up to the level the course has reached. */
export function unlockedSets(maxLevel: SpeedrunLevel, pack = vocab): VocabSet[] {
  const top = SPEEDRUN_LEVELS.indexOf(maxLevel);
  return pack.sets.filter((s) => SPEEDRUN_LEVELS.indexOf(s.level) <= top);
}

/** Words per vocab round. */
export const VOCAB_ROUND = 20;

/**
 * A vocab round of up to `size` words: the weakest due words first, then new
 * words in set order from the sets unlocked so far, filling the rest.
 */
export function planVocab(
  cards: SrsCard[],
  now: number,
  {
    size = VOCAB_ROUND,
    pack = vocab,
    maxLevel = 'C1',
  }: { size?: number; pack?: VocabPack; maxLevel?: SpeedrunLevel } = {},
): VocabEntry[] {
  const byKey = new Map(cards.filter(isVocabCard).map((c) => [`${c.lessonId}#${c.index}`, c]));
  const wordAt = (id: string, i: number) => pack.sets.find((s) => s.id === id)?.words[i];
  const due = [...byKey.values()]
    .filter((c) => isDue(c, now))
    .sort((a, b) => priority(b, now) - priority(a, now))
    .slice(0, size)
    .flatMap((c) => {
      const w = wordAt(c.lessonId, c.index);
      return w ? [{ lessonId: c.lessonId, index: c.index, item: vocabItem(w), due: true }] : [];
    });
  const unseen: VocabEntry[] = [];
  for (const set of unlockedSets(maxLevel, pack)) {
    set.words.forEach((w, i) => {
      if (due.length + unseen.length < size && !byKey.has(`${set.id}#${i}`)) unseen.push({ lessonId: set.id, index: i, item: vocabItem(w), due: true });
    });
  }
  return [...due, ...unseen];
}

export function vocabStats(
  cards: SrsCard[],
  now: number,
  pack = vocab,
  maxLevel: SpeedrunLevel = 'C1',
): { seen: number; known: number; due: number; total: number; unlocked: number } {
  const vc = cards.filter(isVocabCard);
  return {
    seen: vc.length,
    known: vc.filter((c) => c.step >= 2).length,
    due: vc.filter((c) => isDue(c, now)).length,
    total: pack.sets.reduce((n, s) => n + s.words.length, 0),
    unlocked: unlockedSets(maxLevel, pack).reduce((n, s) => n + s.words.length, 0),
  };
}

/**
 * One set, all of it: due words first (weakest first), then new words, then
 * the rest. Words not yet due are marked so, and a right answer does not push
 * them further out.
 */
export function planVocabSet(cards: SrsCard[], now: number, setId: string, pack = vocab): VocabEntry[] {
  const set = pack.sets.find((s) => s.id === setId);
  if (!set) return [];
  const byIndex = new Map(cards.filter((c) => c.lessonId === setId).map((c) => [c.index, c]));
  const entries = set.words.map((w, i) => ({ i, w, card: byIndex.get(i) }));
  const due = entries.filter((e) => e.card && isDue(e.card, now)).sort((a, b) => priority(b.card!, now) - priority(a.card!, now));
  const fresh = entries.filter((e) => !e.card);
  const early = entries.filter((e) => e.card && !isDue(e.card, now));
  return [...due, ...fresh, ...early].map((e) => ({
    lessonId: setId,
    index: e.i,
    item: vocabItem(e.w),
    due: !e.card || isDue(e.card, now),
  }));
}

/** Due words in one set right now. */
export function setDue(cards: SrsCard[], now: number, setId: string): number {
  return cards.filter((c) => c.lessonId === setId && isDue(c, now)).length;
}
