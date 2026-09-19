/**
 * Unit validation, shared by the app loader and the generation script.
 *
 * Hand-written rather than pulled from a JSON-schema library: the rules are few
 * and the error messages need to be specific enough that `npm run generate` can
 * retry with them, since the brief requires invalid output to be retried rather
 * than patched.
 */

import type { Unit } from '../src/types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const LEVELS = ['A1', 'A2', 'B1'];
const TYPES = ['scenario', 'vocabulary'];

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

export function validateUnit(input: unknown): ValidationResult {
  const errors: string[] = [];
  const push = (m: string) => errors.push(m);

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { valid: false, errors: ['unit must be a JSON object'] };
  }
  const u = input as Record<string, unknown>;

  if (typeof u.id !== 'string' || !u.id) push('id must be a non-empty string');
  if (typeof u.title !== 'string' || !u.title) push('title must be a non-empty string');
  if (typeof u.level !== 'string' || !LEVELS.includes(u.level)) {
    push(`level must be one of ${LEVELS.join(', ')}`);
  }
  if (typeof u.type !== 'string' || !TYPES.includes(u.type)) {
    push(`type must be one of ${TYPES.join(', ')}`);
  }
  if (typeof u.reviewed !== 'boolean') push('reviewed must be a boolean');
  if (!isStringArray(u.newVocab)) push('newVocab must be an array of strings');

  const voices = u.voices;
  if (typeof voices !== 'object' || voices === null || Array.isArray(voices)) {
    push('voices must be an object mapping speaker name to voice id');
  }
  const speakers = new Set(
    typeof voices === 'object' && voices !== null ? Object.keys(voices) : [],
  );

  if (u.monologue !== undefined) {
    const m = u.monologue as Record<string, unknown>;
    if (typeof m !== 'object' || m === null) {
      push('monologue must be an object');
    } else {
      if (typeof m.modelVoice !== 'string' || !speakers.has(m.modelVoice)) {
        push(`monologue.modelVoice must name a speaker in voices`);
      }
      if (!Array.isArray(m.sentences) || m.sentences.length === 0) {
        push('monologue.sentences must be a non-empty array');
      } else {
        m.sentences.forEach((s, i) => {
          const sent = s as Record<string, unknown>;
          if (typeof sent?.text !== 'string' || !sent.text) {
            push(`monologue.sentences[${i}].text must be a non-empty string`);
          }
          if (typeof sent?.cue !== 'string' || !sent.cue) {
            push(`monologue.sentences[${i}].cue must be a non-empty string`);
          }
        });
      }
    }
  }

  if (!Array.isArray(u.dialogues) || u.dialogues.length === 0) {
    push('dialogues must be a non-empty array');
  } else {
    u.dialogues.forEach((d, di) => {
      const dia = d as Record<string, unknown>;
      const at = `dialogues[${di}]`;
      if (typeof dia?.id !== 'string' || !dia.id) push(`${at}.id must be a non-empty string`);
      if (!Array.isArray(dia?.turns) || dia.turns.length === 0) {
        push(`${at}.turns must be a non-empty array`);
        return;
      }
      let learnerTurns = 0;
      dia.turns.forEach((t, ti) => {
        const turn = t as Record<string, unknown>;
        const tat = `${at}.turns[${ti}]`;
        if (typeof turn?.speaker !== 'string' || !turn.speaker) {
          push(`${tat}.speaker must be a non-empty string`);
          return;
        }
        if (turn.speaker === 'learner') {
          learnerTurns += 1;
          if (typeof turn.cue !== 'string' || !turn.cue) {
            push(`${tat}.cue must be a non-empty string`);
          }
          if (!isStringArray(turn.accept) || turn.accept.length < 1) {
            push(`${tat}.accept must be a non-empty array of strings`);
          } else if (turn.accept.length > 4) {
            push(`${tat}.accept must have at most 4 variants`);
          }
          if (turn.focus !== undefined && !isStringArray(turn.focus)) {
            push(`${tat}.focus must be an array of strings when present`);
          }
        } else {
          if (!speakers.has(turn.speaker)) {
            push(`${tat}.speaker "${turn.speaker}" is not listed in voices`);
          }
          if (typeof turn.text !== 'string' || !turn.text) {
            push(`${tat}.text must be a non-empty string`);
          }
        }
      });
      if (learnerTurns === 0) push(`${at} has no learner turns`);
    });
  }

  const f = u.freeform as Record<string, unknown>;
  if (typeof f !== 'object' || f === null) {
    push('freeform must be an object');
  } else {
    if (typeof f.scenario !== 'string' || !f.scenario) {
      push('freeform.scenario must be a non-empty string');
    }
    if (typeof f.maxTurns !== 'number' || !Number.isInteger(f.maxTurns) || f.maxTurns < 1) {
      push('freeform.maxTurns must be a positive integer');
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Validates and narrows, throwing with every error at once. */
export function parseUnit(input: unknown): Unit {
  const { valid, errors } = validateUnit(input);
  if (!valid) {
    throw new Error(`Invalid unit:\n  - ${errors.join('\n  - ')}`);
  }
  return input as Unit;
}
