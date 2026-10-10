import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkAnswer } from '../src/speedrun/check';
import { canonical, expand } from '../src/speedrun/pattern';
import { parseSpeedrunFile } from '../src/speedrun/schema';
import type { SpeedrunLesson } from '../src/speedrun/types';

describe('answer patterns', () => {
  it('expands optionals and alternatives, canonical first', () => {
    expect(expand('(Jo) [vaig menjar|he menjat] pa.')).toEqual([
      'Vaig menjar pa.',
      'He menjat pa.',
      'Jo vaig menjar pa.',
      'Jo he menjat pa.',
    ]);
  });

  it('drops optionals and takes the first alternative for the canonical form', () => {
    expect(canonical("No [en tinc|n'hi ha] (pas).")).toBe('No en tinc.');
  });

  it('keeps optional punctuation in the canonical form', () => {
    expect(canonical('Si plou(,) ens quedem.')).toBe('Si plou, ens quedem.');
    expect(expand('Si plou(,) ens quedem.')).toEqual(['Si plou, ens quedem.', 'Si plou ens quedem.']);
  });

  it('supports nesting', () => {
    expect(expand('[a (b)|c] d')).toEqual(['A d', 'A b d', 'C d']);
  });

  it('rejects unbalanced patterns', () => {
    expect(() => expand('a (b')).toThrow();
    expect(() => expand('a [b|c')).toThrow();
    expect(() => expand('a b)')).toThrow();
  });
});

describe('checkAnswer', () => {
  it('passes exact answers ignoring case and punctuation', () => {
    expect(checkAnswer('Avui he menjat pa.', 'avui he menjat pa').verdict).toBe('exact');
  });

  it('passes any accepted phrasing', () => {
    expect(checkAnswer('[He de|Haig de] marxar.', 'haig de marxar').verdict).toBe('exact');
  });

  it('is lenient on accents but flags them as a spelling slip', () => {
    const r = checkAnswer('Què vols?', 'que vols');
    expect(r.verdict).toBe('spelling');
    expect(r.marks[0]).toEqual({ word: 'Què', mark: 'spelling' });
    expect(r.marks[1]).toEqual({ word: 'vols?', mark: 'ok' });
  });

  it('is lenient on ç, l·l and hyphens', () => {
    expect(checkAnswer('Començo al col·legi.', 'comenco al collegi').verdict).toBe('spelling');
    expect(checkAnswer('Dona-m’ho.', "dona m'ho").verdict).toBe('spelling');
  });

  it('reads l.l as l·l, not a full stop', () => {
    expect(checkAnswer('Col·legi', 'col.legi').verdict).toBe('exact');
  });

  it('never forgives a wrong word', () => {
    const r = checkAnswer('Tinc gana.', 'tengo gana');
    expect(r.verdict).toBe('wrong');
    expect(r.marks[0]).toEqual({ word: 'Tinc', mark: 'wrong' });
  });

  it('reports missing and extra words', () => {
    const missing = checkAnswer('No en tinc.', 'no tinc');
    expect(missing.verdict).toBe('wrong');
    expect(missing.marks.map((m) => m.mark)).toEqual(['ok', 'wrong', 'ok']);
    const extra = checkAnswer('No en tinc.', 'no en tinc mai');
    expect(extra.verdict).toBe('wrong');
    expect(extra.marks.map((m) => m.mark)).toEqual(['ok', 'ok', 'ok']);
    expect(extra.extra).toEqual(['mai']);
  });

  it('accepts an added subject pronoun', () => {
    expect(checkAnswer('Parlo català.', 'jo parlo català').verdict).toBe('exact');
  });

  it('accepts old diacritics and long perifràstic forms silently', () => {
    expect(checkAnswer('Soc de Girona.', 'sóc de girona').verdict).toBe('exact');
    expect(checkAnswer('Ahir vam sopar fora.', 'ahir vàrem sopar fora').verdict).toBe('exact');
    expect(checkAnswer('Ves-te’n!', "vés-te'n").verdict).toBe('exact');
  });

  it('judges against the closest accepted answer', () => {
    const r = checkAnswer('[Em sap greu|Ho sento] molt.', 'ho sento mol');
    expect(r.target).toBe('Ho sento molt.');
  });
});

describe('speedrun content', () => {
  const dir = join(__dirname, '..', 'speedrun');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const lessons: SpeedrunLesson[] = files.flatMap(
    (f) => parseSpeedrunFile(JSON.parse(readFileSync(join(dir, f), 'utf8'))).lessons,
  );

  it('every file parses', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('has the planned lessons per level, numbered without gaps', () => {
    const plan = { A2: 34, B1: 30, B2: 21, C1: 18 } as const;
    for (const [level, count] of Object.entries(plan)) {
      const ids = lessons.filter((l) => l.level === level).map((l) => l.id).sort();
      const expected = Array.from(
        { length: count },
        (_, i) => `${level.toLowerCase()}-${String(i + 1).padStart(2, '0')}`,
      );
      expect(ids).toEqual(expected);
    }
  });

  it('has bite-sized lessons', () => {
    for (const l of lessons) {
      expect(l.items.length, l.id).toBeGreaterThanOrEqual(8);
      expect(l.items.length, l.id).toBeLessThanOrEqual(14);
    }
  });

  it('accepts its own canonical answer for every item', () => {
    for (const l of lessons) {
      for (const [, pattern] of l.items) {
        expect(checkAnswer(pattern, canonical(pattern)).verdict, `${l.id}: ${pattern}`).toBe('exact');
      }
    }
  });

  it('has no duplicate prompts within a lesson', () => {
    for (const l of lessons) {
      const prompts = l.items.map(([es]) => es);
      expect(new Set(prompts).size, l.id).toBe(prompts.length);
    }
  });

  it('follows the 2017 IEC accents (no pre-reform diacritics in shown answers)', () => {
    const old = /(^|[^\p{L}])(sóc|dóna|dónes|vénen|véns|adéu|féu|vés)(?=$|[^\p{L}])/iu;
    for (const l of lessons) {
      for (const [, pattern] of l.items) expect(canonical(pattern), l.id).not.toMatch(old);
      for (const [ca] of l.vocab ?? []) expect(ca, l.id).not.toMatch(old);
    }
  });
});
