/**
 * Conjugation sprint: a timed round of forms pulled from the reference tables
 * of the lessons you have finished ("tenir · nosaltres" → "tindrem"). The
 * tables are already data, so the sprint grows with the course for free.
 */

import { shuffle } from './srs';
import type { SpeedrunLesson } from './types';

export interface SprintCard {
  /** The table the form comes from, e.g. "ser — present". */
  context: string;
  /** What to produce, e.g. "parlar · nosaltres". */
  prompt: string;
  /** The form as shown in the table. */
  answer: string;
  /** Answer pattern: cells listing several forms accept any of them. */
  pattern: string;
  lessonId: string;
  /** Stable short id for progress and sync: a hash of context and prompt. */
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

/** Tables that are not form-to-form lookups. */
const SKIP_TABLES = new Set(['conversions']);

export function sprintPool(lessons: SpeedrunLesson[]): SprintCard[] {
  const out: SprintCard[] = [];
  for (const lesson of lessons) {
    for (const table of lesson.tables ?? []) {
      if (SKIP_TABLES.has(table.title)) continue;
      for (const row of table.rows) {
        const label = row[0] ?? '';
        row.slice(1).forEach((cell, k) => {
          const answer = cell.trim();
          if (!answer || answer === '—' || /[()[\]|]/.test(answer)) return;
          const col = table.cols?.[k + 1]?.trim();
          const alts = answer.split(/\s*\/\s*|,\s+/).filter(Boolean);
          // "+ els" columns read as a sum ("per + els"); others name the verb ("menjar · tu").
          const prompt = !col ? label : col.startsWith('+') ? `${label} ${col}` : `${col} · ${label}`;
          out.push({
            context: table.title,
            prompt,
            key: formKey(table.title, prompt),
            answer,
            pattern: alts.length > 1 ? `[${[answer, ...alts].join('|')}]` : answer,
            lessonId: lesson.id,
          });
        });
      }
    }
  }
  return out;
}

/** Distinct forms, first occurrence wins (some tables repeat in a later lesson). */
export function uniqueForms(pool: SprintCard[]): SprintCard[] {
  const seen = new Set<string>();
  return pool.filter((c) => !seen.has(c.key) && seen.add(c.key));
}

/** Two right answers in a row: the form counts as known. */
export const FORM_KNOWN = 2;

/**
 * The pool for a round: tables from finished lessons, or, before there are
 * enough of those, from the first lessons of the course. Forms not yet known
 * come first, so a round spends its seconds where the rating can move.
 */
export function sprintRound(
  all: SpeedrunLesson[],
  finished: Set<string>,
  random = Math.random,
  forms: Record<string, number> = {},
): SprintCard[] {
  const done = all.filter((l) => finished.has(l.id));
  let pool = sprintPool(done);
  for (let n = 4; pool.length < 30 && n <= all.length; n += 2) pool = sprintPool([...done, ...all.slice(0, n)]);
  const mixed = uniqueForms(shuffle(pool, random));
  const known = (c: SprintCard) => (forms[c.key] ?? 0) >= FORM_KNOWN;
  return [...mixed.filter((c) => !known(c)), ...mixed.filter(known)];
}

export const SPRINT_SECONDS = 60;
