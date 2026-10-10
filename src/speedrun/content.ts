/**
 * Loads every Speedrun lesson file from /speedrun at startup. Files are split
 * per level and part only to keep them reviewable; lessons are ordered by id.
 */

import { parseSpeedrunFile } from './schema';
import { SPEEDRUN_LEVELS, type SpeedrunLesson, type SpeedrunLevel } from './types';

const modules = import.meta.glob<{ default: unknown }>('../../speedrun/*.json', { eager: true });

export interface SpeedrunContent {
  lessons: SpeedrunLesson[];
  byLevel: Record<SpeedrunLevel, SpeedrunLesson[]>;
  /** Levels with at least one file not yet checked by a Catalan speaker. */
  unreviewed: Set<SpeedrunLevel>;
  errors: string[];
}

let cached: SpeedrunContent | null = null;

export function loadSpeedrun(): SpeedrunContent {
  if (cached) return cached;
  const lessons: SpeedrunLesson[] = [];
  const unreviewed = new Set<SpeedrunLevel>();
  const errors: string[] = [];

  for (const [path, mod] of Object.entries(modules)) {
    try {
      const file = parseSpeedrunFile(mod.default);
      if (!file.reviewed) unreviewed.add(file.level);
      lessons.push(...file.lessons);
    } catch (err) {
      errors.push(`${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const order = (l: SpeedrunLesson) => SPEEDRUN_LEVELS.indexOf(l.level);
  lessons.sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id));

  const byLevel = Object.fromEntries(
    SPEEDRUN_LEVELS.map((lvl) => [lvl, lessons.filter((l) => l.level === lvl)]),
  ) as Record<SpeedrunLevel, SpeedrunLesson[]>;

  cached = { lessons, byLevel, unreviewed, errors };
  return cached;
}
