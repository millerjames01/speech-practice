/**
 * Placeholder for the per-word classifier the brief names (TypeSafe's Jev):
 * one call per turn, one typed question per word, calibrated confidence.
 *
 * NOT REGISTERED. The endpoint and response shape could not be verified when
 * this was written, so implementing it would have been guesswork that fails at
 * runtime. The shape below is what the engine needs from it; filling in the
 * request and parsing is the whole job, and nothing around it changes.
 *
 * When wiring this up:
 *   1. Send one question per signal, in parallel, expecting one of
 *      pass | unclear | fail_word | fail_pronunciation plus a confidence.
 *   2. Return verdicts in the same order as `signals`.
 *   3. Leave the hard floor in judge/index.ts alone - Jev decides
 *      pronunciation, never vocabulary.
 *   4. Register it in judge/index.ts by setting the active judge.
 */

import type { WordJudge } from './types';

export const jevJudge: WordJudge = {
  name: 'jev',
  judge() {
    return Promise.reject(
      new Error(
        'JevJudge is not implemented. The app ships with the deterministic ' +
          'threshold judge; see src/judge/jev.ts to wire in a classifier.',
      ),
    );
  },
};
