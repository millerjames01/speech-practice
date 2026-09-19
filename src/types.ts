/** Shapes for unit content, mirroring the unit JSON schema in scripts/schema.ts. */

export type CefrLevel = 'A1' | 'A2' | 'B1';
export type UnitType = 'scenario' | 'vocabulary';

export interface MonologueSentence {
  text: string;
  cue: string;
}

export interface Monologue {
  modelVoice: string;
  sentences: MonologueSentence[];
}

/** A line the counterpart speaks. Audio is generated lazily from `text`. */
export interface CounterpartTurn {
  speaker: string;
  text: string;
}

/**
 * A learner turn. `accept` holds 2-4 phrasings that count as correct; anything
 * else fails. `focus` names the words whose pronunciation this turn targets.
 */
export interface LearnerTurn {
  speaker: 'learner';
  cue: string;
  accept: string[];
  focus?: string[];
}

export type Turn = CounterpartTurn | LearnerTurn;

export const isLearnerTurn = (turn: Turn): turn is LearnerTurn =>
  turn.speaker === 'learner';

export interface Dialogue {
  id: string;
  turns: Turn[];
}

export interface Freeform {
  scenario: string;
  maxTurns: number;
}

export interface Unit {
  id: string;
  title: string;
  level: CefrLevel;
  type: UnitType;
  /**
   * False until a human has checked the Catalan. Wrong Catalan in an `accept`
   * list would actively train errors, so the app warns before an unreviewed
   * unit is practised.
   */
  reviewed: boolean;
  newVocab: string[];
  voices: Record<string, string>;
  monologue?: Monologue;
  dialogues: Dialogue[];
  freeform: Freeform;
}

export type Phase = 'guided' | 'monologue' | 'freeform' | 'report';
