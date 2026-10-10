/**
 * Checking typed translations.
 *
 * Words are never forgiven: a wrong, missing or extra word fails. Spelling is
 * the one place this mode is lenient (by design choice for the speedrun):
 * accents, ç, l·l and hyphens that are off still pass, but as a "spelling
 * slip" that shows the correct form, so the learner sees it every time.
 */

import { diffWords } from '../judge/diff';
import { expand } from './pattern';

export type Verdict = 'exact' | 'spelling' | 'wrong';

export interface WordMark {
  word: string;
  /** ok: correct; spelling: right word, off spelling; wrong: wrong or missing. */
  mark: 'ok' | 'spelling' | 'wrong';
}

export interface CheckResult {
  verdict: Verdict;
  /** The accepted answer the input was judged against, as written. */
  target: string;
  /** The target, word by word, marked against the input. */
  marks: WordMark[];
  /** Words the learner typed that are not in the target. */
  extra: string[];
}

/**
 * Pre-2017 diacritics the IEC dropped, plus the long perifràstic forms. The
 * content follows the current norm, but these are correct (just older or
 * regional) and pass silently rather than as slips.
 */
const SYNONYMS: Record<string, string> = {
  'sóc': 'soc',
  'dóna': 'dona',
  'dónes': 'dones',
  'vénen': 'venen',
  'véns': 'vens',
  'fóra': 'fora',
  'móra': 'mora',
  'vés': 'ves',
  'adéu': 'adeu',
  'féu': 'feu',
  'vàrem': 'vam',
  'vàreu': 'vau',
  'varen': 'van',
  'vares': 'vas',
};

const SUBJECT_PRONOUNS = new Set([
  'jo', 'tu', 'ell', 'ella', 'nosaltres', 'vosaltres', 'ells', 'elles', 'vostè', 'vostès',
]);

const PUNCTUATION = /[.,!?;:"«»“”()\[\]¿¡…]/g;

/** Strips only what carries no meaning: case, punctuation, spacing, quote style. */
export function normalize(text: string): string[] {
  return text
    .normalize('NFC')
    .toLowerCase()
    // People type l·l as l.l or l-l; keep it a geminate, not a full stop.
    .replace(/l[.\-‧⋅]l/g, 'l·l')
    .replace(/[‘’`´]/g, "'")
    .replace(/[‑–—]/g, '-')
    .replace(PUNCTUATION, ' ')
    .split(/\s+/)
    .filter(Boolean)
    // Hyphenated forms carry old spellings too: vés-te'n.
    .map((w) => w.split('-').map((part) => SYNONYMS[part] ?? part).join('-'));
}

/** Spelling-blind form of one word: no accents, ç → c, l·l → ll, no hyphens. */
export function fold(word: string): string {
  return word
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/·/g, '')
    .replace(/-/g, '');
}

const foldAll = (words: string[]): string[] =>
  // Hyphens join words in Catalan (dona-m'ho); a missing hyphen is a slip, so
  // compare the joined form.
  [words.map(fold).join('')];

const join = (words: string[]): string => words.join(' ');

/** Candidate readings of the input: as typed, and without a leading subject pronoun. */
function readings(input: string[], target: string[]): string[][] {
  const out = [input];
  const first = input[0];
  if (first && SUBJECT_PRONOUNS.has(first) && target[0] !== first) out.push(input.slice(1));
  return out;
}

function markAgainst(
  target: string,
  input: string[],
  verdict: Verdict,
): Omit<CheckResult, 'verdict' | 'target'> {
  const display = target.split(/\s+/).filter(Boolean);
  const expected = normalize(target);
  // Display words and normalized words line up unless punctuation stood alone.
  const shown = display.length === expected.length ? display : expected;

  const diff = diffWords(expected.map(fold), input.map(fold));
  const marks: WordMark[] = [];
  const extra: string[] = [];
  let ei = 0;
  for (const d of diff) {
    if (d.status === 'extra') {
      extra.push(input[d.heardIndex!] ?? d.heard ?? '');
      continue;
    }
    const word = shown[ei] ?? d.expected ?? '';
    if (d.status === 'match') {
      const exact = expected[ei] === input[d.heardIndex!];
      marks.push({ word, mark: exact ? 'ok' : 'spelling' });
    } else {
      marks.push({ word, mark: 'wrong' });
    }
    ei += 1;
  }
  // A spelling verdict means the letters all match once folded; any word the
  // diff could not pair up was split or joined by a hyphen, not wrong.
  if (verdict === 'spelling') {
    return { marks: marks.map((m) => (m.mark === 'wrong' ? { ...m, mark: 'spelling' } : m)), extra: [] };
  }
  return { marks, extra };
}

export function checkAnswer(pattern: string, typed: string): CheckResult {
  const answers = expand(pattern);
  const input = normalize(typed);

  // 1. Exact (after normalization) against any accepted answer.
  for (const answer of answers) {
    const target = normalize(answer);
    for (const r of readings(input, target)) {
      if (join(r) === join(target)) {
        return { verdict: 'exact', target: answer, ...markAgainst(answer, r, 'exact') };
      }
    }
  }

  // 2. Same words, spelling off.
  for (const answer of answers) {
    const target = normalize(answer);
    for (const r of readings(input, target)) {
      if (join(foldAll(r)) === join(foldAll(target))) {
        return { verdict: 'spelling', target: answer, ...markAgainst(answer, r, 'spelling') };
      }
    }
  }

  // 3. Wrong: judge against the closest accepted answer, so the learner who
  //    aimed at a shorter valid phrasing is shown that one.
  let best: { answer: string; reading: string[]; errors: number } | null = null;
  for (const answer of answers) {
    const target = normalize(answer);
    for (const r of readings(input, target)) {
      const errors = diffWords(target.map(fold), r.map(fold)).filter(
        (d) => d.status !== 'match',
      ).length;
      if (!best || errors < best.errors) best = { answer, reading: r, errors };
    }
  }
  const chosen = best ?? { answer: answers[0] ?? '', reading: input };
  return { verdict: 'wrong', target: chosen.answer, ...markAgainst(chosen.answer, chosen.reading, 'wrong') };
}
