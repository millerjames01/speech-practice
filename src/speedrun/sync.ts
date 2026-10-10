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
