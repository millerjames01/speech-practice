/**
 * Click-to-listen. ElevenLabs when a key and a narrator voice are set (cached,
 * so each sentence is paid for once), otherwise the browser's own Catalan
 * voice, which is free but only as good as what the OS has installed.
 */

import curriculum from '../../curriculum.json';
import { playLine, stopPlayback } from '../audio/player';
import { hasElevenLabsKey } from '../keys';
import { getPrefs } from './progress';

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

/**
 * How good a voice usually sounds. Browsers only lend out what the device has:
 * Edge streams Microsoft's neural voices ("… Online (Natural)"), Apple devices
 * ship a compact Catalan voice and offer Enhanced/Premium ones as downloads,
 * and Android has Google's. 3 and up sounds natural; 1 is the robotic default.
 */
export function voiceQuality(v: Pick<SpeechSynthesisVoice, 'name' | 'voiceURI'>): number {
  const id = `${v.name} ${v.voiceURI}`.toLowerCase();
  if (/natural|neural/.test(id)) return 4;
  if (/premium/.test(id)) return 3;
  if (/enhanced|mejorad|millorad|améliorée/.test(id)) return 2.5;
  if (/google/.test(id)) return 2;
  return 1;
}

const isCatalan = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace('_', '-').startsWith('ca');

/** Catalan voices on this device, best first (ca-ES ahead of other variants at equal quality). */
export function catalanVoices(): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === 'undefined') return [];
  const score = (v: SpeechSynthesisVoice) => voiceQuality(v) + (v.lang.toLowerCase().replace('_', '-') === 'ca-es' ? 0.1 : 0);
  return speechSynthesis
    .getVoices()
    .filter(isCatalan)
    .sort((a, b) => score(b) - score(a));
}

/** The voice in use: the one chosen in the picker if it is still there, otherwise the best. */
export function catalanVoice(): SpeechSynthesisVoice | null {
  const voices = catalanVoices();
  const chosen = getPrefs().voice;
  return voices.find((v) => v.voiceURI === chosen) ?? voices[0] ?? null;
}

export type VoicePlatform = 'ios' | 'mac' | 'windows' | 'android' | 'other';

export function voicePlatform(): VoicePlatform {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac';
  if (/Windows/.test(ua)) return 'windows';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

/** True in Microsoft Edge, which has the natural Catalan voices on every desktop. */
const isEdge = () => typeof navigator !== 'undefined' && /Edg\//.test(navigator.userAgent);

/**
 * How to get a natural-sounding Catalan voice on this device, or null when the
 * one in use already is.
 */
export function betterVoiceTip(): string | null {
  if (typeof speechSynthesis === 'undefined') return null;
  const voice = catalanVoice();
  if (voice && voiceQuality(voice) >= 2.5) return null;
  const edge = 'Microsoft Edge has natural Catalan voices built in (Joana, Enric): open this page in Edge for the best free audio.';
  switch (voicePlatform()) {
    case 'mac':
      return (
        'Your Mac is using its basic Catalan voice. For a much better one: System Settings → Accessibility → ' +
        'Spoken Content → System voice → Manage Voices… → Catalan → download Montse (Enhanced or Premium), then ' +
        `restart the browser. ${isEdge() ? '' : `Or: ${edge}`}`
      );
    case 'ios':
      return (
        'This iPhone or iPad is using its basic Catalan voice. For a much better one: Settings → Accessibility → ' +
        'Spoken Content → Voices → Catalan → download Montse (Enhanced or Premium), then reopen the app.'
      );
    case 'windows':
      return isEdge()
        ? 'No natural Catalan voice found. Check that you are online: Edge streams its natural voices.'
        : `This browser has ${voice ? 'only a basic' : 'no'} Catalan voice on Windows. ${edge}`;
    case 'android':
      return 'For a better voice: Settings → Text-to-speech → Speech services by Google → Install voice data → Català.';
    default:
      return isEdge() ? null : edge;
  }
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

/** Lines being spoken right now; voice answers ignore the mic meanwhile (it would hear the app). */
let speaking = 0;

export function isSpeaking(): boolean {
  return speaking > 0;
}

export async function speak(text: string, slow = false): Promise<void> {
  speaking += 1;
  try {
    await speakLine(text, slow);
  } finally {
    speaking = Math.max(0, speaking - 1);
  }
}

async function speakLine(text: string, slow: boolean): Promise<void> {
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
