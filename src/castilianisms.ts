/**
 * Castilianisms: Castilian-made Catalan.
 *
 * reviewed: false — researched and cited, but not checked by a Catalan speaker.
 *
 * Detection runs in two halves, mirroring the correction engine's own split
 * between certainty in code and judgement in a model:
 *
 *   - This table is matched against the transcript deterministically. These
 *     forms are literal strings, so catching them needs no model to agree, costs
 *     nothing, and cannot be talked out of a verdict.
 *   - The same table seeds the coach's prompt, so the model has the common cases
 *     in front of it and spends its judgement on the ones a list cannot hold:
 *     calqued word order, a Spanish idiom translated whole, a register that is
 *     Catalan word by word and Castilian in shape.
 *
 * Sources:
 *   UPC Serveis Lingüístics, "Construccions incorrectes"
 *     https://www.upc.edu/slt/ca/recursos-redaccio/dubtes-frequents/construccions-incorrectes
 *   Atzucac, "Barbarismes en català: la llista definitiva"
 *     https://atzucac.cat/barbarismes-catala-llista/
 */

export type CastilianismKind = 'lexical' | 'syntactic';

export interface Castilianism {
  /** The form to catch, lowercase, as it would be transcribed. */
  wrong: string;
  /** What to say instead. Several where several are natural. */
  right: string;
  /** One line, shown to the learner. */
  why: string;
  kind: CastilianismKind;
}

/**
 * The syntactic entries matter most. A lexical borrowing announces itself —
 * "vale" is visibly Spanish. A calque does not: "tenir que" is three ordinary
 * Catalan words in an order Catalan does not use, which is exactly what a
 * learner coming from Spanish cannot hear themselves doing.
 */
export const CASTILIANISMS: readonly Castilianism[] = Object.freeze([
  // --- syntactic ---
  {
    wrong: 'tenir que',
    right: 'haver de',
    why: 'Obligation is "haver de" in Catalan. "Tenir que" is the Spanish "tener que".',
    kind: 'syntactic',
  },
  {
    wrong: 'tinc que',
    right: 'he de',
    why: 'Obligation is "haver de": "he de", not "tinc que".',
    kind: 'syntactic',
  },
  {
    wrong: 'tens que',
    right: 'has de',
    why: 'Obligation is "haver de": "has de", not "tens que".',
    kind: 'syntactic',
  },
  {
    wrong: 'hi han',
    right: 'hi ha',
    why: '"Haver-hi" is impersonal and never agrees — "hi ha" even with a plural.',
    kind: 'syntactic',
  },
  {
    wrong: 'hi havien',
    right: 'hi havia',
    why: '"Haver-hi" never agrees in the plural: "hi havia".',
    kind: 'syntactic',
  },
  {
    wrong: 'degut a',
    right: 'per causa de, a causa de, ja que',
    why: '"Degut a" is a calque; Catalan says "a causa de" or "ja que".',
    kind: 'syntactic',
  },
  {
    wrong: 'en quant a',
    right: 'quant a, pel que fa a',
    why: 'The Catalan is "quant a" or "pel que fa a", with no "en".',
    kind: 'syntactic',
  },
  {
    wrong: 'jugar un paper',
    right: 'tenir un paper, fer un paper',
    why: 'Calque of "jugar un papel"; in Catalan a thing "té" or "fa" a paper.',
    kind: 'syntactic',
  },
  {
    wrong: 'lo millor',
    right: 'el millor',
    why: 'Catalan has no neuter article "lo". Use "el".',
    kind: 'syntactic',
  },
  {
    wrong: 'lo mateix',
    right: 'el mateix',
    why: 'Catalan has no neuter article "lo". Use "el".',
    kind: 'syntactic',
  },
  {
    wrong: 'lo que',
    right: 'el que, allò que',
    why: 'Catalan has no neuter article "lo": "el que" or "allò que".',
    kind: 'syntactic',
  },

  // --- lexical ---
  {
    wrong: 'vale',
    right: "d'acord, va bé, entesos",
    why: 'Spanish filler. Catalan agrees with "d’acord" or "va bé".',
    kind: 'lexical',
  },
  {
    wrong: 'bueno',
    right: 'bé, doncs, bon',
    why: 'Spanish filler. Catalan opens with "bé" or "doncs".',
    kind: 'lexical',
  },
  {
    wrong: 'rato',
    right: 'estona',
    why: 'A while is "una estona".',
    kind: 'lexical',
  },
  {
    wrong: 'acera',
    right: 'vorera',
    why: 'The pavement is "la vorera".',
    kind: 'lexical',
  },
  {
    wrong: 'siesta',
    right: 'migdiada',
    why: 'The afternoon nap is "la migdiada".',
    kind: 'lexical',
  },
  {
    wrong: 'juerga',
    right: 'gresca, tabola',
    why: 'A night out is "gresca".',
    kind: 'lexical',
  },
  {
    wrong: 'jefe',
    right: 'cap',
    why: 'The boss is "el cap".',
    kind: 'lexical',
  },
  {
    wrong: 'basura',
    right: 'escombraries',
    why: 'Rubbish is "les escombraries".',
    kind: 'lexical',
  },
  {
    wrong: 'pesadilla',
    right: 'malson',
    why: 'A nightmare is "un malson".',
    kind: 'lexical',
  },
  {
    wrong: 'alfombra',
    right: 'catifa',
    why: 'A rug is "una catifa".',
    kind: 'lexical',
  },
]);

/** Matched form plus the entry it hit. */
export interface CastilianismHit extends Castilianism {
  /** Where it started in the text, so the UI can show it in place. */
  index: number;
  /** The text as it actually appeared, before lowercasing. */
  matched: string;
}

/**
 * Escapes a literal for use inside a RegExp. The table is ours, but it is data,
 * and data with a "." in it should not become a wildcard.
 */
const escape = (literal: string): string => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Letters that may not sit either side of a match.
 *
 * \b is no use here: Catalan words carry accents and ç, which JavaScript's word
 * boundary treats as non-word characters, so \bvale\b would happily fire inside
 * "València". Guarding on letters directly is what keeps "vale" out of "valent"
 * and "rato" out of "barato".
 */
const LETTER = "[\\p{L}\\u2019'-]";

/** Every entry in the table that appears in the text. */
export function findCastilianisms(text: string): CastilianismHit[] {
  const hits: CastilianismHit[] = [];

  for (const entry of CASTILIANISMS) {
    const pattern = new RegExp(
      `(?<!${LETTER})${escape(entry.wrong)}(?!${LETTER})`,
      'giu',
    );
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined) continue;
      hits.push({ ...entry, index: match.index, matched: match[0] });
    }
  }

  return hits.sort((a, b) => a.index - b.index);
}

/** The table as prompt lines, so the coach has the common cases to hand. */
export function castilianismPromptLines(): string {
  return CASTILIANISMS.map((c) => `  ${c.wrong} -> ${c.right}`).join('\n');
}
