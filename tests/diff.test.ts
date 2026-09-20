import { describe, expect, it } from 'vitest';
import { chooseVariant, diffWords } from '../src/judge/diff';
import { tokenize } from '../src/judge/normalize';

const diff = (expected: string, heard: string) =>
  diffWords(tokenize(expected), tokenize(heard));

describe('diffWords', () => {
  it('matches an identical take', () => {
    const entries = diff('Em dic Jordi', 'Em dic Jordi');
    expect(entries.every((e) => e.status === 'match')).toBe(true);
  });

  it('fails a near-miss rather than reading it charitably', () => {
    // The brief's own example: "setanta" vs "setenta" must fail.
    const entries = diff('setanta', 'setenta');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.status).toBe('substitution');
  });

  it('reports a missing word', () => {
    const entries = diff('Un quilo de tomàquets', 'Un quilo tomàquets');
    expect(entries.filter((e) => e.status === 'missing')).toHaveLength(1);
    expect(entries.find((e) => e.status === 'missing')?.expected).toBe('de');
  });

  it('reports an extra word', () => {
    const entries = diff('Bon dia', 'Bon dia senyor');
    const extra = entries.filter((e) => e.status === 'extra');
    expect(extra).toHaveLength(1);
    expect(extra[0]!.heard).toBe('senyor');
  });

  it('keeps the heard index, so timestamps can be looked up', () => {
    const entries = diff('Bon dia', 'Bon dia');
    expect(entries[1]!.heardIndex).toBe(1);
  });
});

describe('chooseVariant', () => {
  const accept = ['Un quilo de tomàquets, si us plau', 'Un quilo de tomàquets'];

  it('judges against the variant the learner actually aimed at', () => {
    const choice = chooseVariant(accept, 'Un quilo de tomàquets');
    expect(choice.target).toBe('Un quilo de tomàquets');
    expect(choice.errors).toBe(0);
  });

  it('picks the longer variant when that is what was said', () => {
    const choice = chooseVariant(accept, 'Un quilo de tomàquets si us plau');
    expect(choice.target).toBe('Un quilo de tomàquets, si us plau');
    expect(choice.errors).toBe(0);
  });

  it('is generous about which correct answer, never about wrong words', () => {
    const choice = chooseVariant(accept, 'Un quilo de patates');
    expect(choice.errors).toBeGreaterThan(0);
  });

  it('throws rather than silently passing a turn with no accept list', () => {
    expect(() => chooseVariant([], 'qualsevol cosa')).toThrow();
  });
});

describe('orthography drift across the 2016 reform', () => {
  it('passes a turn the transcriber spelled the other way round', () => {
    // The failure that prompted this: unit said "Sóc de Girona", Scribe heard
    // "Soc de Girona." and the learner was told they said the wrong word.
    const entries = diff('Soc de Girona', 'Sóc de Girona');
    expect(entries.every((e) => e.status === 'match')).toBe(true);
  });

  it('chooses the variant cleanly despite the accent difference', () => {
    const choice = chooseVariant(['Soc de Girona', 'Jo soc de Girona'], 'Sóc de Girona.');
    expect(choice.errors).toBe(0);
    expect(choice.target).toBe('Soc de Girona');
  });

  it('still fails a word that differs by a letter rather than an accent', () => {
    const entries = diff('setanta', 'setenta');
    expect(entries[0]!.status).toBe('substitution');
  });

  it('still fails one of the 15 words that keep a meaning-bearing accent', () => {
    const entries = diff('Sí', 'Si');
    expect(entries[0]!.status).toBe('substitution');
  });
});
