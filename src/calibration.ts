/**
 * Per-word calibration history.
 *
 * Every attempt's per-word loss and logprob is kept, so that over a few
 * sessions the app can show which words and sounds you consistently miss, and
 * so thresholds can be tuned to your voice and mic rather than to defaults.
 */

import { CALIBRATION_STORE, withStore } from './audio/db';
import type { JudgedWord, Verdict } from './judge/types';

export interface CalibrationEntry {
  id?: number;
  word: string;
  verdict: Verdict;
  alignmentLoss?: number;
  logprob?: number;
  isFocus: boolean;
  at: number;
}

export async function recordAttempt(words: JudgedWord[]): Promise<void> {
  const at = Date.now();
  for (const word of words) {
    const expected = word.signal.expected;
    if (!expected) continue;
    const entry: CalibrationEntry = {
      word: expected,
      verdict: word.verdict,
      isFocus: word.signal.isFocus,
      at,
    };
    if (word.signal.alignmentLoss !== undefined) entry.alignmentLoss = word.signal.alignmentLoss;
    if (word.signal.logprob !== undefined) entry.logprob = word.signal.logprob;
    await withStore(CALIBRATION_STORE, 'readwrite', (s) => s.add(entry)).catch(() => {
      // Calibration is a nice-to-have; never fail an attempt over it.
    });
  }
}

export async function allEntries(): Promise<CalibrationEntry[]> {
  return withStore<CalibrationEntry[]>(CALIBRATION_STORE, 'readonly', (s) =>
    s.getAll() as IDBRequest<CalibrationEntry[]>,
  ).catch(() => []);
}

export interface WordStat {
  word: string;
  attempts: number;
  failures: number;
  meanLoss?: number;
}

/** The words you miss most often, worst first. */
export async function troubleWords(limit = 15): Promise<WordStat[]> {
  const entries = await allEntries();
  const byWord = new Map<string, CalibrationEntry[]>();
  for (const e of entries) {
    const list = byWord.get(e.word) ?? [];
    list.push(e);
    byWord.set(e.word, list);
  }

  const stats: WordStat[] = [];
  for (const [word, list] of byWord) {
    const failures = list.filter((e) => e.verdict !== 'pass').length;
    if (failures === 0) continue;
    const losses = list.map((e) => e.alignmentLoss).filter((l): l is number => l !== undefined);
    const stat: WordStat = { word, attempts: list.length, failures };
    if (losses.length > 0) {
      stat.meanLoss = losses.reduce((a, b) => a + b, 0) / losses.length;
    }
    stats.push(stat);
  }

  return stats
    .sort((a, b) => b.failures / b.attempts - a.failures / a.attempts || b.failures - a.failures)
    .slice(0, limit);
}
