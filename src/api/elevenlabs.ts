/**
 * ElevenLabs: text-to-speech, Scribe speech-to-text, and forced alignment.
 *
 * Scribe answers "what did you say"; forced alignment answers "how well did
 * your audio match what you should have said". The correction engine needs
 * both, so the two calls run in parallel per attempt.
 */

import { config } from '../config';
import { getSettings, requireElevenLabsKey } from '../keys';

const base = (): string =>
  getSettings().useProxy ? config.elevenlabs.proxyUrl : config.elevenlabs.baseUrl;

async function elevenFetch(path: string, init: RequestInit): Promise<Response> {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: { 'xi-api-key': requireElevenLabsKey(), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) {
      throw new Error('ElevenLabs rejected the key. Check it in Settings.');
    }
    if (res.status === 400 && path.includes('speech-to-text')) {
      throw new Error(
        'That recording could not be transcribed — it was probably too short ' +
          'or silent. Hold the button down while you speak, then release.',
      );
    }
    if (res.status === 429) {
      throw new Error('ElevenLabs rate limit or quota reached. Wait a moment and retry.');
    }
    throw new Error(
      `ElevenLabs ${path} failed (${res.status}). ${detail.slice(0, 300)}`,
    );
  }
  return res;
}

export interface Voice {
  voiceId: string;
  name: string;
}

/** The voices on the account, used to fill in units that name no real voice. */
export async function listVoices(): Promise<Voice[]> {
  const res = await elevenFetch('/v1/voices', { method: 'GET' });
  const json = (await res.json()) as { voices?: { voice_id: string; name: string }[] };
  return (json.voices ?? []).map((v) => ({ voiceId: v.voice_id, name: v.name }));
}

/**
 * Whether the model accepted an explicit language code.
 *
 * eleven_v3 supports language enforcement and ERRORS on a code it does not
 * know, rather than ignoring it. The parameter is documented as ISO 639-1
 * ("ca"), but Catalan is also written "cat" (639-3) in places, so rather than
 * betting on one we try, and remember what worked for the rest of the session.
 */
/**
 * Codes to try, in order, ending in no enforcement at all. The parameter is
 * documented as ISO 639-1 ("ca"), but Catalan appears as "cat" (639-3) in
 * places, and the model errors on a code it does not know rather than ignoring
 * it. Trying beats betting.
 */
const LANGUAGE_CANDIDATES: (string | null)[] = [config.language, 'cat', null];

/** Settles to the code that worked, so later lines pay no retry cost. */
let languageCode: string | null | undefined;

function speechBody(text: string, language: string | null): string {
  return JSON.stringify({
    text,
    model_id: config.elevenlabs.ttsModel,
    // Without this the model infers the language from the text, and a short
    // line in an English-accented voice is read with English letter rules -
    // "seixanta" comes out "sexanta" rather than "seshanta". For a
    // pronunciation trainer that is the model teaching the error.
    ...(language !== null ? { language_code: language } : {}),
  });
}

/** True when the failure is the language code specifically, not the request. */
const isLanguageRejection = (err: unknown): boolean =>
  err instanceof Error && /language/i.test(err.message);

/**
 * Runs a speech request with language enforcement, walking the candidate codes
 * until one is accepted. Better an unenforced line than no line at all.
 */
async function withLanguageEnforcement<T>(
  run: (language: string | null) => Promise<T>,
): Promise<T> {
  if (languageCode !== undefined) return run(languageCode);

  let lastError: unknown;
  for (const candidate of LANGUAGE_CANDIDATES) {
    try {
      const result = await run(candidate);
      languageCode = candidate;
      return result;
    } catch (err) {
      if (!isLanguageRejection(err)) throw err;
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Speech request failed');
}

/** Which language code the model accepted, once anything has been spoken. */
export const acceptedLanguageCode = (): string | null | undefined => languageCode;

/** Generates speech for one line. Callers should go through audio/cache.ts. */
export async function textToSpeech(text: string, voiceId: string): Promise<Blob> {
  return withLanguageEnforcement(async (language) => {
    const res = await elevenFetch(`/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: speechBody(text, language),
    });
    return res.blob();
  });
}

export interface CharacterAlignment {
  characters: string[];
  startSeconds: number[];
  endSeconds: number[];
}

export interface TimedSpeech {
  audio: Blob;
  alignment: CharacterAlignment;
}

function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/**
 * Speech plus per-character timings.
 *
 * This is what makes single-word playback usable: rather than synthesising a
 * word on its own - which strips it of sentence prosody and sounds nothing like
 * speech - we generate the whole line once and slice the word out of it.
 */
export async function textToSpeechWithTimestamps(
  text: string,
  voiceId: string,
): Promise<TimedSpeech> {
  const res = await withLanguageEnforcement((language) =>
    elevenFetch(`/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: speechBody(text, language),
    }),
  );

  const json = (await res.json()) as {
    audio_base64?: string;
    alignment?: {
      characters?: string[];
      character_start_times_seconds?: number[];
      character_end_times_seconds?: number[];
    };
  };

  if (!json.audio_base64) throw new Error('ElevenLabs returned no audio');

  return {
    audio: base64ToBlob(json.audio_base64, 'audio/mpeg'),
    alignment: {
      characters: json.alignment?.characters ?? [],
      startSeconds: json.alignment?.character_start_times_seconds ?? [],
      endSeconds: json.alignment?.character_end_times_seconds ?? [],
    },
  };
}

export interface ScribeWord {
  text: string;
  start: number;
  end: number;
  type?: string;
  /** Present on word tokens; how sure Scribe was it heard this word. */
  logprob?: number;
}

export interface ScribeResult {
  text: string;
  words: ScribeWord[];
  languageCode?: string;
  languageProbability?: number;
}

/**
 * Transcribes a recording. `language_code` is forced to Catalan for judging
 * passes: auto-detect would let a Castilian-sounding take be transcribed as
 * Spanish and quietly "succeed". Pass detectLanguage for the drift check only.
 */
export async function transcribe(
  audio: Blob,
  opts: { detectLanguage?: boolean } = {},
): Promise<ScribeResult> {
  const form = new FormData();
  form.append('file', audio, 'take.webm');
  form.append('model_id', config.elevenlabs.sttModel);
  form.append('timestamps_granularity', 'word');
  if (!opts.detectLanguage) form.append('language_code', config.language);

  const res = await elevenFetch('/v1/speech-to-text', { method: 'POST', body: form });
  const json = (await res.json()) as {
    text?: string;
    words?: ScribeWord[];
    language_code?: string;
    language_probability?: number;
  };

  return {
    text: json.text ?? '',
    words: (json.words ?? []).filter((w) => w.type !== 'spacing'),
    languageCode: json.language_code,
    languageProbability: json.language_probability,
  };
}

export interface AlignedWord {
  text: string;
  start: number;
  end: number;
  /** Lower is a better match between audio and expected text. */
  loss?: number;
}

export interface AlignmentResult {
  words: AlignedWord[];
  loss?: number;
}

/**
 * Aligns a recording against the text the learner was supposed to say. Per-word
 * loss is the pronunciation signal: a word transcribed correctly but aligned
 * badly is the case Scribe alone cannot catch.
 */
export async function forcedAlignment(
  audio: Blob,
  expectedText: string,
): Promise<AlignmentResult> {
  const form = new FormData();
  form.append('file', audio, 'take.webm');
  form.append('text', expectedText);

  const res = await elevenFetch('/v1/forced-alignment', { method: 'POST', body: form });
  const json = (await res.json()) as {
    words?: AlignedWord[];
    characters?: unknown;
    loss?: number;
  };
  return { words: json.words ?? [], loss: json.loss };
}
