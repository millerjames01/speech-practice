import { describe, expect, it } from 'vitest';
import { CASTILIANISMS, findCastilianisms } from '../src/castilianisms';
import { withDeterministicHits } from '../src/coach';

const hits = (text: string) => findCastilianisms(text).map((h) => h.wrong);

describe('findCastilianisms', () => {
  it('catches the syntactic calques, which are the ones a learner cannot hear', () => {
    expect(hits('Vaig a tenir que marxar aviat')).toContain('tenir que');
    expect(hits('Hi han moltes coses a fer')).toContain('hi han');
    expect(hits('Lo que vull dir és això')).toContain('lo que');
    expect(hits('Degut a la pluja no vam sortir')).toContain('degut a');
  });

  it('catches the borrowed words', () => {
    expect(hits('Vale, quedem dissabte')).toContain('vale');
    expect(hits('Bueno, no ho sé')).toContain('bueno');
    expect(hits('Esperem un rato')).toContain('rato');
  });

  it('leaves correct Catalan alone', () => {
    expect(hits("D'acord, hi ha moltes coses i he de marxar")).toEqual([]);
  });

  it('does not fire inside a longer word', () => {
    // \b is no use here: Catalan words carry accents and ç, which JavaScript
    // treats as non-word characters. These are the cases that would break.
    expect(hits('És un noi molt valent')).toEqual([]);
    expect(hits('Visca València')).toEqual([]);
    expect(hits('Això és molt barato')).not.toContain('rato');
  });

  it('is case insensitive and reports where it matched', () => {
    const found = findCastilianisms('Bueno, vale.');
    expect(found).toHaveLength(2);
    expect(found[0]!.index).toBeLessThan(found[1]!.index);
    expect(found[0]!.matched).toBe('Bueno');
  });

  it('carries a correction and a reason for every entry', () => {
    for (const entry of CASTILIANISMS) {
      expect(entry.right.length).toBeGreaterThan(0);
      expect(entry.why.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate entries', () => {
    const wrongs = CASTILIANISMS.map((c) => c.wrong);
    expect(new Set(wrongs).size).toBe(wrongs.length);
  });
});

describe('withDeterministicHits', () => {
  const empty = {
    met: true,
    missing: [],
    castilianisms: [],
    upgrades: [],
    errors: [],
    usedTarget: [],
    reply: '',
  };

  it('adds what the model missed', () => {
    // The table is not a matter of judgement: if it matched and the model said
    // nothing, the table wins.
    const result = withDeterministicHits(empty, 'Vale, tinc que marxar');
    expect(result.castilianisms.map((c) => c.said.toLowerCase())).toEqual(
      expect.arrayContaining(['vale', 'tinc que']),
    );
  });

  it('does not report the same one twice', () => {
    const withModel = {
      ...empty,
      castilianisms: [{ said: 'Vale', better: "d'acord", why: 'Spanish filler.' }],
    };
    const result = withDeterministicHits(withModel, 'Vale, quedem dijous');
    expect(result.castilianisms).toHaveLength(1);
  });

  it('leaves a clean turn clean', () => {
    const result = withDeterministicHits(empty, "D'acord, quedem dijous a dos quarts de cinc");
    expect(result.castilianisms).toEqual([]);
  });
});
