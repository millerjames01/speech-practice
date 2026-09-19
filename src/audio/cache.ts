/**
 * TTS cache, keyed by hash(voice + model + text). Monologues are the biggest
 * TTS spend in the app, so every scripted line is paid for exactly once and
 * survives reloads.
 */

import {
  textToSpeech,
  textToSpeechWithTimestamps,
  type CharacterAlignment,
} from '../api/elevenlabs';
import { config } from '../config';
import { AUDIO_STORE, withStore } from './db';

/** FNV-1a: short, stable, and enough to key a local cache. */
function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export const cacheKey = (text: string, voiceId: string): string =>
  `${voiceId}:${config.elevenlabs.ttsModel}:${hash(text)}`;

/** In-flight requests, so two views asking for the same line pay once. */
const pending = new Map<string, Promise<Blob>>();

export async function getLineAudio(text: string, voiceId: string): Promise<Blob> {
  const key = cacheKey(text, voiceId);

  const cached = await withStore<Blob | undefined>(AUDIO_STORE, 'readonly', (s) =>
    s.get(key),
  ).catch(() => undefined);
  if (cached) return cached;

  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const request = textToSpeech(text, voiceId)
    .then(async (blob) => {
      await withStore(AUDIO_STORE, 'readwrite', (s) => s.put(blob, key)).catch(() => {
        // A cache write failure should not fail playback.
      });
      return blob;
    })
    .finally(() => pending.delete(key));

  pending.set(key, request);
  return request;
}

export async function clearAudioCache(): Promise<void> {
  await withStore(AUDIO_STORE, 'readwrite', (s) => s.clear());
}

/** Cached timed speech. Same key space, prefixed so it cannot collide. */
interface CachedTimedSpeech {
  audio: Blob;
  alignment: CharacterAlignment;
}

const timedPending = new Map<string, Promise<CachedTimedSpeech>>();

/**
 * The line's audio plus per-character timings, cached like everything else so a
 * line is synthesised once however many words get inspected in it.
 */
export async function getTimedLineAudio(
  text: string,
  voiceId: string,
): Promise<CachedTimedSpeech> {
  const key = `timed:${cacheKey(text, voiceId)}`;

  const cached = await withStore<CachedTimedSpeech | undefined>(
    AUDIO_STORE,
    'readonly',
    (s) => s.get(key),
  ).catch(() => undefined);
  if (cached) return cached;

  const inFlight = timedPending.get(key);
  if (inFlight) return inFlight;

  const request = textToSpeechWithTimestamps(text, voiceId)
    .then(async ({ audio, alignment }) => {
      const record: CachedTimedSpeech = { audio, alignment };
      await withStore(AUDIO_STORE, 'readwrite', (s) => s.put(record, key)).catch(() => {
        // A cache write failure should not fail playback.
      });
      return record;
    })
    .finally(() => timedPending.delete(key));

  timedPending.set(key, request);
  return request;
}
