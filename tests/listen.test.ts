import { describe, expect, it } from 'vitest';
import { bestHearing } from '../src/speedrun/listen';

describe('voice answers', () => {
  it('credits the answer if any of the recogniser’s guesses is right', () => {
    const best = bestHearing('Tinc por.', ['tinc pa', 'tinc por', 'ting por']);
    expect(best?.text).toBe('tinc por');
    expect(best?.result.verdict).toBe('exact');
  });

  it('forgives a homophone spelling and reports the closest miss otherwise', () => {
    expect(bestHearing('[No he estat mai|Mai (no) he estat] a Londres.', ['no he estat mai a londres'])?.result.verdict).toBe('exact');
    expect(bestHearing('Sóc de Barcelona.', ['soc de barcelona'])?.result.verdict).not.toBe('wrong');
    const miss = bestHearing('Tinc por.', ['tinc pa']);
    expect(miss?.result.verdict).toBe('wrong');
    expect(bestHearing('Tinc por.', [])).toBeNull();
  });
});
