import { describe, expect, it } from 'vitest';
import { normalizeWord, tokenize, wordsEqual } from '../src/judge/normalize';

describe('normalizeWord', () => {
  it('strips what carries no meaning', () => {
    expect(normalizeWord('Bon dia!')).toBe('bon dia');
    expect(normalizeWord('«Gràcies»')).toBe('gràcies');
  });

  it('never strips accents, because in Catalan they are the word', () => {
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
