/**
 * Conjugation sprint: a timed round of translation drills, Castellano form to
 * Catalan form ("nosotros tenemos" → "tenim"), over 45 core verbs. Each tense
 * opens when the lesson that teaches it is finished, so the sprint grows with
 * the course. The forms come from speedrun/conjugation/verbs.json, built by
 * scripts/build-conjugation.py from the Softcatalà conjugator.
 */

import raw from '../../speedrun/conjugation/verbs.json';
import { canonical } from './pattern';
import { shuffle } from './srs';
import type { SpeedrunLesson, SpeedrunLevel } from './types';

export interface ConjTense {
  id: string;
  /** Catalan name, shown with the verb: "tenir · futur". */
  label: string;
  /** The lesson that teaches it; finishing that lesson opens the tense. */
  lesson: string;
  level: SpeedrunLevel;
  style: 'plain' | 'que' | 'imper';
}

interface ConjVerb {
  ca: string;
  es: string;
  /** Per tense: [person 0-5, Castellano form, Catalan answer pattern]. */
  forms: Record<string, [number, string, string][]>;
}

export interface ConjData {
  reviewed: boolean;
  tenses: ConjTense[];
  verbs: ConjVerb[];
}

export const conjugation = raw as unknown as ConjData;

export interface SprintCard {
  /** Verb and tense, e.g. "tenir · futur". */
  context: string;
  /** The Castellano to translate, e.g. "nosotros tendremos". */
  prompt: string;
  /** The Catalan form as shown. */
  answer: string;
  /** Answer pattern: every standard variant is accepted. */
  pattern: string;
  tense: string;
  level: SpeedrunLevel;
  /** Stable short id for progress and sync. */
  key: string;
}

/** FNV-1a, base 36: short, stable across devices, and safe inside a sync code. */
export function formKey(context: string, prompt: string): string {
  let h = 0x811c9dc5;
  for (const ch of `${context}|${prompt}`) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const PRONOUNS = ['yo', 'tú', 'él', 'nosotros', 'vosotros', 'ellos'];

function promptFor(tense: ConjTense, person: number, es: string): string {
  const who = PRONOUNS[person] ?? '';
  if (tense.style === 'imper') return `¡${es}! (${who})`;
  if (tense.style === 'que') return `que ${who} ${es}`;
  return `${who} ${es}`;
}

let cached: SprintCard[] | null = null;

/** Every form in the data, in data order. */
export function conjugationPool(data: ConjData = conjugation): SprintCard[] {
  if (data === conjugation && cached) return cached;
  const tenses = new Map(data.tenses.map((t) => [t.id, t]));
  const out: SprintCard[] = [];
  for (const verb of data.verbs) {
    for (const [tid, cells] of Object.entries(verb.forms)) {
      const tense = tenses.get(tid);
      if (!tense) continue;
      for (const [person, es, pattern] of cells) {
        out.push({
          context: `${verb.ca} · ${tense.label}`,
          prompt: promptFor(tense, person, es),
          answer: canonical(pattern),
          pattern,
          tense: tid,
          level: tense.level,
          key: formKey(`${verb.ca}|${tid}`, String(person)),
        });
      }
    }
  }
  if (data === conjugation) cached = out;
  return out;
}

/** Tenses open so far: the present always, the rest as their lessons are finished. */
export function openTenses(finished: Set<string>, data: ConjData = conjugation): Set<string> {
  return new Set(data.tenses.filter((t, i) => i === 0 || finished.has(t.lesson)).map((t) => t.id));
}

/** Two right answers in a row: the form counts as known. */
export const FORM_KNOWN = 2;

/**
 * The cards for a round, from the open tenses: forms missed last time first,
 * then ones half-learned, then new ones, then known ones for upkeep; shuffled
 * within each group.
 */
export function sprintRound(
  finished: Set<string>,
  forms: Record<string, number>,
  random = Math.random,
  data: ConjData = conjugation,
): SprintCard[] {
  const open = openTenses(finished, data);
  const pool = shuffle(
    conjugationPool(data).filter((c) => open.has(c.tense)),
    random,
  );
  const rank = (c: SprintCard) => {
    const n = forms[c.key];
    return n === 0 ? 0 : n === 1 ? 1 : n === undefined ? 2 : 3;
  };
  return [0, 1, 2, 3].flatMap((r) => pool.filter((c) => rank(c) === r));
}

export const SPRINT_SECONDS = 60;

/* ---------- legacy ----------
 * The first sprint drilled cells of the lessons' reference tables. Its form
 * keys are still on devices that used it; migration carries them across by
 * matching answers (see migrateIfNeeded in ui.ts).
 */

/** Tables that are not form-to-form lookups. */
const SKIP_TABLES = new Set(['conversions']);

export function legacyTablePool(lessons: SpeedrunLesson[]): { key: string; answer: string; lessonId: string }[] {
  const out: { key: string; answer: string; lessonId: string }[] = [];
  for (const lesson of lessons) {
    for (const table of lesson.tables ?? []) {
      if (SKIP_TABLES.has(table.title)) continue;
      for (const row of table.rows) {
        const label = row[0] ?? '';
        row.slice(1).forEach((cell, k) => {
          const answer = cell.trim();
          if (!answer || answer === '—' || /[()[\]|]/.test(answer)) return;
          const col = table.cols?.[k + 1]?.trim();
          const prompt = !col ? label : col.startsWith('+') ? `${label} ${col}` : `${col} · ${label}`;
          out.push({ key: formKey(table.title, prompt), answer, lessonId: lesson.id });
        });
      }
    }
  }
  return out;
}
