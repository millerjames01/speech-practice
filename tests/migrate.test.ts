import { describe, expect, it } from 'vitest';
import legacyVocab from '../speedrun/vocab/legacy-v1.json';
import { loadSpeedrun } from '../src/speedrun/content';
import { buildMigrationPlan } from '../src/speedrun/migrate';
import { conjugationPool, formKey, legacyTablePool } from '../src/speedrun/sprint';
import type { SrsCard } from '../src/speedrun/srs';
import { vocab } from '../src/speedrun/vocab';

const lessons = loadSpeedrun().lessons;
const pool = conjugationPool();
const key = (context: string, prompt: string) => pool.find((c) => c.context === context && c.prompt === prompt)!.key;
const card = (lessonId: string, index: number, step: number): SrsCard => ({ lessonId, index, step, due: 0, lapses: 0 });

describe('migrating older progress', () => {
  it('carries table-sprint forms onto the translation forms with the same answer', () => {
    const plan = buildMigrationPlan(lessons, {}, []);
    // The first sprint drilled "present: parlar · nosaltres" → "parlem".
    const old = formKey('present', 'parlar · nosaltres');
    expect(legacyTablePool(lessons).find((c) => c.key === old)?.answer).toBe('parlem');
    const moved = plan.mapForms({ [old]: 2 });
    expect(moved[key('parlar · present', 'nosotros hablamos')]).toBe(2);
    expect(moved[old]).toBeUndefined();
    // Current keys pass straight through.
    const now = key('tenir · present', 'yo tengo');
    expect(plan.mapForms({ [now]: 1 })[now]).toBe(1);
  });

  it('credits forms from lessons already held at two stars', () => {
    const tenir = lessons.find((l) => l.id === 'a2-04')!;
    const cards = tenir.items.map((_, i) => ({ ...card('a2-04', i, 2), last: Date.now() }));
    const plan = buildMigrationPlan(lessons, { 'a2-04': { bestMs: 1, bestScore: 1, runs: 1 } }, cards);
    expect(plan.seedForms).toContain(key('tenir · present', 'yo tengo'));
    expect(buildMigrationPlan(lessons, {}, []).seedForms).toEqual([]);
  });

  it('moves vocab reviews to the same word in the new pack, and drops the rest', () => {
    const plan = buildMigrationPlan(lessons, {}, []);
    const current = new Map<string, [string, number]>();
    for (const s of vocab.sets) s.words.forEach(([ca], i) => current.set(ca, [s.id, i]));
    let kept = 0;
    let dropped = 0;
    for (const [id, words] of Object.entries(legacyVocab.sets)) {
      words.forEach((ca, i) => {
        const moved = plan.mapCard(card(id, i, 3));
        const to = current.get(ca);
        if (to) {
          expect(moved).toMatchObject({ lessonId: to[0], index: to[1], step: 3 });
          kept += 1;
        } else {
          expect(moved).toBeNull();
          dropped += 1;
        }
      });
    }
    expect(kept + dropped).toBe(480);
    expect(plan.mapCard(card('a2-01', 0, 1))).toMatchObject({ lessonId: 'a2-01' });
  });
});
