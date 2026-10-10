/**
 * Click-to-listen. ElevenLabs when a key and a narrator voice are set (cached,
 * so each sentence is paid for once), otherwise the browser's own Catalan
 * voice, which is free but only as good as what the OS has installed.
 */

import curriculum from '../../curriculum.json';
import { playLine, stopPlayback } from '../audio/player';
import { hasElevenLabsKey } from '../keys';

export type SpeechSource = 'elevenlabs' | 'browser' | 'none';

const narrator = (): string | null => {
  const id = (curriculum as { voices?: { narrator?: string } }).voices?.narrator ?? '';
  return id && !id.startsWith('REPLACE') ? id : null;
};

/** Set when an ElevenLabs call fails, so the UI can say why it fell back. */
let lastElevenError: string | null = null;

export function lastSpeechError(): string | null {
  return lastElevenError;
}

function catalanVoice(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === 'undefined') return null;
  const voices = speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang.toLowerCase() === 'ca-es') ??
    voices.find((v) => v.lang.toLowerCase().startsWith('ca')) ??
    null
  );
}

/** Voices load asynchronously in most browsers; resolve once they are in. */
export function voicesReady(): Promise<void> {
  if (typeof speechSynthesis === 'undefined') return Promise.resolve();
  if (speechSynthesis.getVoices().length > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
}

export function speechSource(): SpeechSource {
  if (hasElevenLabsKey() && narrator()) return 'elevenlabs';
  if (typeof speechSynthesis !== 'undefined') return 'browser';
  return 'none';
}

export function hasBrowserCatalanVoice(): boolean {
  return catalanVoice() !== null;
}

/**
 * The utterance being spoken. Holding a reference matters: Chrome can garbage-
 * collect an utterance nothing points to while it is still speaking, which cuts
 * the audio off after the first word or two.
 */
let current: SpeechSynthesisUtterance | null = null;

/** Gap after cancel() before speaking again; speaking immediately can clip or drop the new line. */
const CANCEL_SETTLE_MS = 120;

/** Bumped on every request, so a line waiting out the settle gap yields to a newer one. */
let generation = 0;

/** When the engine was last cancelled; new speech waits out CANCEL_SETTLE_MS from here. */
let lastCancel = 0;

function cancelEngine(): void {
  speechSynthesis.cancel();
  lastCancel = Date.now();
}

function browserSpeak(text: string, slow: boolean): Promise<void> {
  return new Promise((resolve) => {
    if (typeof speechSynthesis === 'undefined') return resolve();
    const synth = speechSynthesis;
    const mine = ++generation;
    const start = () => {
      if (mine !== generation) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      const voice = catalanVoice();
      if (voice) u.voice = voice;
      u.lang = voice?.lang ?? 'ca-ES';
      u.rate = slow ? 0.7 : 0.95;
      const done = () => {
        if (current === u) current = null;
        resolve();
      };
      u.onend = done;
      u.onerror = done;
      current = u;
      synth.speak(u);
    };
    if (synth.speaking || synth.pending) cancelEngine();
    const wait = lastCancel + CANCEL_SETTLE_MS - Date.now();
    if (wait > 0) setTimeout(start, wait);
    else start();
  });
}

export function stopSpeaking(): void {
  stopPlayback();
  current = null;
  generation += 1;
  if (typeof speechSynthesis !== 'undefined' && (speechSynthesis.speaking || speechSynthesis.pending)) cancelEngine();
}

export async function speak(text: string, slow = false): Promise<void> {
  // Only stop recorded audio here; browserSpeak cancels the speech engine itself, with the
  // settle delay that keeps the new line from being clipped.
  stopPlayback();
  const voice = narrator();
  if (hasElevenLabsKey() && voice) {
    try {
      await playLine(text, voice, slow);
      lastElevenError = null;
      return;
    } catch (err) {
      lastElevenError = err instanceof Error ? err.message : String(err);
    }
  }
  await browserSpeak(text, slow);
}
