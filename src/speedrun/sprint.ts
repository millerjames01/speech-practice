/**
 * Conjugation sprint: a timed round of translation drills, Castellano form to
 * Catalan form ("nosotros tenemos" → "tenim"), over 45 core verbs. Each tense
 * opens when the lesson that teaches it is finished and each verb when the
 * course reaches its level, so the sprint grows with the course. The forms come from speedrun/conjugation/verbs.json, built by
 * scripts/build-conjugation.py from the Softcatalà conjugator.
 */

import raw from '../../speedrun/conjugation/verbs.json';
import { canonical } from './pattern';
import { shuffle } from './srs';
import { SPEEDRUN_LEVELS, type SpeedrunLesson, type SpeedrunLevel } from './types';

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
  /** The course level at which the sprint starts drilling this verb. */
  level: SpeedrunLevel;
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
  verb: string;
  /** The verb's own level; the sprint drills it from that course level on. */
  verbLevel: SpeedrunLevel;
  /** Where the form counts in the rating: the higher of its verb's and its tense's level. */
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

const rank = (l: SpeedrunLevel) => SPEEDRUN_LEVELS.indexOf(l);
const higher = (a: SpeedrunLevel, b: SpeedrunLevel) => (rank(a) >= rank(b) ? a : b);

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
          verb: verb.ca,
          verbLevel: verb.level,
          level: higher(verb.level, tense.level),
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

/** Minutes a form rests after its last answer, by streak: a miss can come straight back; right answers space out. */
export const FORM_REST_MINUTES = [0, 24 * 60, 4 * 24 * 60, 10 * 24 * 60];

export interface SprintQueue {
  /** Missed last time: first, to fix them while fresh. */
  missed: SprintCard[];
  /** Right before and now due again, most overdue first. */
  review: SprintCard[];
  /**
   * Never answered: drawn from a working set of the most common verbs not yet
   * fully seen, shuffled across tenses and persons, never the same verb twice
   * running. A verb leaves the set once all its open forms are seen, and the
   * next most common one joins.
   */
  fresh: SprintCard[];
  /** Answered recently and resting; only used if a fast round runs out of everything else. */
  resting: SprintCard[];
}

/** Sorts the open forms by what they need, so a round never repeats what was just learned. */
export function sprintQueue(
  finished: Set<string>,
  forms: Record<string, number>,
  seen: Record<string, number>,
  now: number,
  {
    maxLevel = 'C1',
    random = Math.random,
    data = conjugation,
  }: { maxLevel?: SpeedrunLevel; random?: () => number; data?: ConjData } = {},
): SprintQueue {
  const open = openTenses(finished, data);
  const minute = Math.floor(now / 60_000);
  const q: SprintQueue = { missed: [], review: [], fresh: [], resting: [] };
  const overdue = new Map<string, number>();
  for (const c of conjugationPool(data)) {
    if (!open.has(c.tense) || rank(c.verbLevel) > rank(maxLevel)) continue;
    const n = forms[c.key];
    if (n === undefined) {
      q.fresh.push(c);
      continue;
    }
    const rest = FORM_REST_MINUTES[Math.min(n, FORM_REST_MINUTES.length - 1)]!;
    const since = seen[c.key] === undefined ? Infinity : minute - seen[c.key]!;
    if (rest > 0 && since < rest) q.resting.push(c);
    else if (n === 0) q.missed.push(c);
    else {
      overdue.set(c.key, since === Infinity ? Infinity : since / rest);
      q.review.push(c);
    }
  }
  q.missed = spreadVerbs(shuffle(q.missed, random));
  q.review = shuffle(q.review, random).sort((a, b) => (overdue.get(b.key) ?? 0) - (overdue.get(a.key) ?? 0));
  q.fresh = workingSet(q.fresh, random);
  q.resting.sort((a, b) => (seen[a.key] ?? 0) - (seen[b.key] ?? 0));
  return q;
}

/** Verbs drawn from at once for new forms. */
export const WORKING_VERBS = 5;

/**
 * Orders new forms: each pick takes a random verb from the first
 * WORKING_VERBS (data order is most common first), never the one just used,
 * and a random form of it; when a verb runs out, the next verb takes its seat.
 */
function workingSet(fresh: SprintCard[], random: () => number): SprintCard[] {
  const byVerb = new Map<string, SprintCard[]>();
  for (const c of fresh) byVerb.set(c.verb, [...(byVerb.get(c.verb) ?? []), c]);
  const waiting = [...byVerb.values()];
  const seats = waiting.splice(0, WORKING_VERBS).map((cards) => shuffle(cards, random));
  const out: SprintCard[] = [];
  while (seats.length > 0) {
    const last = out.at(-1)?.verb;
    const choices = seats.map((_, i) => i).filter((i) => seats.length === 1 || seats[i]![0]!.verb !== last);
    const turn = choices[Math.floor(random() * choices.length)]!;
    out.push(seats[turn]!.pop()!);
    if (seats[turn]!.length === 0) {
      const next = waiting.shift();
      if (next) seats[turn] = shuffle(next, random);
      else seats.splice(turn, 1);
    }
  }
  return out;
}

/** Reorders cards so the same verb never comes twice running when it can be avoided. */
function spreadVerbs(cards: SprintCard[]): SprintCard[] {
  const out: SprintCard[] = [];
  const rest = [...cards];
  while (rest.length > 0) {
    const i = rest.findIndex((c) => c.verb !== out.at(-1)?.verb);
    out.push(...rest.splice(i === -1 ? 0 : i, 1));
  }
  return out;
}

/** Due reviews go between new forms (about one in three) rather than in a block. */
function interleave(review: SprintCard[], fresh: SprintCard[]): SprintCard[] {
  const out: SprintCard[] = [];
  let r = 0;
  let f = 0;
  while (r < review.length || f < fresh.length) {
    const reviewTurn = f >= fresh.length || (r < review.length && out.length % 3 === 2);
    out.push(reviewTurn ? review[r++]! : fresh[f++]!);
  }
  return out;
}

/** The cards for a round, in the order they are asked. */
export function sprintRound(
  finished: Set<string>,
  forms: Record<string, number>,
  seen: Record<string, number> = {},
  now = Date.now(),
  options: { maxLevel?: SpeedrunLevel; random?: () => number; data?: ConjData } = {},
): SprintCard[] {
  return roundFrom(sprintQueue(finished, forms, seen, now, options));
}

/** A queue in asking order: misses, then reviews mixed into new forms, then (if ever reached) resting ones. */
export function roundFrom(q: SprintQueue): SprintCard[] {
  return [...q.missed, ...spreadVerbs(interleave(q.review, q.fresh)), ...q.resting];
}

/** The verbs new forms are coming from right now. */
export function workingVerbs(q: SprintQueue, data: ConjData = conjugation): string[] {
  const now = new Set(q.fresh.slice(0, 40).map((c) => c.verb));
  return data.verbs.map((v) => v.ca).filter((v) => now.has(v)).slice(0, WORKING_VERBS);
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
