import { describe, expect, it } from 'vitest';
import { timeRangeForChars, wordSpans } from '../src/audio/wordaudio';
import type { CharacterAlignment } from '../src/api/elevenlabs';

describe('wordSpans', () => {
  it('gives the character range of each token', () => {
    expect(wordSpans('Bon dia')).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
    ]);
  });

  it('keeps punctuation with its word, so the slice does not clip early', () => {
    const spans = wordSpans('Un quilo de tomàquets, si us plau');
    expect(spans).toHaveLength(7);
    expect('Un quilo de tomàquets, si us plau'.slice(spans[3]!.start, spans[3]!.end)).toBe(
      'tomàquets,',
    );
  });

  it('is unbothered by runs of whitespace', () => {
    expect(wordSpans('  Bon   dia  ')).toEqual([
      { start: 2, end: 5 },
      { start: 8, end: 11 },
    ]);
  });

  it('returns nothing for empty text', () => {
    expect(wordSpans('   ')).toEqual([]);
  });
});

describe('timeRangeForChars', () => {
  // "Bon dia" - one entry per character, a tenth of a second each.
  const alignment: CharacterAlignment = {
    characters: [...'Bon dia'],
    startSeconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
    endSeconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
  };

  it('spans the first character through the last', () => {
    expect(timeRangeForChars(alignment, 0, 3)).toEqual({ start: 0, end: 0.3 });
  });

  it('locates a word in the middle of the line', () => {
    expect(timeRangeForChars(alignment, 4, 7)).toEqual({ start: 0.4, end: 0.7 });
  });

  it('clamps a range running past the end rather than returning nonsense', () => {
    expect(timeRangeForChars(alignment, 4, 99)).toEqual({ start: 0.4, end: 0.7 });
  });

  it('returns null when there is no alignment to work with', () => {
    expect(
      timeRangeForChars({ characters: [], startSeconds: [], endSeconds: [] }, 0, 3),
    ).toBeNull();
  });

  it('returns null for an inverted range', () => {
    expect(timeRangeForChars(alignment, 5, 2)).toBeNull();
  });
});
