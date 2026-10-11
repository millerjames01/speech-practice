/**
 * Voice answers: the browser's own speech recognition, in Catalan. Chrome and
 * Edge (desktop and Android) send the audio to their speech service; Safari
 * uses Apple's. Nothing is recorded or stored by the app.
 */

import { checkAnswer, type CheckResult } from './check';

/** The slice of the Web Speech API the app uses (not in every TypeScript DOM lib). */
interface Recognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function canListen(): boolean {
  return ctor() !== null;
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Allow it for this site in the browser settings.',
  'service-not-allowed': 'Speech recognition is turned off in this browser.',
  'no-speech': 'Didn’t catch anything. Try again a little closer to the mic.',
  'audio-capture': 'No microphone found.',
  network: 'Speech recognition needs a connection in this browser.',
  'language-not-supported': 'This browser can’t recognise Catalan.',
};

export interface Listening {
  /** What was heard: the recogniser's best guesses, most likely first. Empty if nothing was. */
  result: Promise<string[]>;
  stop(): void;
}

/** Listens for one answer. */
export function listen(lang = 'ca-ES'): Listening {
  const Ctor = ctor();
  if (!Ctor) return { result: Promise.reject(new Error('Speech recognition isn’t available in this browser.')), stop() {} };
  const rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = false;
  rec.continuous = false;
  rec.maxAlternatives = 5;
  let heard: string[] = [];
  const result = new Promise<string[]>((resolve, reject) => {
    rec.onresult = (ev) => {
      const first = ev.results[0];
      heard = first ? Array.from({ length: first.length }, (_, i) => first[i]?.transcript.trim() ?? '').filter(Boolean) : [];
    };
    rec.onerror = (ev) => {
      if (ev.error === 'aborted') return resolve([]);
      if (ev.error === 'no-speech') return resolve([]);
      reject(new Error(ERRORS[ev.error] ?? `Speech recognition failed (${ev.error}).`));
    };
    rec.onend = () => resolve(heard);
  });
  try {
    rec.start();
  } catch (err) {
    return { result: Promise.reject(err instanceof Error ? err : new Error(String(err))), stop() {} };
  }
  return { result, stop: () => rec.stop() };
}

const RANK = { exact: 0, spelling: 1, wrong: 2 } as const;

/**
 * The best reading of what was heard: the recogniser offers several guesses,
 * and the learner gets credit if any of them is right. Spelling slips are
 * forgiven as usual (a recogniser can't hear accents wrong, but it can write
 * a homophone).
 */
export function bestHearing(pattern: string, heard: string[]): { text: string; result: CheckResult } | null {
  let best: { text: string; result: CheckResult } | null = null;
  for (const text of heard) {
    const result = checkAnswer(pattern, text);
    if (!best || RANK[result.verdict] < RANK[best.result.verdict]) best = { text, result };
  }
  return best;
}
