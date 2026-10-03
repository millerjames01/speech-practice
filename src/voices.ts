/**
 * Voice resolution.
 *
 * A unit names its speakers ("narrator", "venedora") and maps each to a voice
 * id. Hand-written and generated units ship without real ids, because ids are
 * account-specific and there is nothing sensible to hardcode: an ElevenLabs
 * voice is a timbre, not a language, so any voice will do as long as the model
 * speaks Catalan (see config.elevenlabs.ttsModel).
 *
 * So on first use we fetch the account's voices and assign one per speaker,
 * distinct within a unit where there are enough to go round. A real id in a
 * unit file always wins - this is a default, not an override.
 */

import { listVoices } from './api/elevenlabs';
import type { Unit } from './types';

/** What generated and hand-written units carry in place of a real voice id. */
export const VOICE_PLACEHOLDER = 'AUTO';

const isPlaceholder = (id: string): boolean =>
  id.trim().length === 0 || id === VOICE_PLACEHOLDER || id.startsWith('REPLACE_WITH');

/** Resolved ids per unit id, for the life of the page. */
const resolved = new Map<string, Record<string, string>>();
let voicesPromise: Promise<string[]> | null = null;

function accountVoiceIds(): Promise<string[]> {
  voicesPromise ??= listVoices()
    .then((voices) => voices.map((v) => v.voiceId))
    .catch(() => []);
  return voicesPromise;
}

/**
 * Returns the unit's speaker-to-voice map with placeholders filled in. Falls
 * back to the placeholder itself when the account has no voices, so the caller
 * still gets a map and the TTS error surfaces where it can be read.
 */
export async function resolveVoices(unit: Unit): Promise<Record<string, string>> {
  const cached = resolved.get(unit.id);
  if (cached) return cached;

  const speakers = Object.keys(unit.voices);
  const needsResolving = speakers.some((s) => isPlaceholder(unit.voices[s] ?? ''));
  if (!needsResolving) {
    resolved.set(unit.id, unit.voices);
    return unit.voices;
  }

  const available = await accountVoiceIds();
  const taken = new Set(
    speakers.map((s) => unit.voices[s] ?? '').filter((id) => !isPlaceholder(id)),
  );
  // Prefer voices the unit is not already using, so two speakers do not collide
  // while an unused voice sits idle.
  const pool = available.filter((id) => !taken.has(id));

  const map: Record<string, string> = {};
  let next = 0;
  for (const speaker of speakers) {
    const declared = unit.voices[speaker] ?? '';
    if (!isPlaceholder(declared)) {
      map[speaker] = declared;
      continue;
    }
    // Reuse rather than fail when the account has fewer voices than speakers.
    map[speaker] = pool.length > 0 ? pool[next % pool.length]! : VOICE_PLACEHOLDER;
    next += 1;
  }

  resolved.set(unit.id, map);
  return map;
}

/** Drops cached resolutions, e.g. after the key changes to another account. */
export function clearResolvedVoices(): void {
  resolved.clear();
  voicesPromise = null;
}
