/**
 * Validation for Speedrun lesson files. Like units, a malformed file is
 * rejected outright rather than patched: a silently repaired answer pattern is
 * how wrong Catalan gets drilled in.
 */

import { expand } from './pattern';
import { SPEEDRUN_LEVELS, type SpeedrunFile, type SpeedrunLesson, type SpeedrunLevel } from './types';

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function fail(where: string, message: string): never {
  throw new Error(`${where}: ${message}`);
}

function parseLesson(raw: unknown, level: SpeedrunLevel, index: number): SpeedrunLesson {
  const where = `lesson ${index + 1}`;
  if (!isObj(raw)) fail(where, 'not an object');
  const { id, title, goal, note, tables, vocab, items } = raw;
  if (!isStr(id) || !/^(a2|b1|b2|c1)-\d{2}$/.test(id)) fail(where, `bad id ${String(id)}`);
  const at = `${id}`;
  if (!id.startsWith(level.toLowerCase())) fail(at, `id does not match level ${level}`);
  if (!isStr(title)) fail(at, 'missing title');
  if (!isStr(goal)) fail(at, 'missing goal');
  if (!isStr(note)) fail(at, 'missing note');

  if (tables !== undefined) {
    if (!Array.isArray(tables)) fail(at, 'tables must be an array');
    for (const t of tables) {
      if (!isObj(t) || !isStr(t.title) || !Array.isArray(t.rows)) fail(at, 'bad table');
      for (const row of t.rows) {
        if (!Array.isArray(row) || row.length < 2 || !row.every((c) => typeof c === 'string')) {
          fail(at, `bad table row in "${t.title}"`);
        }
      }
    }
  }

  if (vocab !== undefined) {
    if (!Array.isArray(vocab)) fail(at, 'vocab must be an array');
    for (const v of vocab) {
      if (!Array.isArray(v) || v.length !== 2 || !isStr(v[0]) || !isStr(v[1])) {
        fail(at, `bad vocab entry ${JSON.stringify(v)}`);
      }
    }
  }

  if (!Array.isArray(items) || items.length < 6) fail(at, 'needs at least 6 items');
  items.forEach((item, i) => {
    if (
      !Array.isArray(item) ||
      item.length < 2 ||
      item.length > 3 ||
      !isStr(item[0]) ||
      !isStr(item[1]) ||
      (item.length === 3 && !isStr(item[2]))
    ) {
      fail(at, `item ${i + 1} must be [castellano, catalan, hint?]`);
    }
    try {
      expand(item[1]);
    } catch (err) {
      fail(at, `item ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  return { ...(raw as unknown as Omit<SpeedrunLesson, 'level'>), level };
}

export function parseSpeedrunFile(raw: unknown): SpeedrunFile {
  if (!isObj(raw)) fail('file', 'not an object');
  const { level, reviewed, lessons } = raw;
  if (!SPEEDRUN_LEVELS.includes(level as SpeedrunLevel)) fail('file', `bad level ${String(level)}`);
  if (typeof reviewed !== 'boolean') fail('file', 'reviewed must be a boolean');
  if (!Array.isArray(lessons) || lessons.length === 0) fail('file', 'no lessons');
  const lvl = level as SpeedrunLevel;
  return {
    level: lvl,
    reviewed,
    lessons: lessons.map((l, i) => parseLesson(l, lvl, i)),
  };
}
