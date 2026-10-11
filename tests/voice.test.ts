import { describe, expect, it } from 'vitest';
import { voiceQuality } from '../src/speedrun/speak';

const v = (name: string, voiceURI = name) => ({ name, voiceURI });

describe('voice quality', () => {
  it('ranks natural, premium, enhanced and Google voices above the compact default', () => {
    const ranked = [
      v('Montse', 'com.apple.voice.compact.ca-ES.Montse'),
      v('Google català'),
      v('Montse (Enhanced)', 'com.apple.voice.enhanced.ca-ES.Montse'),
      v('Montse (Premium)', 'com.apple.voice.premium.ca-ES.Montse'),
      v('Microsoft Joana Online (Natural) - Catalan (Spain)'),
    ].sort((a, b) => voiceQuality(b) - voiceQuality(a));
    expect(ranked.map((x) => x.name)).toEqual([
      'Microsoft Joana Online (Natural) - Catalan (Spain)',
      'Montse (Premium)',
      'Montse (Enhanced)',
      'Google català',
      'Montse',
    ]);
  });

  it('recognises Apple voice names in Spanish and Catalan system languages', () => {
    expect(voiceQuality(v('Montse (mejorada)'))).toBeGreaterThan(voiceQuality(v('Montse')));
    expect(voiceQuality(v('Montse (millorada)'))).toBeGreaterThan(voiceQuality(v('Montse')));
  });
});
