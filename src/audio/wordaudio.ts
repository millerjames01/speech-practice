/**
 * Model audio for a single word, cut from the line it belongs to.
 *
 * Synthesising a word on its own produces something that sounds nothing like
 * speech: no sentence prosody, odd stress, and in a voice whose accent is far
 * more obvious in isolation. The brief asks for "TTS with timing, sliced", and
 * this is that - generate the whole line once, then cut the word out of it.
 */

import type { CharacterAlignment } from '../api/elevenlabs';
import { getTimedLineAudio } from './cache';
import { sliceAudio } from './slice';

/** Character offsets of each whitespace-separated token in `text`. */
export function wordSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  const re = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    spans.push({ start: match.index, end: match.index + match[0].length });
  }
  return spans;
}

/**
 * Turns a character range into a time range. The alignment array indexes the
 * text exactly as submitted, so character offsets map straight across.
 */
export function timeRangeForChars(
  alignment: CharacterAlignment,
  startChar: number,
  endChar: number,
): { start: number; end: number } | null {
  const { startSeconds, endSeconds } = alignment;
  if (startSeconds.length === 0) return null;

  const first = Math.max(0, Math.min(startChar, startSeconds.length - 1));
  const last = Math.max(0, Math.min(endChar - 1, endSeconds.length - 1));
  if (last < first) return null;

  const start = startSeconds[first];
  const end = endSeconds[last];
  if (start === undefined || end === undefined || end <= start) return null;
  return { start, end };
}

/**
 * Audio of one word of `text`, identified by its index among the line's
 * whitespace-separated tokens. Falls back to the whole line when the word
 * cannot be located, which is better than silence.
 */
export async function getWordAudio(
  text: string,
  voiceId: string,
  wordIndex: number,
): Promise<Blob> {
  const { audio, alignment } = await getTimedLineAudio(text, voiceId);

  const span = wordSpans(text)[wordIndex];
  if (!span) return audio;

  const range = timeRangeForChars(alignment, span.start, span.end);
  if (!range) return audio;

  return sliceAudio(audio, range.start, range.end).catch(() => audio);
}
