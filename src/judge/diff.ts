/**
 * Token diff between the expected text and what Scribe heard, plus the choice
 * of which `accept` variant to judge against.
 */

import { tokenize } from './normalize';
import type { DiffStatus } from './types';

export interface DiffEntry {
  status: DiffStatus;
  expected?: string;
  heard?: string;
  /** Index of the heard word in the transcript, for timestamp lookup. */
  heardIndex?: number;
}

type Op = 'match' | 'sub' | 'del' | 'ins';

/**
 * Levenshtein alignment over word tokens. Word-level rather than character-
 * level on purpose: a character diff would blur a wrong word into a
 * "nearly right" one, which is exactly the charitable reading we refuse.
 */
export function diffWords(expected: string[], heard: string[]): DiffEntry[] {
  const n = expected.length;
  const m = heard.length;
  const cost: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const op: Op[][] = Array.from({ length: n + 1 }, () => new Array<Op>(m + 1).fill('match'));

  for (let i = 1; i <= n; i += 1) {
    cost[i]![0] = i;
    op[i]![0] = 'del';
  }
  for (let j = 1; j <= m; j += 1) {
    cost[0]![j] = j;
    op[0]![j] = 'ins';
  }

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const same = expected[i - 1] === heard[j - 1];
      const subCost = cost[i - 1]![j - 1]! + (same ? 0 : 1);
      const delCost = cost[i - 1]![j]! + 1;
      const insCost = cost[i]![j - 1]! + 1;
      const best = Math.min(subCost, delCost, insCost);
      cost[i]![j] = best;
      op[i]![j] = best === subCost ? (same ? 'match' : 'sub') : best === delCost ? 'del' : 'ins';
    }
  }

  const entries: DiffEntry[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const step = i === 0 ? 'ins' : j === 0 ? 'del' : op[i]![j]!;
    if (step === 'match' || step === 'sub') {
      entries.push({
        status: step === 'match' ? 'match' : 'substitution',
        expected: expected[i - 1]!,
        heard: heard[j - 1]!,
        heardIndex: j - 1,
      });
      i -= 1;
      j -= 1;
    } else if (step === 'del') {
      entries.push({ status: 'missing', expected: expected[i - 1]! });
      i -= 1;
    } else {
      entries.push({ status: 'extra', heard: heard[j - 1]!, heardIndex: j - 1 });
      j -= 1;
    }
  }
  return entries.reverse();
}

export interface VariantChoice {
  /** The accept variant, as written in the unit. */
  target: string;
  diff: DiffEntry[];
  /** Number of non-matching entries. 0 means a clean take. */
  errors: number;
}

/**
 * Picks the accept variant closest to what was actually said, so a learner who
 * chose the shorter valid phrasing is judged against that one rather than
 * against a longer variant they never attempted.
 *
 * This is generosity about *which correct answer* was aimed at, never about
 * whether the words were right.
 */
export function chooseVariant(accept: string[], transcript: string): VariantChoice {
  const heard = tokenize(transcript);
  const scored = accept.map((target) => {
    const diff = diffWords(tokenize(target), heard);
    return { target, diff, errors: diff.filter((d) => d.status !== 'match').length };
  });
  scored.sort((a, b) => a.errors - b.errors);
  const best = scored[0];
  if (!best) throw new Error('Turn has no accept variants');
  return best;
}
