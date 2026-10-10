/**
 * Device-to-device sync without a server: progress is packed into a short
 * code (compact text, deflate, base64url) that travels inside a link. Send it
 * any way you already move things between devices; the receiving device
 * merges it, keeping the newest state of every item, so syncing in both
 * directions in any order converges on the same progress.
 */

import type { LessonRecord } from './progress';
import { DAY, startOfDay, type SrsCard } from './srs';

export interface SyncPayload {
  createdAt: number;
  lessons: Record<string, LessonRecord>;
  cards: SrsCard[];
}

const PREFIX = 'ca1.';
const MINUTE = 60_000;
const HOUR = 3_600_000;

/* ---------- bytes ---------- */

async function deflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/* ---------- encoding ----------
 * v1|<base: start of export day, epoch minutes>|<lessons>|<cards>
 * lesson: id:bestSeconds:scorePercent:runs
 * card:   lessonId.index.step.dueDays.lapses.lastHours   (relative to base; due is always
 *         a midnight, last answer keeps hour precision so same-day merges order correctly)
 */

export async function encodeSync(
  lessons: Record<string, LessonRecord>,
  cards: SrsCard[],
  now = Date.now(),
): Promise<string> {
  const base = startOfDay(now);
  const days = (t: number) => Math.round((t - base) / DAY);
  const hours = (t: number) => Math.floor((t - base) / HOUR);
  const ls = Object.entries(lessons)
    .map(([id, r]) => `${id}:${Math.round(r.bestMs / 1000)}:${Math.round(r.bestScore * 100)}:${r.runs}`)
    .join(',');
  const cs = cards
    .map((c) => `${c.lessonId}.${c.index}.${c.step}.${days(c.due)}.${c.lapses}.${c.last ? hours(c.last) : ''}`)
    .join(',');
  const text = `v1|${Math.round(base / MINUTE)}|${ls}|${cs}`;
  return PREFIX + toBase64Url(await deflate(text));
}

/** Pulls the code out of whatever was pasted: a full link, a #sync= hash, or the bare code. */
export function extractCode(input: string): string | null {
  const match = input.trim().match(/ca1\.[A-Za-z0-9_-]+/);
  return match ? match[0] : null;
}

export async function decodeSync(input: string): Promise<SyncPayload> {
  const code = extractCode(input);
  if (!code) throw new Error('That is not a Speedrun sync link or code.');
  let text: string;
  try {
    text = await inflate(fromBase64Url(code.slice(PREFIX.length)));
  } catch {
    throw new Error('The sync code is incomplete or damaged. Copy the whole link and try again.');
  }
  const [version, baseRaw, ls = '', cs = ''] = text.split('|');
  const baseMin = Number(baseRaw);
  if (version !== 'v1' || !Number.isFinite(baseMin)) throw new Error('This sync code is from a newer or unknown version.');
  const base = baseMin * MINUTE;
  const at = (d: string) => base + Number(d) * DAY;

  const lessons: Record<string, LessonRecord> = {};
  for (const part of ls ? ls.split(',') : []) {
    const [id, sec, pct, runs] = part.split(':');
    if (!id || [sec, pct, runs].some((n) => !Number.isFinite(Number(n)))) throw new Error('The sync code is damaged.');
    lessons[id] = { bestMs: Number(sec) * 1000, bestScore: Number(pct) / 100, runs: Number(runs) };
  }
  const cards: SrsCard[] = [];
  for (const part of cs ? cs.split(',') : []) {
    const [lessonId, index, step, due, lapses, last] = part.split('.');
    if (!lessonId || [index, step, due, lapses].some((n) => !Number.isFinite(Number(n)))) {
      throw new Error('The sync code is damaged.');
    }
    cards.push({
      lessonId,
      index: Number(index),
      step: Number(step),
      due: at(due!),
      lapses: Number(lapses),
      ...(last ? { last: base + Number(last) * HOUR } : {}),
    });
  }
  return { createdAt: base, lessons, cards };
}

/* ---------- merging ---------- */

/** The newer of two states of one card: last answered, then furthest scheduled, then higher step. */
export function newerCard(a: SrsCard, b: SrsCard): SrsCard {
  const la = a.last ?? 0;
  const lb = b.last ?? 0;
  if (la !== lb) return la > lb ? a : b;
  if (a.due !== b.due) return a.due > b.due ? a : b;
  return a.step >= b.step ? a : b;
}

export function mergeLessons(a: LessonRecord | undefined, b: LessonRecord): LessonRecord {
  if (!a) return b;
  return { bestMs: Math.min(a.bestMs, b.bestMs), bestScore: Math.max(a.bestScore, b.bestScore), runs: Math.max(a.runs, b.runs) };
}

/* ---------- short codes via dpaste.com ----------
 * dpaste is a free, anonymous paste service that allows cross-origin requests,
 * so a browser can store the sync payload there and fetch it back with a short
 * id. Pastes expire after a day; the link flow above stays as the offline and
 * no-third-party fallback.
 */

const PASTE_API = 'https://dpaste.com/api/v2/';
const PASTE_RAW = (id: string) => `https://dpaste.com/${id}.txt`;
const MAX_PASTE = 200_000;

/** Upper-cases and strips separators, so "au4-dfn hwn" reads as "AU4DFNHWN". */
export function normalizeShortCode(input: string): string | null {
  const id = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z0-9]{6,12}$/.test(id) ? id : null;
}

/** Groups a code in threes for reading aloud or typing: AU4-DFN-HWN. */
export const formatShortCode = (id: string): string => id.match(/.{1,3}/g)?.join('-') ?? id;

export async function uploadSync(code: string, fetchFn: typeof fetch = fetch): Promise<string> {
  let res: Response;
  try {
    res = await fetchFn(PASTE_API, {
      method: 'POST',
      body: new URLSearchParams({ content: code, syntax: 'text', expiry_days: '1', title: 'catalan-speedrun' }),
    });
  } catch {
    throw new Error('Couldn’t reach the sync service. Check your connection, or use a link instead.');
  }
  if (!res.ok) throw new Error(`The sync service refused the upload (${res.status}). Try again in a minute, or use a link.`);
  const id = (await res.text()).match(/dpaste\.com\/([A-Za-z0-9]+)/)?.[1];
  const normalized = id ? normalizeShortCode(id) : null;
  if (!normalized) throw new Error('The sync service sent an unexpected reply. Use a link instead.');
  return normalized;
}

export async function downloadSync(input: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const id = normalizeShortCode(input);
  if (!id) throw new Error('That doesn’t look like a sync code. It has 9 letters and numbers, like AU4-DFN-HWN.');
  let res: Response;
  try {
    res = await fetchFn(PASTE_RAW(id));
  } catch {
    throw new Error('Couldn’t reach the sync service. Check your connection, or use a link instead.');
  }
  if (res.status === 404) throw new Error('No progress found for that code. Codes expire after a day — get a fresh one.');
  if (!res.ok) throw new Error(`The sync service answered ${res.status}. Try again, or use a link.`);
  const text = await res.text();
  if (text.length > MAX_PASTE || !extractCode(text)) throw new Error('That code doesn’t hold Speedrun progress.');
  return text;
}
