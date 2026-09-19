/**
 * Normalization for comparing what was said against what should have been.
 *
 * The rule the whole product rests on: we strip only what carries no meaning -
 * case, punctuation, whitespace. Accents and diacritics are NEVER stripped,
 * because in Catalan they are the word. "setanta" must fail against "setenta",
 * and "si us plau" must not be quietly accepted as "sí us plau".
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

/** Exact match after normalization. Deliberately unforgiving. */
export function wordsEqual(a: string, b: string): boolean {
  return normalizeWord(a) === normalizeWord(b);
}
