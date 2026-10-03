import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { validateUnit } from '../scripts/schema';

/** The example unit from the implementation brief. */
const brief = {
  id: '01-mercat',
  title: 'Al mercat',
  level: 'A1',
  type: 'scenario',
  reviewed: false,
  newVocab: ['tomàquets', 'quilo', 'quant costa'],
  voices: { narrator: 'v1', venedora: 'v2' },
  monologue: {
    modelVoice: 'narrator',
    sentences: [
      {
        text: 'Cada dissabte al matí vaig al mercat.',
        cue: 'Every Saturday morning I go to the market',
      },
    ],
  },
  dialogues: [
    {
      id: 'd1',
      turns: [
        { speaker: 'venedora', text: 'Bon dia! Què li poso?' },
        {
          speaker: 'learner',
          cue: 'Ask for a kilo of tomatoes',
          accept: ['Un quilo de tomàquets, si us plau', 'Un quilo de tomàquets'],
          focus: ['tomàquets'],
        },
      ],
    },
  ],
  freeform: {
    scenario: 'You run a fruit stall at Mercat de Sant Antoni. The learner is a regular.',
    maxTurns: 12,
  },
};

const without = (path: string[]) => {
  const copy = structuredClone(brief) as Record<string, unknown>;
  let node: Record<string, unknown> = copy;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string, unknown>;
  delete node[path[path.length - 1]!];
  return copy;
};

describe('validateUnit', () => {
  it('accepts the example unit from the brief', () => {
    expect(validateUnit(brief)).toEqual({ valid: true, errors: [] });
  });

  it('rejects anything that is not an object', () => {
    expect(validateUnit('a unit').valid).toBe(false);
    expect(validateUnit([]).valid).toBe(false);
  });

  it.each([['id'], ['title'], ['level'], ['type'], ['reviewed'], ['newVocab'], ['dialogues']])(
    'rejects a unit missing %s',
    (field) => {
      expect(validateUnit(without([field])).valid).toBe(false);
    },
  );

  it('rejects a speaker that is not in voices', () => {
    const unit = structuredClone(brief);
    unit.dialogues[0]!.turns[0]!.speaker = 'ningú';
    const result = validateUnit(unit);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('ningú');
  });

  it('rejects a learner turn with no accept list, which would pass anything', () => {
    const unit = structuredClone(brief) as Record<string, unknown>;
    const turns = (unit.dialogues as { turns: Record<string, unknown>[] }[])[0]!.turns;
    turns[1]!.accept = [];
    expect(validateUnit(unit).valid).toBe(false);
  });

  it('rejects more than four accept variants', () => {
    const unit = structuredClone(brief);
    unit.dialogues[0]!.turns[1]!.accept = ['a', 'b', 'c', 'd', 'e'];
    expect(validateUnit(unit).valid).toBe(false);
  });

  it('rejects a dialogue with no learner turns', () => {
    const unit = structuredClone(brief);
    unit.dialogues[0]!.turns = [unit.dialogues[0]!.turns[0]!];
    expect(validateUnit(unit).valid).toBe(false);
  });

  it('rejects a monologue voice that is not in voices', () => {
    const unit = structuredClone(brief);
    unit.monologue.modelVoice = 'fantasma';
    expect(validateUnit(unit).valid).toBe(false);
  });

  it('reports every problem at once, so generation can retry with all of them', () => {
    const result = validateUnit({ id: 'x' });
    expect(result.errors.length).toBeGreaterThan(3);
  });
});

describe('the units shipped in /units', () => {
  const files = readdirSync('units').filter((f) => f.endsWith('.json'));

  it('has units to load', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s is valid', (file) => {
    const unit = JSON.parse(readFileSync(`units/${file}`, 'utf8')) as unknown;
    expect(validateUnit(unit)).toEqual({ valid: true, errors: [] });
  });
});

describe('shipped content uses post-2016 orthography', () => {
  // The bug this suite missed first time round: a unit written with a
  // diacritic the 2016 IEC reform removed fails a learner who said it
  // correctly, because the transcriber writes the modern spelling.
  const REMOVED = [
    'sóc', 'adéu', 'dóna', 'dónes', 'néta', 'nét', 'ós', 'óssa', 'vénen',
    'véns', 'féu', 'sóls', 'mòlt', 'bòta', 'mòra', 'fóra', 'séc', 'vés',
  ];

  const sources = [
    ...readdirSync('units')
      .filter((f) => f.endsWith('.json'))
      .map((f) => [`units/${f}`, readFileSync(`units/${f}`, 'utf8')] as const),
    ['curriculum.json', readFileSync('curriculum.json', 'utf8')] as const,
  ];

  it.each(sources)('%s carries no removed diacritic', (_name, content) => {
    const lower = content.toLowerCase();
    const found = REMOVED.filter((word) =>
      new RegExp(`(^|[^\\p{L}])${word}($|[^\\p{L}])`, 'u').test(lower),
    );
    expect(found).toEqual([]);
  });
});
