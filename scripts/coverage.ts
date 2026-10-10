/**
 * 80/20 audit for the Speedrun content against a word-frequency list.
 *
 *   npm run coverage -- path/to/ca_50k.txt [--top 1000] [--rare 8000]
 *
 * The list is one "word count" pair per line, most frequent first, such as
 * FrequencyWords' ca_50k.txt (OpenSubtitles, CC BY-SA 4.0 — not committed).
 *
 * It reports what share of running speech the course's words cover, which of
 * the most frequent words the course never uses, and which course words are
 * rare enough to be spending the learner's time badly.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expand } from '../src/speedrun/pattern';
import { parseSpeedrunFile } from '../src/speedrun/schema';

const args = process.argv.slice(2);
const listPath = args.find((a) => !a.startsWith('--'));
const opt = (name: string, fallback: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
if (!listPath) {
  console.error('Usage: npm run coverage -- path/to/ca_50k.txt [--top 1000] [--rare 8000]');
  process.exit(1);
}
const TOP = opt('top', 1000);
const RARE = opt('rare', 8000);

// Frequency list: rank and count per word.
const rank = new Map<string, number>();
const count = new Map<string, number>();
let total = 0;
readFileSync(listPath, 'utf8')
  .split('\n')
  .forEach((line) => {
    const [word, n] = line.trim().split(/\s+/);
    if (!word || !n) return;
    rank.set(word, rank.size + 1);
    count.set(word, Number(n));
    total += Number(n);
  });

/** Split like the subtitle list does: on spaces, apostrophes and hyphens. */
const words = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/l·l/g, 'l·l')
    .split(/[^a-zàèéíïòóúüç·]+/)
    .filter((w) => w.length > 0);

// Every Catalan word the course shows: answers (all variants), tables, vocab.
const dir = join(import.meta.dirname, '..', 'speedrun');
const where = new Map<string, Set<string>>();
const note = (text: string, id: string) => {
  for (const w of words(text)) {
    if (!where.has(w)) where.set(w, new Set());
    where.get(w)!.add(id);
  }
};
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const parsed = parseSpeedrunFile(JSON.parse(readFileSync(join(dir, file), 'utf8')));
  for (const lesson of parsed.lessons) {
    for (const [, ca] of lesson.items) for (const a of expand(ca)) note(a, lesson.id);
    for (const t of lesson.tables ?? []) for (const row of t.rows) row.slice(1).forEach((c) => note(c, lesson.id));
    for (const [ca] of lesson.vocab ?? []) note(ca, lesson.id);
  }
}

const covered = [...where.keys()].reduce((s, w) => s + (count.get(w) ?? 0), 0);
console.log(`Course uses ${where.size} distinct word forms.`);
console.log(`Coverage of running speech: ${((covered / total) * 100).toFixed(1)}% of all tokens.\n`);

for (const n of [100, 300, 500, 1000, 2000]) {
  const top = [...rank.entries()].filter(([, r]) => r <= n).map(([w]) => w);
  const hit = top.filter((w) => where.has(w)).length;
  console.log(`Top ${String(n).padStart(4)}: ${hit}/${n} used (${Math.round((hit / n) * 100)}%)`);
}

const missing = [...rank.entries()]
  .filter(([w, r]) => r <= TOP && !where.has(w))
  .map(([w, r]) => `${w}(${r})`);
console.log(`\nMissing from the top ${TOP} (${missing.length}):\n${missing.join(' ')}`);

const rare = [...where.entries()]
  .map(([w, ids]) => ({ w, r: rank.get(w) ?? Infinity, ids: [...ids].join(',') }))
  .filter((x) => x.r > RARE)
  .sort((a, b) => b.r - a.r);
console.log(`\nCourse words ranked below ${RARE} (${rare.length}):`);
for (const x of rare) console.log(`  ${x.w.padEnd(18)} ${x.r === Infinity ? 'not in list' : x.r}  ${x.ids}`);
