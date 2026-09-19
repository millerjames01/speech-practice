/**
 * Build order step 1: the spike.
 *
 * Prove Scribe transcribes your Catalan faithfully - errors included - before
 * trusting any of the UI built on top of it. This answers four questions:
 *
 *   1. Does Scribe output the correct word for one you mispronounced? If so,
 *      pronunciation feedback degrades to confidence flags only, and the UI
 *      must say so rather than implying precision.
 *   2. Does alignment loss separate correct words from mispronounced ones?
 *   3. Is a per-word logprob actually returned?
 *   4. Do the endpoints work at all from this network?
 *
 * Usage:
 *   ELEVENLABS_API_KEY=... npm run spike -- ./recordings
 *
 * The folder needs an expected.json:
 *   [
 *     { "file": "01.webm", "text": "Un quilo de tomàquets, si us plau",
 *       "deliberateErrors": ["tomàquets"] }
 *   ]
 *
 * `deliberateErrors` lists words you knowingly said wrong, which is what makes
 * question 2 answerable: we compare loss on those words against the rest.
 */

import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

interface Expected {
  file: string;
  text: string;
  deliberateErrors?: string[];
}

const BASE = 'https://api.elevenlabs.io';
const STT_MODEL = 'scribe_v1';

const key = process.env.ELEVENLABS_API_KEY;
if (!key) {
  console.error('Set ELEVENLABS_API_KEY before running the spike.');
  process.exit(1);
}

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: npm run spike -- <folder with expected.json and audio files>');
  process.exit(1);
}

interface ScribeWord {
  text: string;
  start: number;
  end: number;
  type?: string;
  logprob?: number;
}

async function call(path: string, form: FormData): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'xi-api-key': key! },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`${path} → ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

const normalize = (w: string): string =>
  w.toLowerCase().replace(/[.,!?;:"«»¿¡…]/g, '').replace(/[''`]/g, "'").trim();

async function run(): Promise<void> {
  const manifest = JSON.parse(
    await readFile(join(dir!, 'expected.json'), 'utf8'),
  ) as Expected[];

  const available = new Set(await readdir(dir!));

  const lossCorrect: number[] = [];
  const lossWrong: number[] = [];
  let logprobSeen = false;
  let autoCorrections = 0;
  let wordsChecked = 0;

  for (const item of manifest) {
    if (!available.has(item.file)) {
      console.error(`  ! missing ${item.file}, skipping`);
      continue;
    }
    const bytes = await readFile(join(dir!, item.file));
    const blob = new Blob([bytes]);

    const sttForm = new FormData();
    sttForm.append('file', blob, basename(item.file));
    sttForm.append('model_id', STT_MODEL);
    sttForm.append('language_code', 'ca');
    sttForm.append('timestamps_granularity', 'word');

    const faForm = new FormData();
    faForm.append('file', blob, basename(item.file));
    faForm.append('text', item.text);

    const [stt, fa] = await Promise.all([
      call('/v1/speech-to-text', sttForm),
      call('/v1/forced-alignment', faForm).catch((err: unknown) => {
        console.error(`  ! forced alignment failed: ${String(err)}`);
        return null;
      }),
    ]);

    const heard = ((stt.words as ScribeWord[] | undefined) ?? []).filter(
      (w) => w.type !== 'spacing',
    );
    const aligned = (fa?.words as { text: string; loss?: number }[] | undefined) ?? [];
    const errorSet = new Set((item.deliberateErrors ?? []).map(normalize));

    console.log(`\n=== ${item.file}`);
    console.log(`expected: ${item.text}`);
    console.log(`heard   : ${String(stt.text ?? '')}`);
    console.log('  word            heard           loss     logprob  deliberate');

    const expectedWords = item.text.split(/\s+/).filter(Boolean);
    expectedWords.forEach((word, i) => {
      const norm = normalize(word);
      const heardWord = heard[i];
      const loss = aligned[i]?.loss;
      const logprob = heardWord?.logprob;
      const isDeliberate = errorSet.has(norm);

      if (logprob !== undefined) logprobSeen = true;
      if (loss !== undefined) {
        (isDeliberate ? lossWrong : lossCorrect).push(loss);
      }

      // The headline risk: you said it wrong, Scribe wrote it right.
      if (isDeliberate && heardWord && normalize(heardWord.text) === norm) {
        autoCorrections += 1;
      }
      wordsChecked += 1;

      console.log(
        `  ${word.padEnd(15)} ${(heardWord?.text ?? '-').padEnd(15)} ` +
          `${(loss?.toFixed(3) ?? '-').padStart(7)} ` +
          `${(logprob?.toFixed(3) ?? '-').padStart(8)}  ${isDeliberate ? 'yes' : ''}`,
      );
    });
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

  console.log('\n================ SUMMARY ================');
  console.log(`words checked            : ${wordsChecked}`);
  console.log(`per-word logprob returned: ${logprobSeen ? 'yes' : 'NO'}`);
  console.log(`mean loss, correct words : ${mean(lossCorrect).toFixed(3)} (n=${lossCorrect.length})`);
  console.log(`mean loss, deliberate    : ${mean(lossWrong).toFixed(3)} (n=${lossWrong.length})`);

  if (lossCorrect.length && lossWrong.length) {
    const gap = mean(lossWrong) - mean(lossCorrect);
    console.log(`separation               : ${gap.toFixed(3)}`);
    console.log(
      gap > 0.15
        ? '  → Loss separates them. Set config.judge.alignmentLossFail between the two means.'
        : '  → Loss does NOT separate them. Pronunciation feedback should degrade to\n' +
          '    confidence flags only, and the UI must say so (see the brief\'s Risks).',
    );
  }

  console.log(
    `\nScribe wrote the correct word for a deliberate error ${autoCorrections} time(s).`,
  );
  if (autoCorrections > 0) {
    console.log(
      '  → STT auto-correction is real here. Word diff alone cannot catch\n' +
        '    mispronunciation; alignment loss is doing the work.',
    );
  }
}

run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
