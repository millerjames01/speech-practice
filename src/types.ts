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

/**
 * A communicative goal, not a script.
 *
 * The scripted phases enumerate correct answers in `accept` and match them. For
 * open subjects - plan a day out, say how home differs from here - no finite
 * set of right answers exists, so a task states what the turn must achieve and
 * the coach judges whether it did.
 */
export interface ConversationTask {
  /** English instruction: "Propose a day and a time, and suggest two things." */
  goal: string;
  /** Checkable requirements: ["a day of the week", "a time of day"]. */
  requires: string[];
  /** Words the unit wants you to reach for. Scores range; never matched. */
  targetVocab: string[];
}

export interface Conversation {
  /** Brief for the LLM counterpart, second person, as `freeform.scenario` is. */
  scenario: string;
  tasks: ConversationTask[];
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
  /** Scripted dialogues. Absent on units built around open conversation. */
  dialogues?: Dialogue[];
  conversation?: Conversation;
  freeform: Freeform;
}

/**
 * The order is the pedagogy: produce the sounds, then say the line with it in
 * front of you, then retrieve it from meaning alone, then sustain it, then use
 * it unscripted.
 */
export type Phase =
  | 'vocab'
  | 'guidedFollow'
  | 'guidedCue'
  | 'monologue'
  | 'conversation'
  | 'freeform'
  | 'report';

/**
 * The phases a unit actually runs, in order. A unit only gets a phase it has
 * the content for: a conversation unit has no scripted dialogues to follow and
 * no monologue to deliver, so it does not sit through empty versions of them.
 */
export function phasesFor(unit: Unit): Phase[] {
  const phases: Phase[] = [];
  if (unit.newVocab.length > 0) phases.push('vocab');
  if (unit.dialogues && unit.dialogues.length > 0) {
    phases.push('guidedFollow', 'guidedCue');
  }
  if (unit.monologue) phases.push('monologue');
  if (unit.conversation && unit.conversation.tasks.length > 0) {
    phases.push('conversation');
  }
  phases.push('freeform');
  return phases;
}
