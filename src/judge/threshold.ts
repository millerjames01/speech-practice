/**
 * The deterministic threshold rule, and the app's shipping judge.
 *
 * The brief specifies a classifier (TypeSafe's Jev) with this rule as the
 * fallback. Both sit behind WordJudge, so whichever runs, the engine around
 * them is identical - which is also how the brief's open question ("does Jev
 * beat the threshold rule?") gets answered: run them side by side.
 */

import { config } from '../config';
import type { WordJudge, WordSignal, WordVerdict } from './types';

function judgeWord(signal: WordSignal): WordVerdict {
  // Vocabulary errors are settled in code, not by a threshold. Repeated here
  // so the judge is correct standalone; re-asserted in index.ts regardless.
  if (signal.status === 'substitution') {
    return {
      verdict: 'fail_word',
      confidence: 1,
      reason: `Said "${signal.heard}" instead of "${signal.expected}"`,
    };
  }
  if (signal.status === 'missing') {
    return { verdict: 'fail_word', confidence: 1, reason: `Missing "${signal.expected}"` };
  }
  if (signal.status === 'extra') {
    return { verdict: 'fail_word', confidence: 1, reason: `Extra word "${signal.heard}"` };
  }

  const { alignmentLossFail, alignmentLossUnclear, logprobUnclear } = config.judge;
  const loss = signal.alignmentLoss;
  const logprob = signal.logprob;

  if (signal.languageDrift) {
    return {
      verdict: 'fail_pronunciation',
      confidence: 0.7,
      reason: 'This turn drifted out of Catalan',
    };
  }

  // The right word, aligned badly: the case Scribe alone cannot catch, because
  // Scribe may output the correct word for a mispronounced one.
  if (loss !== undefined && loss >= alignmentLossFail) {
    // Focus words are the turn's pronunciation targets, so we are readier to
    // call a failure on them than on incidental words.
    const confidence = signal.isFocus ? 0.85 : 0.7;
    return { verdict: 'fail_pronunciation', confidence, reason: 'Pronunciation was off' };
  }

  if (loss !== undefined && loss >= alignmentLossUnclear) {
    return { verdict: 'unclear', confidence: 0.6, reason: 'Pronunciation was not clean' };
  }

  if (logprob !== undefined && logprob <= logprobUnclear) {
    return { verdict: 'unclear', confidence: 0.6, reason: 'Hard to make out' };
  }

  // No alignment signal at all means we have one signal, not four. Say so
  // rather than implying a precision we do not have.
  if (loss === undefined && logprob === undefined) {
    return { verdict: 'unclear', confidence: 0.4, reason: 'No pronunciation signal available' };
  }

  return { verdict: 'pass', confidence: 0.9, reason: 'Matched' };
}

export const thresholdJudge: WordJudge = {
  name: 'threshold',
  judge: (signals) => Promise.resolve(signals.map(judgeWord)),
};
