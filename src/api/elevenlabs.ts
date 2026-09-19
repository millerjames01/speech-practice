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

/** Generates speech for one line. Callers should go through audio/cache.ts. */
export async function textToSpeech(text: string, voiceId: string): Promise<Blob> {
  const res = await elevenFetch(`/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: config.elevenlabs.ttsModel }),
  });
  return res.blob();
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
