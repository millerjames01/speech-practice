import { describe, expect, it } from 'vitest';
import { foldDiacritics, normalizeWord, tokenize, wordsEqual } from '../src/judge/normalize';

describe('normalizeWord', () => {
  it('strips what carries no meaning', () => {
    expect(normalizeWord('Bon dia!')).toBe('bon dia');
    expect(normalizeWord('«Gràcies»')).toBe('gràcies');
  });

  it('never strips accents itself, so normalized comparisons stay exact', () => {
    expect(normalizeWord('adéu')).not.toBe(normalizeWord('adeu'));
    expect(normalizeWord('sóc')).not.toBe(normalizeWord('soc'));
    expect(normalizeWord('cèntims')).not.toBe(normalizeWord('centims'));
  });

  it('treats typographic and ASCII apostrophes as the same character', () => {
    expect(wordsEqual("d'on", 'd’on')).toBe(true);
  });

  it('keeps the apostrophe and hyphen, which are part of the word', () => {
    expect(normalizeWord("l'home")).toBe("l'home");
    expect(normalizeWord('anem-hi')).toBe('anem-hi');
  });
});

describe('tokenize', () => {
  it('drops empty tokens and normalizes each word', () => {
    expect(tokenize('  Un quilo  de tomàquets, si us plau. ')).toEqual([
      'un',
      'quilo',
      'de',
      'tomàquets',
      'si',
      'us',
      'plau',
    ]);
  });
});


describe('foldDiacritics', () => {
  it('drops the accents Catalan writes', () => {
    expect(foldDiacritics('sóc')).toBe('soc');
    expect(foldDiacritics('adéu')).toBe('adeu');
    expect(foldDiacritics('cafè')).toBe('cafe');
    expect(foldDiacritics('veïns')).toBe('veins');
  });

  it('keeps ç, which is a letter and not an accent', () => {
    // plaça and placa are different words; folding them together would be a
    // real loss, unlike an accent the transcriber picked.
    expect(foldDiacritics('plaça')).toBe('plaça');
  });
});

describe('wordsEqual and the 2016 orthography', () => {
  it('forgives an accent the transcriber chose differently', () => {
    // The learner said it right; Scribe wrote the post-2016 spelling.
    expect(wordsEqual('sóc', 'soc')).toBe(true);
    expect(wordsEqual('adéu', 'adeu')).toBe(true);
    // And the reverse, which is just as likely from mixed training data.
    expect(wordsEqual('adeu', 'adéu')).toBe(true);
  });

  it('stays strict on the 15 words where the accent marks a different word', () => {
    expect(wordsEqual('sí', 'si')).toBe(false);
    expect(wordsEqual('és', 'es')).toBe(false);
    expect(wordsEqual('són', 'son')).toBe(false);
    expect(wordsEqual('més', 'mes')).toBe(false);
    expect(wordsEqual('bé', 'be')).toBe(false);
    expect(wordsEqual('té', 'te')).toBe(false);
    expect(wordsEqual('què', 'que')).toBe(false);
    expect(wordsEqual('mà', 'ma')).toBe(false);
  });

  it('still fails a wrong letter, which is not an accent at all', () => {
    // The brief's own example must survive this loosening.
    expect(wordsEqual('setanta', 'setenta')).toBe(false);
    expect(wordsEqual('plaça', 'placa')).toBe(false);
  });

  it('is unaffected for words with no accent either side', () => {
    expect(wordsEqual('quilo', 'quilo')).toBe(true);
    expect(wordsEqual('quilo', 'kilo')).toBe(false);
  });
});
