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

/** Contextual biasing (SpeechRecognitionPhrase), so far only in recent Chrome. */
function canBias(): boolean {
  return typeof window !== 'undefined' && 'SpeechRecognitionPhrase' in window;
}

/** How strongly hints are favoured: about e^2.5 ≈ 12× more likely; high values make the recogniser hear them everywhere. */
const PHRASE_BOOST = 2.5;

/** Hints for one answer: its accepted wordings (a few) and their words. */
export function voiceHints(variants: string[]): string[] {
  const phrases = variants.slice(0, 3).map((v) => v.replace(/[.,!?;:¿¡…«»"]/g, '').trim());
  const words = phrases.flatMap((p) => p.split(/\s+/));
  return [...new Set([...phrases, ...words])].filter(Boolean).slice(0, 40);
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
 * What recognisers write for short, unstressed words said alone or quickly:
 * "el" comes back as "heu" or "hel", "i" as "hi" or "y". These count as the
 * answer's word when the answer has it and the heard word isn't in the answer
 * itself. Kept to pairs that are never a real choice between two answers.
 */
export const MISHEARD: Record<string, string[]> = {
  el: ['heu', 'hel', 'l'],
  els: ['hels', 'heus', 'eus', 'ls'],
  la: ['l'],
  i: ['hi', 'y', 'ii'],
  hi: ['i', 'y'],
  a: ['ha', 'ah'],
  ha: ['a', 'ah'],
  de: ['d'],
  que: ['k'],
  un: ['hum', 'um'],
  en: ['n'],
};

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
  // Known mis-hearings of short words, where they don't clash with another answer word.
  for (const w of target) for (const m of MISHEARD[w] ?? []) if (!bySound.has(soundFold(m)) && !targetSet.has(m)) bySound.set(soundFold(m), w);
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
      if (i === 0 && target[0] !== n && soundFold(target[0] ?? '') !== sound) {
        const pronoun = pronouns.get(sound);
        if (pronoun && !target.includes(pronoun)) return pronoun;
      }
      if (exact.has(n)) return word;
      return bySound.get(sound) ?? pronouns.get(sound) ?? word;
    })
    .join(' ');
}

/* ---------- continuous listening ---------- */

const words = (s: string) => normalize(s).join(' ');

/**
 * Adds a final result to what was already heard. Android repeats itself in
 * continuous mode: a final result may hold the whole utterance so far, or
 * repeat the last one. Either way the longer reading wins instead of doubling.
 */
export function mergeHeard(sofar: string, next: string): string {
  const a = words(sofar);
  const b = words(next);
  if (!a) return next.trim();
  if (!b) return sofar;
  if (b.startsWith(a)) return next.trim();
  if (a.endsWith(b)) return sofar;
  return `${sofar.trim()} ${next.trim()}`;
}

export interface StreamEvents {
  /** Everything heard since the last reset: the recogniser's readings, best first. */
  onText: (candidates: string[]) => void;
  onState?: (on: boolean) => void;
  onError?: (err: Error) => void;
}

/**
 * One recognition that stays open across pauses and across items, so the mic
 * doesn't switch off and on with every phrase. reset() starts a new attempt
 * without restarting anything. Browsers still end a continuous recognition
 * after a long silence (Android after several seconds); it is restarted at once,
 * keeping what was heard.
 */
export class VoiceStream {
  private rec: Recognition | null = null;
  private on = false;
  /** Index in the current recognition's results where the current attempt starts. */
  private base = 0;
  private seen = 0;
  /** Final text of the current attempt from before a restart. */
  private carried = '';
  private finals = '';
  private restarts: number[] = [];
  /** Words and phrases the recogniser is nudged toward, where the browser supports it. */
  private phrases: string[] = [];
  private phrasesOff = false;

  constructor(private readonly events: StreamEvents, private readonly lang = 'ca-ES') {}

  get active(): boolean {
    return this.on;
  }

  start(): void {
    if (this.on) return;
    this.on = true;
    this.carried = '';
    this.finals = '';
    this.restarts = [];
    this.spawn();
    this.events.onState?.(true);
  }

  stop(): void {
    if (!this.on && !this.rec) return;
    this.on = false;
    const rec = this.rec;
    this.rec = null;
    try {
      rec?.abort();
    } catch {
      // already ended
    }
    this.events.onState?.(false);
  }

  /**
   * Nudges recognition toward the expected answer (Chrome's contextual
   * biasing, where available; other browsers ignore it). New hints apply from
   * the next recognition, so an open one is restarted quietly to pick them up.
   */
  hint(phrases: string[]): void {
    const next = [...new Set(phrases.map((p) => p.trim()).filter(Boolean))];
    if (next.join('|') === this.phrases.join('|')) return;
    this.phrases = next;
    if (!this.on || !this.rec || !canBias() || this.phrasesOff) return;
    this.carried = '';
    try {
      this.rec.stop(); // onend reopens it with the new phrases
    } catch {
      // already ending
    }
  }

  /** Starts a new attempt: what was heard so far is set aside. */
  reset(): void {
    this.base = this.seen;
    this.carried = '';
    this.finals = '';
  }

  private spawn(): void {
    const Ctor = ctor();
    if (!Ctor) return this.fail(new Error('Speech recognition isn’t available in this browser.'));
    const rec = new Ctor();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 5;
    if (this.phrases.length && canBias() && !this.phrasesOff) {
      try {
        const Phrase = (window as unknown as { SpeechRecognitionPhrase: new (p: string, boost: number) => unknown }).SpeechRecognitionPhrase;
        (rec as unknown as { phrases: unknown[] }).phrases = this.phrases.map((p) => new Phrase(p, PHRASE_BOOST));
      } catch {
        this.phrasesOff = true;
      }
    }
    this.base = 0;
    this.seen = 0;
    this.finals = this.carried;
    rec.onresult = (ev) => {
      if (rec !== this.rec) return;
      this.seen = ev.results.length;
      let acc = this.carried;
      let candidates: string[] = [];
      for (let i = this.base; i < ev.results.length; i += 1) {
        const res = ev.results[i];
        if (!res) continue;
        const alts = Array.from({ length: res.length }, (_, k) => res[k]?.transcript.trim() ?? '').filter(Boolean);
        if (!alts.length) continue;
        const before = acc;
        // Each reading as a continuation, then on its own: the speaker may have
        // started the sentence again ("ella és professora… ella és metgessa").
        candidates = [...alts.map((a) => mergeHeard(before, a)), ...(before ? alts : [])];
        if (res.isFinal) acc = mergeHeard(acc, alts[0]!);
      }
      this.finals = acc;
      if (candidates.length) this.events.onText([...new Set(candidates)]);
    };
    rec.onspeechend = null;
    rec.onerror = (ev) => {
      if (rec !== this.rec) return;
      if (ev.error === 'no-speech' || ev.error === 'aborted') return; // onend restarts
      if (ev.error === 'phrases-not-supported') {
        this.phrasesOff = true; // onend reopens without them
        return;
      }
      this.fail(new Error(ERRORS[ev.error] ?? `Speech recognition failed (${ev.error}).`));
    };
    rec.onend = () => {
      if (rec !== this.rec || !this.on) return;
      // The browser closed it (a long silence, a time limit): reopen, keeping the words.
      const now = Date.now();
      this.restarts = [...this.restarts.filter((t) => now - t < 5000), now];
      if (this.restarts.length > 6) return this.fail(new Error('Speech recognition keeps stopping. Tap the mic to try again.'));
      this.carried = this.finals;
      this.spawn();
    };
    this.rec = rec;
    try {
      rec.start();
    } catch (err) {
      this.fail(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private fail(err: Error): void {
    this.stop();
    this.events.onError?.(err);
  }
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
