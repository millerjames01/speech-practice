/**
 * Unit loading. Units are plain JSON in /units, generated at dev time and
 * loaded at startup; no audio is committed, since it is generated lazily from
 * the text and cached.
 */

import { parseUnit } from '../scripts/schema';
import type { Unit } from './types';

const modules = import.meta.glob<{ default: unknown }>('../units/*.json', { eager: true });

export function loadUnits(): { units: Unit[]; errors: string[] } {
  const units: Unit[] = [];
  const errors: string[] = [];

  for (const [path, mod] of Object.entries(modules)) {
    try {
      units.push(parseUnit(mod.default));
    } catch (err) {
      errors.push(`${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  units.sort((a, b) => a.id.localeCompare(b.id));
  return { units, errors };
}
