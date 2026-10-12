/**
 * Voice answers: the browser's own speech recognition, in Catalan. Chrome and
 * Edge (desktop and Android) send the audio to their speech service; Safari
 * uses Apple's. Nothing is recorded or stored by the app.
 */

import { checkAnswer, fold, normalize, type CheckResult } from './check';
import { numberToken } from './numbers';

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

/**
 * How a word sounds in Central Catalan, roughly: what a recogniser cannot tell
 * apart. Unstressed a/e (and o/u) merge, b = v, h is silent, the p of compte
 * and temps and most final r's are silent, ll and l, ss and s and so on.
 * Only ever compared against the words of the expected answer, so it decides
 * between spellings of the same sound, never between different words.
 */
export function soundFold(word: string): string {
  // ñ is Catalan ny (cuñada / cunyada); do it before accents are stripped.
  return fold(word.toLowerCase().replace(/ñ/g, 'ny'))
    .replace(/'/g, '')
    .replace(/h/g, '')
    .replace(/v/g, 'b')
    .replace(/ç/g, 's')
    .replace(/qu(?=[ei])/g, 'k')
    .replace(/c(?=[ei])/g, 's')
    .replace(/c/g, 'k')
    .replace(/g(?=[ei])/g, 'j')
    .replace(/t[jg]/g, 'j')
    .replace(/[it]x/g, 'x')
    .replace(/z/g, 's')
    .replace(/mpt?(?=s?$)/g, 'm')
    .replace(/mpt/g, 'mt')
    .replace(/nt(?=s?$)/g, 'n')
    .replace(/([aeiou])r(?=s?$)/g, '$1')
    .replace(/[ae]/g, 'a')
    .replace(/[ou]/g, 'u')
    .replace(/(.)\1+/g, '$1');
}

const SUBJECT_PRONOUNS = ['jo', 'tu', 'ell', 'ella', 'nosaltres', 'vosaltres', 'ells', 'elles'];

/**
 * Rewrites what was heard into the answer's spelling wherever a word sounds
 * the same as one in the closest accepted answer ("saps nadar" → "saps
 * nedar", "què veus" → "què beus"). Words that sound different stay as heard.
 */
export function respell(pattern: string, heard: string): string {
  const target = normalize(checkAnswer(pattern, heard).target);
  const targetSet = new Set(target);
  // Digits become words, in whichever form the answer uses ("a les 11:00" → "a les onze").
  const text = heard
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const spellings = numberToken(token.replace(/[.,!?;]+$/, ''));
      if (!spellings) return token;
      return spellings.find((w) => w.split(/\s+/).every((part) => targetSet.has(part))) ?? spellings[0]!;
    })
    .join(' ');
  const bySound = new Map<string, string>();
  for (const w of target) bySound.set(soundFold(w), w);
  const pronouns = new Map(SUBJECT_PRONOUNS.map((w) => [soundFold(w), w]));
  const exact = new Set(target);
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word, i) => {
      const n = normalize(word)[0] ?? word;
      const sound = soundFold(n);
      // An answer may open with an optional subject pronoun: "ells" (or "els",
      // as the recogniser may write it) there is the pronoun, not the article.
      if (i === 0 && target[0] !== n) {
        const pronoun = pronouns.get(sound);
        if (pronoun && !target.includes(pronoun)) return pronoun;
      }
      if (exact.has(n)) return word;
      return bySound.get(sound) ?? pronouns.get(sound) ?? word;
    })
    .join(' ');
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
  for (const raw of heard) {
    const text = respell(pattern, raw);
    const result = checkAnswer(pattern, text);
    if (!best || RANK[result.verdict] < RANK[best.result.verdict]) best = { text, result };
  }
  return best;
}

export type HeardMark = 'ok' | 'spelling' | 'miss';

/** Edit distance, for "close but not the same" words. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cur = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length]!;
}

/**
 * Colours what was heard against the closest accepted answer, word by word:
 * green for a match (sound-alikes are respelled first, so "nadar" shows as
 * "nedar"), yellow for a word one sound away from an answer word ("cars" for
 * "cares"), grey for a word not in the answer.
 */
export function markHeard(pattern: string, heard: string): { word: string; mark: HeardMark }[] {
  const text = respell(pattern, heard);
  const target = normalize(checkAnswer(pattern, text).target);
  const exact = new Set([...target, ...SUBJECT_PRONOUNS]);
  const sounds = target.map(soundFold);
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const n = normalize(word)[0] ?? '';
      if (exact.has(n)) return { word, mark: 'ok' as const };
      const sound = soundFold(n);
      const close = sound.length >= 3 && sounds.some((t) => distance(sound, t) <= 1);
      return { word, mark: close ? ('spelling' as const) : ('miss' as const) };
    });
}

export interface VoiceProgress {
  /** The attempt as respelled, and its check against the answer. */
  text: string;
  result: CheckResult;
  marks: { word: string; mark: HeardMark }[];
  /** Every word so far is right, and the answer has more to come: worth waiting for. */
  onTrack: boolean;
}

/** Where a spoken attempt stands: right, on track (right so far, unfinished), or off. */
export function voiceProgress(pattern: string, heard: string): VoiceProgress {
  const text = respell(pattern, heard);
  const result = checkAnswer(pattern, text);
  const marks = markHeard(pattern, heard);
  const target = normalize(result.target);
  // A leading subject pronoun the answer leaves optional ("ella és…") doesn't count toward its length.
  const first = normalize(marks[0]?.word ?? '')[0];
  const counted = first && SUBJECT_PRONOUNS.includes(first) && target[0] !== first ? marks.length - 1 : marks.length;
  const onTrack = result.verdict === 'wrong' && counted > 0 && counted < target.length && marks.every((m) => m.mark === 'ok');
  return { text, result, marks, onTrack };
}

export type VoiceState = 'right' | 'onTrack' | 'off';

/** Right (accept), on track (right so far: the speaker may be thinking), or off (a wrong word). */
export const voiceState = (p: VoiceProgress): VoiceState => (p.result.verdict !== 'wrong' ? 'right' : p.onTrack ? 'onTrack' : 'off');

/**
 * The best reading among the recogniser's guesses: each as a continuation of
 * what was already heard, or as a fresh start (the speaker began the sentence
 * again: "som professors… som estudiants"). Ties go to the continuation.
 */
export function bestProgress(pattern: string, carried: string, heard: string[]): VoiceProgress | null {
  const rank = (p: VoiceProgress) => (p.result.verdict === 'exact' ? 0 : p.result.verdict === 'spelling' ? 1 : p.onTrack ? 2 : 3);
  let best: VoiceProgress | null = null;
  for (const h of heard) {
    const readings = carried ? [`${carried} ${h}`, h] : [h];
    for (const r of readings) {
      const p = voiceProgress(pattern, r.trim());
      if (!best || rank(p) < rank(best)) best = p;
    }
  }
  return best;
}
