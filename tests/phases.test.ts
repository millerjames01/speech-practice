import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { phasesFor, type Unit } from '../src/types';
import { parseUnit } from '../scripts/schema';

const unit = (over: Partial<Unit>): Unit =>
  ({
    id: 'x',
    title: 'x',
    level: 'A1',
    type: 'scenario',
    reviewed: false,
    newVocab: ['pa'],
    voices: { narrator: 'v1' },
    freeform: { scenario: 's', maxTurns: 12 },
    ...over,
  }) as Unit;

const dialogues = [
  {
    id: 'd1',
    turns: [
      { speaker: 'narrator', text: 'Hola' },
      { speaker: 'learner' as const, cue: 'Greet', accept: ['Hola'] },
    ],
  },
];

const conversation = {
  scenario: 's',
  tasks: [{ goal: 'g', requires: ['r'], targetVocab: ['v'] }],
};

describe('phasesFor', () => {
  it('gives a scripted unit the full scripted run', () => {
    expect(phasesFor(unit({ dialogues, monologue: { modelVoice: 'narrator', sentences: [{ text: 't', cue: 'c' }] } }))).toEqual([
      'vocab',
      'guidedFollow',
      'guidedCue',
      'monologue',
      'freeform',
    ]);
  });

  it('does not make a conversation unit sit through empty scripted phases', () => {
    expect(phasesFor(unit({ conversation }))).toEqual(['vocab', 'conversation', 'freeform']);
  });

  it('skips the vocabulary drill when there is nothing to drill', () => {
    expect(phasesFor(unit({ newVocab: [], conversation }))).toEqual([
      'conversation',
      'freeform',
    ]);
  });

  it('always ends at free form', () => {
    expect(phasesFor(unit({})).at(-1)).toBe('freeform');
  });
});

describe('the shipped A2 units', () => {
  const files = readdirSync('units').filter((f) => f.startsWith('a2-'));

  it('ships the four conversation units', () => {
    expect(files).toHaveLength(4);
  });

  it.each(files)('%s validates and runs a conversation phase', (file) => {
    const parsed = parseUnit(JSON.parse(readFileSync(`units/${file}`, 'utf8')));
    expect(phasesFor(parsed)).toContain('conversation');
    // Every task must state what it wants, or the coach has nothing to judge.
    for (const task of parsed.conversation!.tasks) {
      expect(task.requires.length).toBeGreaterThan(0);
    }
  });
});
