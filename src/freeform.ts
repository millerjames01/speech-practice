/**
 * Free form: open conversation, corrected only at the end.
 *
 * No expected text exists, so forced alignment is off during the conversation
 * and nothing is shown but the counterpart's replies. Each turn is logged with
 * its transcript, per-word logprobs and one sampled drift check; the report is
 * built from all of it at the end.
 */

import { forcedAlignment, transcribe, type ScribeWord } from './api/elevenlabs';
import { chat, parseJsonReply } from './api/llm';
import { config } from './config';
import type { Unit } from './types';

export interface LearnerTurnLog {
  transcript: string;
  words: ScribeWord[];
  audio: Blob;
  /** Sampled auto-detect pass; present only on sampled turns. */
  drift?: { code: string; probability: number };
  /** Words Scribe was unsure it heard. */
  lowConfidenceWords: string[];
}

export interface ConversationEntry {
  role: 'counterpart' | 'learner';
  text: string;
}

const counterpartSystem = (unit: Unit): string =>
  [
    `You are the counterpart in a spoken role-play for a learner of Catalan at ${unit.level} level.`,
    `Scenario: ${unit.freeform.scenario}`,
    '',
    'Rules:',
    '- Speak only in Central Catalan (Barcelona/Girona). Never use Spanish or English.',
    '- Never use Castilianisms, even ones common in speech.',
    '- Stay on the theme of the scenario.',
    '- Do NOT correct the learner or comment on their mistakes. That happens later.',
    '- Keep each reply to one or two short spoken sentences.',
    '- Reply with the spoken line only: no quotation marks, stage directions or translations.',
    `- Match the vocabulary level of the unit, which teaches: ${unit.newVocab.join(', ')}.`,
  ].join('\n');

export async function counterpartReply(
  unit: Unit,
  history: ConversationEntry[],
): Promise<string> {
  const messages = history.map((entry) => ({
    role: entry.role === 'learner' ? ('user' as const) : ('assistant' as const),
    content: entry.text,
  }));
  // The model needs an opening user turn to respond to.
  if (messages.length === 0 || messages[0]!.role !== 'user') {
    messages.unshift({ role: 'user', content: '[The learner has just arrived.]' });
  }
  const reply = await chat({ system: counterpartSystem(unit), messages, maxTokens: 300 });
  return reply.trim();
}

/** Transcribes and logs a learner turn without judging or interrupting. */
export async function logLearnerTurn(audio: Blob, sampleDrift: boolean): Promise<LearnerTurnLog> {
  const scribe = await transcribe(audio);
  const drift = sampleDrift
    ? await transcribe(audio, { detectLanguage: true }).catch(() => null)
    : null;

  const log: LearnerTurnLog = {
    transcript: scribe.text,
    words: scribe.words,
    audio,
    lowConfidenceWords: scribe.words
      .filter((w) => w.logprob !== undefined && w.logprob <= config.judge.logprobUnclear)
      .map((w) => w.text),
  };
  if (drift?.languageCode !== undefined) {
    log.drift = { code: drift.languageCode, probability: drift.languageProbability ?? 0 };
  }
  return log;
}

export type ErrorCategory = 'grammar' | 'vocabulary' | 'castilianism' | 'pronunciation';
export type Severity = 'minor' | 'moderate' | 'serious';

export interface ReportError {
  category: ErrorCategory;
  /** The learner's exact words, as transcribed. */
  said: string;
  correct: string;
  reason: string;
  severity: Severity;
  /** Index into the turn log, so the report can play back the learner's audio. */
  turnIndex: number;
  /** Set after re-alignment: high loss confirms a pronunciation issue too. */
  pronunciationConfirmed?: boolean;
}

export interface CorrectionReport {
  errors: ReportError[];
  summary: string;
}

const reportSystem = [
  'You are a strict Catalan teacher reviewing a transcript of a spoken practice session.',
  '',
  'Rules:',
  '- List EVERY error. Do not interpret charitably. If the learner said something',
  '  that is not correct Central Catalan, it is an error, even if the meaning was clear.',
  '- Flag Castilianisms explicitly, with category "castilianism", including ones that',
  '  are common in casual speech.',
  '- Quote the learner\'s exact words in "said", as they appear in the transcript.',
  '- "correct" is the corrected form of that same phrase, nothing more.',
  '- "reason" is one short line.',
  '- "severity" is one of: minor, moderate, serious.',
  '- "category" is one of: grammar, vocabulary, castilianism, pronunciation.',
  '- "turnIndex" is the 0-based index of the learner turn the error is in.',
  '',
  'Reply with JSON only, in this shape:',
  '{"summary": "one or two sentences", "errors": [{"category": "...", "said": "...",',
  ' "correct": "...", "reason": "...", "severity": "...", "turnIndex": 0}]}',
].join('\n');

export async function buildReport(
  unit: Unit,
  turns: LearnerTurnLog[],
): Promise<CorrectionReport> {
  const transcript = turns
    .map((t, i) => {
      const flags: string[] = [];
      if (t.lowConfidenceWords.length > 0) {
        flags.push(`unclear words: ${t.lowConfidenceWords.join(', ')}`);
      }
      if (t.drift && t.drift.code !== config.language) {
        flags.push(`language detected as ${t.drift.code} (${t.drift.probability.toFixed(2)})`);
      }
      return `Turn ${i}: ${t.transcript}${flags.length ? `  [${flags.join('; ')}]` : ''}`;
    })
    .join('\n');

  const reply = await chat({
    system: reportSystem,
    messages: [
      {
        role: 'user',
        content: `Unit: ${unit.title} (${unit.level}). Scenario: ${unit.freeform.scenario}\n\nLearner turns:\n${transcript}`,
      },
    ],
    maxTokens: 2048,
    json: true,
  });

  const parsed = parseJsonReply<{ summary?: string; errors?: ReportError[] }>(reply);
  const errors = (parsed.errors ?? []).filter(
    (e) => typeof e.said === 'string' && typeof e.correct === 'string',
  );

  // For the corrected sentences, re-align the original audio against the
  // CORRECTED text. High loss on those words confirms a pronunciation problem,
  // not just a grammar one.
  await Promise.all(
    errors.map(async (error) => {
      const turn = turns[error.turnIndex];
      if (!turn) return;
      const alignment = await forcedAlignment(turn.audio, error.correct).catch(() => null);
      if (!alignment) return;
      const worst = alignment.words
        .map((w) => w.loss)
        .filter((l): l is number => l !== undefined);
      if (worst.length === 0) return;
      error.pronunciationConfirmed =
        Math.max(...worst) >= config.judge.alignmentLossFail;
    }),
  );

  return { errors, summary: parsed.summary ?? '' };
}

export const categoryLabels: Record<ErrorCategory, string> = {
  grammar: 'Grammar',
  vocabulary: 'Vocabulary',
  castilianism: 'Castilianisms',
  pronunciation: 'Pronunciation',
};
