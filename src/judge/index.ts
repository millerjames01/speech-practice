/**
 * The correction engine.
 *
 * Per attempt: Scribe and forced alignment run in parallel, the closest accept
 * variant is chosen, one signal packet is built per word, the active judge
 * rules on pronunciation, and then the hard floor is applied in code.
 */

import { forcedAlignment, transcribe, type ScribeResult } from '../api/elevenlabs';
import { config } from '../config';
import { recordAttempt } from '../calibration';
import type { CefrLevel } from '../types';
import { chooseVariant } from './diff';
import { assembleSignals } from './packet';
import { thresholdJudge } from './threshold';
import type { AttemptResult, JudgedWord, WordJudge, WordSignal, WordVerdict } from './types';

export * from './types';
export { chooseVariant, diffWords } from './diff';

let activeJudge: WordJudge = thresholdJudge;

export function setJudge(judge: WordJudge): void {
  activeJudge = judge;
}

export function getJudge(): WordJudge {
  return activeJudge;
}

/**
 * The hard floor. A wrong, missing or extra word fails, whatever the judge
 * said, and whatever confidence it claimed. Judges decide pronunciation; they
 * never forgive vocabulary.
 *
 * Below the confidence cutoff, a verdict does not stand on its own: the word
 * reads as unclear rather than being guessed in either direction.
 */
export function applyHardFloor(signal: WordSignal, verdict: WordVerdict): WordVerdict {
  if (signal.status !== 'match') {
    const reason =
      signal.status === 'substitution'
        ? `Said "${signal.heard}" instead of "${signal.expected}"`
        : signal.status === 'missing'
          ? `Missing "${signal.expected}"`
          : `Extra word "${signal.heard}"`;
    return { verdict: 'fail_word', confidence: 1, reason };
  }

  if (verdict.verdict === 'fail_word') {
    // The word was right; a judge calling it a vocabulary error is wrong.
    return { verdict: 'unclear', confidence: verdict.confidence, reason: verdict.reason };
  }

  if (verdict.confidence < config.judge.confidenceCutoff && verdict.verdict !== 'unclear') {
    return {
      verdict: 'unclear',
      confidence: verdict.confidence,
      reason: `${verdict.reason} (low confidence)`,
    };
  }

  return verdict;
}

/** Unclear words do not pass a turn: strictness means not guessing in our favour. */
const isPass = (words: JudgedWord[]): boolean => words.every((w) => w.verdict === 'pass');

function fluency(scribe: ScribeResult): { durationSeconds?: number; wordsPerMinute?: number } {
  const first = scribe.words[0];
  const last = scribe.words[scribe.words.length - 1];
  if (!first || !last || last.end <= first.start) return {};
  const durationSeconds = last.end - first.start;
  return {
    durationSeconds,
    wordsPerMinute: Math.round((scribe.words.length / durationSeconds) * 60),
  };
}

export interface JudgeOptions {
  accept: string[];
  focus?: string[];
  level: CefrLevel;
  /** Force the sampled drift check on or off instead of rolling for it. */
  checkDrift?: boolean;
}

export async function judgeAttempt(
  audio: Blob,
  opts: JudgeOptions,
): Promise<AttemptResult> {
  const checkDrift = opts.checkDrift ?? Math.random() < config.judge.driftSampleRate;

  // First pass forced to Catalan, so a Castilian take cannot be transcribed as
  // Spanish and quietly succeed.
  const scribe = await transcribe(audio);
  const variant = chooseVariant(opts.accept, scribe.text);

  // Alignment runs against the variant the learner actually aimed at.
  const [alignment, drift] = await Promise.all([
    forcedAlignment(audio, variant.target).catch(() => null),
    checkDrift ? transcribe(audio, { detectLanguage: true }).catch(() => null) : null,
  ]);

  const driftDetected =
    drift != null &&
    drift.languageCode !== undefined &&
    (drift.languageCode !== config.language ||
      (drift.languageProbability ?? 1) < config.judge.driftProbabilityFloor);

  const signals = assembleSignals(variant.diff, scribe, alignment, {
    focus: opts.focus ?? [],
    level: opts.level,
    ...(drift ? { languageDrift: driftDetected } : {}),
  });

  const verdicts = await activeJudge.judge(signals).catch(() =>
    // A judge that fails must not take the attempt with it: fall back to the
    // deterministic rule rather than leaving the learner with nothing.
    thresholdJudge.judge(signals),
  );

  const words: JudgedWord[] = signals.map((signal, i) => ({
    signal,
    ...applyHardFloor(signal, verdicts[i] ?? { verdict: 'unclear', confidence: 0, reason: 'No verdict' }),
  }));

  // Calibration data: over a few sessions this shows which words and sounds
  // you consistently miss, and lets thresholds adapt to your voice and mic.
  void recordAttempt(words);

  return {
    passed: isPass(words),
    words,
    target: variant.target,
    transcript: scribe.text,
    ...fluency(scribe),
    languageDrift:
      drift?.languageCode !== undefined
        ? { code: drift.languageCode, probability: drift.languageProbability ?? 0 }
        : undefined,
  };
}
