/**
 * Assembles one signal packet per word from the two parallel calls, so judges
 * see a single uniform record instead of reconciling two response shapes.
 */

import type { AlignmentResult, ScribeResult } from '../api/elevenlabs';
import type { CefrLevel } from '../types';
import type { DiffEntry } from './diff';
import { normalizeWord } from './normalize';
import type { WordSignal } from './types';

export interface PacketContext {
  focus: string[];
  level: CefrLevel;
  languageDrift?: boolean;
}

/**
 * Alignment returns one entry per expected word, in order, so expected words
 * are matched by position among the expected tokens rather than by string -
 * a repeated word would otherwise take the first entry's loss every time.
 */
export function assembleSignals(
  diff: DiffEntry[],
  scribe: ScribeResult,
  alignment: AlignmentResult | null,
  ctx: PacketContext,
): WordSignal[] {
  const focus = new Set(ctx.focus.map(normalizeWord));
  let expectedIndex = 0;

  return diff.map((entry) => {
    const aligned =
      entry.expected !== undefined ? alignment?.words[expectedIndex] : undefined;
    if (entry.expected !== undefined) expectedIndex += 1;

    const heardWord =
      entry.heardIndex !== undefined ? scribe.words[entry.heardIndex] : undefined;

    const signal: WordSignal = {
      status: entry.status,
      isFocus: entry.expected !== undefined && focus.has(entry.expected),
      level: ctx.level,
    };
    if (entry.expected !== undefined) signal.expected = entry.expected;
    if (entry.heard !== undefined) signal.heard = entry.heard;
    if (aligned?.loss !== undefined) signal.alignmentLoss = aligned.loss;
    if (heardWord?.logprob !== undefined) signal.logprob = heardWord.logprob;
    if (heardWord?.start !== undefined) signal.start = heardWord.start;
    if (heardWord?.end !== undefined) signal.end = heardWord.end;
    // Fall back to the alignment timestamps when Scribe gave none - a missing
    // word still has a place in the take worth playing back.
    if (signal.start === undefined && aligned?.start !== undefined) {
      signal.start = aligned.start;
      signal.end = aligned.end;
    }
    if (ctx.languageDrift !== undefined) signal.languageDrift = ctx.languageDrift;
    return signal;
  });
}
