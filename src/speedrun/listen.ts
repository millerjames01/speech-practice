/**
 * Voice answers: the browser's own speech recognition, in Catalan. Chrome and
 * Edge (desktop and Android) send the audio to their speech service; Safari
 * uses Apple's. Nothing is recorded or stored by the app.
 */

import { checkAnswer, fold, normalize, type CheckResult } from './check';
import { numberToken } from './numbers';
import { expand } from './pattern';

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
  onaudiostart?: (() => void) | null;
  onaudioend?: (() => void) | null;
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
function respellWords(pattern: string, heard: string): string {
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

/**
 * Short words said quickly blur into their neighbours, and the recogniser
 * writes them however it likes: "a les" as "ales" or "als", "de la" as
 * "dela", a lone "a" dropped altogether. This lines what was heard up with an
 * accepted answer by sound, ignoring where the spaces fall:
 *  - groups of up to three words that sound the same joined up are the
 *    answer's words ("ales" → "a les"), and count as a match;
 *  - short words whose consonants match once vowels are set aside ("als" for
 *    "a les") and a dropped one-vowel word ("vaig casa" for "vaig a casa")
 *    are accepted but marked as near misses.
 * The answer may run on past what was heard, so a half-said answer lines up too.
 */
const TINY = new Set(['a', 'i', 'o', 'e', 'y', 'ha', 'hi', 'he', 'ho']);
const MAX_GROUP = 3;
const skeleton = (sound: string) => sound.replace(/[aiu]/g, '');
const isShort = (w: string) => w.length <= 3;

interface Blend {
  tokens: string[];
  /** Indices into tokens accepted loosely (near misses). */
  loose: number[];
  cost: number;
}

function blend(heard: string[], target: string[]): Blend {
  const m = heard.length;
  const n = target.length;
  const hs = heard.map((w) => soundFold(normalize(w)[0] ?? w));
  const ts = target.map(soundFold);
  // best[i][j]: cheapest way to line up target[i..] with heard[j..]
  const best: (Blend | null)[][] = Array.from({ length: n + 1 }, () => Array<Blend | null>(m + 1).fill(null));
  const at = (i: number, j: number): Blend => {
    const memo = best[i]![j];
    if (memo) return memo;
    let out: Blend;
    if (j === m) out = { tokens: [], loose: [], cost: 0 }; // the answer may run on
    else {
      const options: Blend[] = [];
      const push = (rest: Blend, tokens: string[], loose: boolean, cost: number) =>
        options.push({
          tokens: [...tokens, ...rest.tokens],
          loose: [...(loose ? tokens.map((_, k) => k) : []), ...rest.loose.map((k) => k + tokens.length)],
          cost: cost + rest.cost,
        });
      if (i < n) {
        for (let k = 1; k <= MAX_GROUP && j + k <= m; k += 1) {
          const heardSound = hs.slice(j, j + k).join('');
          for (let l = 1; l <= MAX_GROUP && i + l <= n; l += 1) {
            const group = target.slice(i, i + l);
            const sound = ts.slice(i, i + l).join('');
            if (heardSound === sound) push(at(i + l, j + k), group, false, k === 1 && l === 1 ? 0 : 0.1);
            // Only where words merged or split: one word for one is a real choice ("el" or "la").
            else if (k !== l && group.every(isShort) && heardSound.length <= 5 && skeleton(sound) && skeleton(sound) === skeleton(heardSound))
              push(at(i + l, j + k), group, true, 1);
          }
        }
        if (TINY.has(target[i]!)) push(at(i + 1, j), [target[i]!], true, 1.5); // a dropped one-vowel word
        push(at(i + 1, j), [], false, 3); // an answer word not said
      }
      push(at(i, j + 1), [heard[j]!], false, 3); // a heard word not in the answer
      out = options.reduce((a, b) => (b.cost < a.cost ? b : a));
    }
    best[i]![j] = out;
    return out;
  };
  return at(0, 0);
}

/** The first few accepted answers, as words; recognition asks many times a second, so they're kept. */
const answerCache = new Map<string, string[][]>();
function answersOf(pattern: string): string[][] {
  let answers = answerCache.get(pattern);
  if (!answers) {
    answers = expand(pattern).slice(0, 8).map((a) => normalize(a));
    if (answerCache.size > 200) answerCache.clear();
    answerCache.set(pattern, answers);
  }
  return answers;
}

/** What was heard, respelled into the answer's words, with the near misses marked. */
export function respellDetail(pattern: string, heard: string): { text: string; loose: number[] } {
  const words = respellWords(pattern, heard).split(/\s+/).filter(Boolean);
  if (!words.length) return { text: '', loose: [] };
  let pick: Blend | null = null;
  for (const answer of answersOf(pattern)) {
    const b = blend(words, answer);
    if (!pick || b.cost < pick.cost) pick = b;
  }
  // Keep the word-by-word reading when lining up gains nothing.
  if (!pick || pick.cost >= words.length * 3) return { text: words.join(' '), loose: [] };
  return { text: pick.tokens.join(' '), loose: pick.loose };
}

export function respell(pattern: string, heard: string): string {
  return respellDetail(pattern, heard).text;
}

/** A near miss anywhere turns an exact check into a forgiven slip. */
function softened(result: CheckResult, loose: number[]): CheckResult {
  return loose.length && result.verdict === 'exact' ? { ...result, verdict: 'spelling' } : result;
}

/* ---------- one turn at a time ----------
 * On Android, Chrome hands recognition to the system speech service, which is
 * built for one request: it opens the mic, waits for speech, and ends the
 * session itself after a pause (or after a few seconds of silence). Keeping it
 * "continuous" by restarting it makes the mic flicker and drops the first words
 * said during each restart. So a turn is exactly one session: it starts when
 * asked, ends when the speaker pauses, the page calls stop(), or the recogniser
 * gives up, and is never restarted behind the learner's back.
 */

const words = (s: string) => normalize(s).join(' ');

/**
 * Adds a result to what was already heard in this turn. Android sometimes
 * repeats itself: a result may hold the whole utterance so far, repeat the last
 * one, or restate its opening words. Each time the longer reading wins instead
 * of doubling.
 */
export function mergeHeard(sofar: string, next: string): string {
  const a = words(sofar);
  const b = words(next);
  if (!a) return next.trim();
  if (!b) return sofar;
  if (b.startsWith(a)) return next.trim();
  if (a.endsWith(b)) return sofar;
  if (a.startsWith(`${b} `)) return sofar;
  return `${sofar.trim()} ${next.trim()}`;
}

/** Every reading of a turn so far: the earlier results' best guesses, then each guess for the latest. */
export function turnReadings(results: ArrayLike<RecognitionResult>): string[] {
  let before = '';
  let latest: string[] = [];
  for (let i = 0; i < results.length; i += 1) {
    const res = results[i];
    if (!res) continue;
    const alts = Array.from({ length: res.length }, (_, k) => res[k]?.transcript.trim() ?? '').filter(Boolean);
    if (!alts.length) continue;
    if (latest.length) before = mergeHeard(before, latest[0]!);
    latest = alts;
  }
  return [...new Set(latest.map((a) => mergeHeard(before, a)))];
}

export interface TurnEvents {
  /** What has been heard so far in this turn, best reading first. */
  onText: (readings: string[]) => void;
  /** The mic is really open (true) or closed (false): from the recogniser, not from the request. */
  onMic: (open: boolean) => void;
  /** The turn is over, with everything it heard (empty if nothing). */
  onEnd: (readings: string[]) => void;
  onError: (err: Error) => void;
}

export class VoiceTurn {
  private rec: Recognition | null = null;
  private heard: string[] = [];
  private open = false;
  /** Words and phrases the recogniser is nudged toward, where the browser supports it. */
  private phrases: string[] = [];
  private phrasesOff = false;

  constructor(private readonly events: TurnEvents, private readonly lang = 'ca-ES') {}

  /** A turn has been asked for and hasn't ended yet. */
  get running(): boolean {
    return this.rec !== null;
  }

  /** The recogniser has opened the mic. */
  get listening(): boolean {
    return this.open;
  }

  /** Nudges recognition toward the expected answer (Chrome's contextual biasing, where available). */
  hint(phrases: string[]): void {
    this.phrases = [...new Set(phrases.map((p) => p.trim()).filter(Boolean))];
  }

  start(): void {
    if (this.rec) return;
    const Ctor = ctor();
    if (!Ctor) return this.events.onError(new Error('Speech recognition isn’t available in this browser.'));
    const rec = new Ctor();
    rec.lang = this.lang;
    rec.continuous = false;
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
    this.heard = [];
    const setOpen = (open: boolean) => {
      if (rec !== this.rec || this.open === open) return;
      this.open = open;
      this.events.onMic(open);
    };
    rec.onaudiostart = () => setOpen(true);
    rec.onaudioend = () => setOpen(false);
    rec.onresult = (ev) => {
      if (rec !== this.rec) return;
      setOpen(true); // some browsers skip audiostart
      const readings = turnReadings(ev.results);
      if (!readings.length) return;
      this.heard = readings;
      this.events.onText(readings);
    };
    rec.onspeechend = null;
    rec.onerror = (ev) => {
      if (rec !== this.rec) return;
      if (ev.error === 'phrases-not-supported') {
        this.phrasesOff = true;
        return;
      }
      // Silence, or our own stop/abort: the turn just ends with what it has.
      if (ev.error === 'no-speech' || ev.error === 'aborted') return;
      this.finish();
      this.events.onError(new Error(ERRORS[ev.error] ?? `Speech recognition failed (${ev.error}).`));
    };
    rec.onend = () => {
      if (rec !== this.rec) return;
      const heard = this.heard;
      this.finish();
      this.events.onEnd(heard);
    };
    this.rec = rec;
    try {
      rec.start();
    } catch (err) {
      this.finish();
      this.events.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /** Ends the turn and keeps what was heard: onEnd follows once the recogniser has finished. */
  stop(): void {
    try {
      this.rec?.stop();
    } catch {
      // already ending
    }
  }

  /** Ends the turn and throws away what was heard: no onEnd. */
  cancel(): void {
    const rec = this.rec;
    this.finish();
    try {
      rec?.abort();
    } catch {
      // already ended
    }
  }

  private finish(): void {
    this.rec = null;
    if (this.open) {
      this.open = false;
      this.events.onMic(false);
    }
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
    const { text, loose } = respellDetail(pattern, raw);
    const result = softened(checkAnswer(pattern, text), loose);
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
  const detail = respellDetail(pattern, heard);
  return marksFor(detail, checkAnswer(pattern, detail.text));
}

function marksFor({ text, loose }: { text: string; loose: number[] }, check: CheckResult): { word: string; mark: HeardMark }[] {
  const target = normalize(check.target);
  const exact = new Set([...target, ...SUBJECT_PRONOUNS]);
  const sounds = target.map(soundFold);
  const near = new Set(loose);
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word, i) => {
      const n = normalize(word)[0] ?? '';
      if (exact.has(n)) return { word, mark: near.has(i) ? ('spelling' as const) : ('ok' as const) };
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
  const detail = respellDetail(pattern, heard);
  const { text, loose } = detail;
  const checked = checkAnswer(pattern, text);
  const result = softened(checked, loose);
  const marks = marksFor(detail, checked);
  const target = normalize(result.target);
  // A leading subject pronoun the answer leaves optional ("ella és…") doesn't count toward its length.
  const first = normalize(marks[0]?.word ?? '')[0];
  const counted = first && SUBJECT_PRONOUNS.includes(first) && target[0] !== first ? marks.length - 1 : marks.length;
  const near = new Set(loose);
  const onTrack = result.verdict === 'wrong' && counted > 0 && counted < target.length && marks.every((m, i) => m.mark === 'ok' || near.has(i));
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
