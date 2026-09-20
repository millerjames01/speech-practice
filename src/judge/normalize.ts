/**
 * Normalization for comparing what was said against what should have been.
 *
 * We strip only what carries no meaning - case, punctuation, whitespace.
 * "setanta" must fail against "setenta": those differ by a letter, and a letter
 * is the word.
 *
 * Accents are the subtle case. `normalizeWord` never strips them, so anything
 * comparing normalized strings stays exact. But the app judges SPEECH through a
 * transcript, and the transcriber chooses the spelling from training data
 * spanning both sides of the 2016 IEC reform - which cut diacritics from about
 * 150 words to 15. It can write "soc" where a unit says "sóc", or the reverse,
 * without the learner having said anything different.
 *
 * So `wordsEqual` ignores an accent-only difference EXCEPT on the 15 words
 * where Catalan still uses the accent to tell two words apart. There the
 * distinction is real and stays strict.
 */

/** Punctuation and the quote marks Scribe tends to emit, but not apostrophes. */
const PUNCTUATION = /[.,!?;:"\u00ab\u00bb\u201c\u201d()\[\]\u00bf\u00a1\u2026]/g;

export function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(PUNCTUATION, '')
    // Catalan elides with an apostrophe (l'home) and joins with a hyphen
    // (anem-hi). Both are part of the word, but the typographic apostrophe and
    // the ASCII one must compare equal.
    .replace(/[\u2018\u2019'`\u00b4]/g, "'")
    .replace(/[-‑–—]/g, '-')
    .trim();
}

export function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map(normalizeWord)
    .filter((w) => w.length > 0);
}

export function normalizeText(text: string): string {
  return tokenize(text).join(' ');
}

/**
 * The 15 words that keep a diacritic under the 2016 IEC orthography, as their
 * accentless counterparts. An accent difference on any of these is a different
 * word, not a spelling choice.
 */
const DIACRITIC_SENSITIVE = new Set([
  'be', 'deu', 'es', 'ma', 'mes', 'mon', 'pel', 'que',
  'se', 'si', 'sol', 'son', 'te', 'us', 'vos',
]);

/**
 * Drops accents while keeping ç, which is not an accent: "plaça" and "placa"
 * are different words and must not be folded together.
 */
export function foldDiacritics(word: string): string {
  return word
    .normalize('NFD')
    // Grave, acute, diaeresis - every accent Catalan writes (à è é í ï ò ó ú ü).
    // Deliberately NOT the cedilla (U+0327): ç is a letter, not an accent.
    .replace(/[\u0300\u0301\u0308]/g, '')
    .normalize('NFC');
}

/**
 * Match after normalization, forgiving an accent-only difference except where
 * Catalan uses the accent to distinguish words.
 */
export function wordsEqual(a: string, b: string): boolean {
  const left = normalizeWord(a);
  const right = normalizeWord(b);
  if (left === right) return true;

  const foldedLeft = foldDiacritics(left);
  const foldedRight = foldDiacritics(right);
  if (foldedLeft !== foldedRight) return false;

  // Same letters, different accents. Real distinction, or spelling drift?
  return !DIACRITIC_SENSITIVE.has(foldedLeft);
}
