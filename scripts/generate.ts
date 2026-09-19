/**
 * Unit generation. A dev-time step, not a backend: generated files land in
 * /units and the app just loads them.
 *
 * The unit spec plus every word taught in earlier units is sent to the LLM, so
 * new units build on old ones and do not introduce vocabulary out of order.
 * Output is validated against the unit schema, and invalid output is RETRIED,
 * never patched - a silently repaired unit is how wrong Catalan gets in.
 *
 * Usage:
 *   OPENROUTER_API_KEY=... npm run generate -- a1-05
 *   ANTHROPIC_API_KEY=...  npm run generate -- a1-05 --provider anthropic
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { validateUnit } from './schema';

interface CurriculumUnit {
  id: string;
  title: string;
  type: 'scenario' | 'vocabulary';
  situation: string;
  grammar: string[];
  newVocab: string[];
  focus: string[];
  unlocks?: string;
}

interface Curriculum {
  variety: string;
  voices: Record<string, string>;
  pronunciationTargets: string[];
  levels: { level: string; units: CurriculumUnit[] }[];
}

const MAX_ATTEMPTS = 3;

const args = process.argv.slice(2);
const unitId = args.find((a) => !a.startsWith('--'));
const provider = args.includes('--provider')
  ? args[args.indexOf('--provider') + 1]
  : 'openrouter';

if (!unitId) {
  console.error('Usage: npm run generate -- <unit-id> [--provider openrouter|anthropic]');
  process.exit(1);
}

const curriculum = JSON.parse(readFileSync('curriculum.json', 'utf8')) as Curriculum;

const level = curriculum.levels.find((l) => l.units.some((u) => u.id === unitId));
const unit = level?.units.find((u) => u.id === unitId);
if (!level || !unit) {
  console.error(`No unit "${unitId}" in curriculum.json.`);
  process.exit(1);
}

/** Every word taught before this unit, so nothing arrives out of order. */
function priorVocabulary(): string[] {
  const words: string[] = [];
  for (const lvl of curriculum.levels) {
    for (const u of lvl.units) {
      if (u.id === unitId) return words;
      words.push(...u.newVocab);
    }
  }
  return words;
}

const systemPrompt = [
  'You write practice units for a strict Catalan speaking trainer.',
  '',
  'Language rules:',
  `- ${curriculum.variety}. Never Valencian or Balearic forms.`,
  '- No Castilianisms whatsoever, including ones common in casual speech.',
  '  Write "s\'ha acabat" not "s\'ha acabat el tema" calques, "escombraries" not "basura",',
  '  "avorrit" not "aburrit", "a més" not "ademés".',
  '- Every learner turn needs 2 to 4 `accept` variants: natural alternative phrasings',
  '  of the SAME answer. Never include a variant that is merely acceptable-ish.',
  '- `focus` words must come from the unit\'s pronunciation targets.',
  '',
  'Content rules:',
  '- Use ONLY the unit\'s new vocabulary plus vocabulary from earlier units.',
  '- 2 to 3 dialogues, each 6 to 12 turns, alternating counterpart and learner.',
  '- A monologue of 6 to 12 sentences, roughly 1 to 3 minutes spoken, built from',
  '  the unit\'s vocabulary. Each sentence needs an English cue.',
  '- `cue` fields are English instructions ("Ask how much the tomatoes cost"),',
  '  never Catalan and never a translation of the answer.',
  '- The freeform scenario is written in the second person to the LLM that will',
  '  play the counterpart.',
  '',
  'Output rules:',
  '- Reply with a single JSON object and nothing else.',
  '- "reviewed" must be false. A human checks the Catalan before it is used.',
  `- "voices" must be exactly: ${JSON.stringify(curriculum.voices)}`,
  '- Speakers in dialogue turns must be "learner" or a key of "voices".',
].join('\n');

function userPrompt(errors?: string[]): string {
  const parts = [
    `Unit id: ${unit!.id}`,
    `Title: ${unit!.title}`,
    `Level: ${level!.level}`,
    `Type: ${unit!.type}`,
    `Situation: ${unit!.situation}`,
    `Grammar targets: ${unit!.grammar.join('; ')}`,
    `New vocabulary (must all appear): ${unit!.newVocab.join(', ')}`,
    `Pronunciation focus words: ${unit!.focus.join(', ')}`,
    `Pronunciation targets for this curriculum: ${curriculum.pronunciationTargets.join('; ')}`,
    '',
    `Vocabulary from earlier units (free to reuse): ${priorVocabulary().join(', ') || '(none)'}`,
  ];
  if (errors?.length) {
    parts.push(
      '',
      'Your previous attempt was rejected by the schema validator. Fix these and',
      'return the whole unit again:',
      ...errors.map((e) => `  - ${e}`),
    );
  }
  return parts.join('\n');
}

async function callLlm(user: string): Promise<string> {
  if (provider === 'anthropic') {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('Set ANTHROPIC_API_KEY.');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL ?? 'claude-sonnet-4-5',
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    return (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('Set OPENROUTER_API_KEY.');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.LLM_MODEL ?? 'anthropic/claude-sonnet-4.5',
      max_tokens: 8192,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? '';
}

function extractJson(reply: string): unknown {
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? reply).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in the reply.');
  return JSON.parse(candidate.slice(start, end + 1));
}

/** Schema-valid is not the same as curriculum-valid; check the vocabulary too. */
function missingVocabulary(parsed: Record<string, unknown>): string[] {
  const blob = JSON.stringify(parsed).toLowerCase();
  return unit!.newVocab.filter((word) => !blob.includes(word.toLowerCase()));
}

async function run(): Promise<void> {
  let errors: string[] | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    console.log(`Attempt ${attempt}/${MAX_ATTEMPTS} for ${unitId} via ${provider}…`);
    const reply = await callLlm(userPrompt(errors));

    let parsed: unknown;
    try {
      parsed = extractJson(reply);
    } catch (err) {
      errors = [`Reply was not valid JSON: ${String(err)}`];
      continue;
    }

    const result = validateUnit(parsed);
    const missing = result.valid
      ? missingVocabulary(parsed as Record<string, unknown>)
      : [];

    if (result.valid && missing.length === 0) {
      const path = join('units', `${unitId}.json`);
      await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
      console.log(`\nWrote ${path}.`);
      console.log(
        'It is marked reviewed: false. Read the Catalan before practising it —\n' +
          'wrong Catalan in an accept list would train errors. Set reviewed: true\n' +
          'once you have checked it.',
      );
      return;
    }

    errors = [
      ...result.errors,
      ...missing.map((w) => `required vocabulary "${w}" does not appear anywhere in the unit`),
    ];
    console.log(`  rejected:\n${errors.map((e) => `    - ${e}`).join('\n')}`);
  }

  console.error(`\nGave up after ${MAX_ATTEMPTS} attempts. Nothing was written.`);
  process.exit(1);
}

run().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
