/** Shapes for the Speedrun mode: bite-sized Castellano → Catalan writing lessons. */

export type SpeedrunLevel = 'A2' | 'B1' | 'B2' | 'C1';

export const SPEEDRUN_LEVELS: SpeedrunLevel[] = ['A2', 'B1', 'B2', 'C1'];

/**
 * One translation item: the Castellano prompt, the Catalan answer pattern, and
 * an optional hint shown under the prompt.
 *
 * The answer is a pattern, not a single string, so one line can list every
 * correct phrasing: `(x)` is optional and `[a|b]` picks one alternative. The
 * canonical answer (shown and spoken) drops every optional part and takes the
 * first alternative, so the preferred phrasing always goes first.
 */
export type SpeedrunItem = [es: string, ca: string, hint?: string];

/**
 * A reference table shown before practice. Every row starts with a label
 * (a pronoun, a gloss); every other cell is Catalan and plays on click.
 */
export interface SpeedrunTable {
  title: string;
  cols?: string[];
  rows: string[][];
}

export interface SpeedrunLesson {
  id: string;
  level: SpeedrunLevel;
  title: string;
  /** One line: what you can do after these five minutes. */
  goal: string;
  /** Short explanation. Paragraphs split on blank lines; **bold** marks Catalan, *italic* Castellano. */
  note: string;
  tables?: SpeedrunTable[];
  /** Core words as [catalan, castellano]. */
  vocab?: [ca: string, es: string][];
  items: SpeedrunItem[];
}

export interface SpeedrunFile {
  level: SpeedrunLevel;
  /**
   * False until a Catalan speaker has checked the file. Wrong Catalan here
   * would be drilled into memory, so the app warns until this flips.
   */
  reviewed: boolean;
  lessons: SpeedrunLesson[];
}
