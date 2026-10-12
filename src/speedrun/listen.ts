/**
 * Voice answers: the browser's own speech recognition, in Catalan. Chrome and
 * Edge (desktop and Android) send the audio to their speech service; Safari
 * uses Apple's. Nothing is recorded or stored by the app.
 */

import { checkAnswer, fold, normalize, type CheckResult } from './check';

/** The slice of the Web Speech API the app uses (not in every TypeScript DOM lib). */
interface RecognitionResult extends ArrayLike<{ transcript: string }> {
  isFinal: boolean;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: { resultIndex?: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  onspeechend: (() => void) | null;
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
  'audio-capture': 'No microphone found.',
  network: 'Speech recognition needs a connection in this browser.',
  'language-not-supported': 'This browser can’t recognise Catalan.',
};

/** How long to wait for the final result after "done" before using what was heard so far. */
export const SETTLE_MS = 3500;
/** Longest a single answer may run before it is stopped. */
export const MAX_LISTEN_MS = 12_000;

export interface Listening {
  /** What was heard: the recogniser's guesses, most likely first. Empty if nothing was. */
  result: Promise<string[]>;
  /** "I'm done": finish and keep what was said. */
  stop(): void;
  /** Cancel: the result comes back empty. */
  abort(): void;
}

export interface ListenEvents {
  /** The words so far, as the recogniser hears them. */
  onInterim?: (text: string) => void;
  /** The speaker stopped; the recogniser is working out the final text. */
  onProcessing?: () => void;
}

/**
 * Listens for one answer. Phones differ in how promptly they end a
 * recognition, so this never waits on the browser alone: "done" settles
 * within SETTLE_MS using the final result or, failing that, the last words
 * heard, and nothing runs longer than MAX_LISTEN_MS.
 */
export function listen(events: ListenEvents = {}, lang = 'ca-ES'): Listening {
  const Ctor = ctor();
  if (!Ctor) return { result: Promise.reject(new Error('Speech recognition isn’t available in this browser.')), stop() {}, abort() {} };
  const rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 5;

  let final: string[] = [];
  let interim = '';
  let done = false;
  let settle: ReturnType<typeof setTimeout> | undefined;
  let resolveResult: (heard: string[]) => void = () => {};
  let rejectResult: (err: Error) => void = () => {};
  const result = new Promise<string[]>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const cap = setTimeout(() => stop(), MAX_LISTEN_MS);
  const finish = (heard: string[] | Error) => {
    if (done) return;
    done = true;
    clearTimeout(cap);
    clearTimeout(settle);
    if (heard instanceof Error) rejectResult(heard);
    else resolveResult(heard);
  };
  const heardSoFar = () => (final.length ? final : interim ? [interim] : []);

  rec.onresult = (ev) => {
    for (let r = ev.resultIndex ?? 0; r < ev.results.length; r += 1) {
      const res = ev.results[r];
      if (!res) continue;
      if (res.isFinal) {
        final = Array.from({ length: res.length }, (_, i) => res[i]?.transcript.trim() ?? '').filter(Boolean);
      } else {
        interim = res[0]?.transcript.trim() ?? interim;
        if (interim) events.onInterim?.(interim);
      }
    }
    if (final.length) {
      events.onInterim?.(final[0]!);
      finish(final);
      try {
        rec.abort();
      } catch {
        // already ended
      }
    }
  };
  rec.onspeechend = () => events.onProcessing?.();
  rec.onerror = (ev) => {
    if (ev.error === 'aborted' || ev.error === 'no-speech') return finish(heardSoFar());
    finish(new Error(ERRORS[ev.error] ?? `Speech recognition failed (${ev.error}).`));
  };
  rec.onend = () => finish(heardSoFar());

  function stop(): void {
    if (done) return;
    events.onProcessing?.();
    try {
      rec.stop();
    } catch {
      // not started or already ended
    }
    clearTimeout(settle);
    settle = setTimeout(() => {
      finish(heardSoFar());
      try {
        rec.abort();
      } catch {
        // already ended
      }
    }, SETTLE_MS);
  }

  try {
    rec.start();
  } catch (err) {
    finish(err instanceof Error ? err : new Error(String(err)));
  }
  return {
    result,
    stop,
    abort: () => {
      finish([]);
      try {
        rec.abort();
      } catch {
        // already ended
      }
    },
  };
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

export type HeardMark = 'ok' | 'spelling' | 'miss';

/**
 * Colours what was heard against the closest accepted answer, word by word:
 * a match, a spelling-level miss (accents, ç, l·l), or a word not in the answer.
 */
export function markHeard(pattern: string, text: string): { word: string; mark: HeardMark }[] {
  const target = normalize(checkAnswer(pattern, text).target);
  const exact = new Set(target);
  const loose = new Set(target.map(fold));
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const n = normalize(word)[0] ?? '';
      return { word, mark: exact.has(n) ? 'ok' : loose.has(fold(n)) ? 'spelling' : 'miss' };
    });
}
