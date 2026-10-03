/** Shared vocabulary for the correction engine. */

import type { CefrLevel } from '../types';

export type Verdict = 'pass' | 'unclear' | 'fail_word' | 'fail_pronunciation';

export type DiffStatus = 'match' | 'substitution' | 'missing' | 'extra';

/**
 * Everything known about one word of one attempt, assembled before any judge
 * sees it. Four independent signals, so no single model gets to charitably
 * decide what the learner meant.
 */
export interface WordSignal {
  /** The word the learner should have said. Absent for an extra word. */
  expected?: string;
  /**
   * Index of this word among the target line's whitespace-separated tokens, so
   * its model audio can be cut from the line rather than synthesised alone.
   */
  expectedIndex?: number;
  /** The word Scribe heard. Absent for a missing word. */
  heard?: string;
  status: DiffStatus;
  /** Forced-alignment loss for this word. Higher is a worse audio match. */
  alignmentLoss?: number;
  start?: number;
  end?: number;
  /** Scribe's confidence it heard this word at all. */
  logprob?: number;
  /** True when the sampled auto-detect pass suggests the learner left Catalan. */
  languageDrift?: boolean;
  /** This word is one of the turn's pronunciation targets. */
  isFocus: boolean;
  level: CefrLevel;
}

export interface WordVerdict {
  verdict: Verdict;
  /** 0-1. Below config.judge.confidenceCutoff the word is shown as unclear. */
  confidence: number;
  /** Why, in template terms. Judges return no prose. */
  reason: string;
}

/**
 * A judge decides pronunciation only. Vocabulary is settled in code before any
 * judge runs, and re-asserted after it (see judge/index.ts): a wrong or missing
 * word always fails, whatever a judge says.
 */
export interface WordJudge {
  readonly name: string;
  judge(signals: WordSignal[]): Promise<WordVerdict[]>;
}

export interface JudgedWord extends WordVerdict {
  signal: WordSignal;
}

export interface AttemptResult {
  /** True only when every word passed. Unclear words do not pass a turn. */
  passed: boolean;
  words: JudgedWord[];
  /** The accept variant the attempt was judged against. */
  target: string;
  transcript: string;
  /** Seconds of speech, from the take's timestamps. Shown, never scored. */
  durationSeconds?: number;
  /** Words per minute. Fluency info, not part of pass/fail. */
  wordsPerMinute?: number;
  languageDrift?: { code: string; probability: number } | undefined;
}
