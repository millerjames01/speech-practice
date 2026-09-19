/**
 * Thresholds and defaults. The pronunciation numbers here are conservative
 * placeholders: run `npm run spike` against your own recordings and mic, then
 * tune them from the per-word table it prints.
 */

export const config = {
  language: 'ca' as const,

  elevenlabs: {
    /**
     * Must be a model that actually speaks Catalan. eleven_multilingual_v2
     * covers 29 languages and Catalan is NOT among them, nor is it in the
     * 32 of flash/turbo v2.5 - those would read Catalan text with Spanish or
     * Italian phonology, teaching the exact Castilianisms this app exists to
     * catch. eleven_v3 covers 70+ languages including Catalan. Do not swap
     * this for a faster model without checking its language list first.
     */
    ttsModel: 'eleven_v3',
    sttModel: 'scribe_v1',
    baseUrl: 'https://api.elevenlabs.io',
    proxyUrl: '/proxy/elevenlabs',
  },

  judge: {
    /**
     * Forced-alignment loss above which a correctly-transcribed word is treated
     * as mispronounced. Alignment loss is a word-level proxy, not phoneme
     * grading - see the "no true pronunciation scoring" risk in the brief.
     */
    alignmentLossFail: 0.55,
    /** Between this and `alignmentLossFail`, a word reads as unclear. */
    alignmentLossUnclear: 0.35,
    /** Scribe logprob below which we did not reliably hear the word. */
    logprobUnclear: -1.2,
    /**
     * Verdicts below this confidence never stand on their own: the word is
     * shown as unclear rather than guessed either way.
     */
    confidenceCutoff: 0.6,
    /** Attempts allowed before a guided turn reveals its answer. */
    maxAttempts: 3,
    /** Fraction of learner turns given a second auto-detect drift pass. */
    driftSampleRate: 0.34,
    /** Below this language_probability for `ca`, flag drift. */
    driftProbabilityFloor: 0.75,
  },

  ui: {
    /** Cue-only by default: the target Catalan sits behind a toggle. */
    showTargetTextByDefault: false,
    slowPlaybackRate: 0.75,
  },

  freeform: {
    defaultMaxTurns: 12,
  },

  llm: {
    openrouter: {
      baseUrl: 'https://openrouter.ai',
      proxyUrl: '/proxy/openrouter',
      defaultModel: 'anthropic/claude-sonnet-4.5',
    },
    anthropic: {
      baseUrl: 'https://api.anthropic.com',
      proxyUrl: '/proxy/anthropic',
      defaultModel: 'claude-sonnet-4-5',
      version: '2023-06-01',
    },
  },
};

export type Config = typeof config;
