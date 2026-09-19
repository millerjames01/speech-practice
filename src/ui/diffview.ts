/**
 * The diff view: what you said against what you should have said, word by word.
 *
 * Feedback for a failed word is built from templates, never generated prose:
 * the model saying that word alone, your own audio from the same moment, and
 * the focus tip. Unclear words are labelled unclear rather than guessed.
 */

import { sliceAudio } from '../audio/slice';
import { getWordAudio } from '../audio/wordaudio';
import { playBlob, playLine } from '../audio/player';
import type { JudgedWord } from '../judge/types';
import { button, el, errorBox } from './dom';

const CLASS_FOR_VERDICT: Record<JudgedWord['verdict'], string> = {
  pass: 'w-pass',
  unclear: 'w-unclear',
  fail_word: 'w-fail-word',
  fail_pronunciation: 'w-fail-pron',
};

export interface DiffViewOptions {
  words: JudgedWord[];
  target: string;
  transcript: string;
  /** The learner's recording, for per-word playback. */
  take?: Blob;
  /** Voice used to demonstrate a single word. */
  modelVoiceId?: string;
  fluency?: { durationSeconds?: number; wordsPerMinute?: number };
}

function wordChip(word: JudgedWord, opts: DiffViewOptions): HTMLElement {
  const label = word.signal.expected ?? word.signal.heard ?? '?';
  const chip = el(
    'button',
    { class: `chip ${CLASS_FOR_VERDICT[word.verdict]}`, type: 'button', title: word.reason },
    label,
  );
  chip.addEventListener('click', () => {
    const panel = chip.parentElement?.parentElement?.querySelector('.word-detail');
    if (panel instanceof HTMLElement) panel.replaceChildren(wordDetail(word, opts));
  });
  return chip;
}

function wordDetail(word: JudgedWord, opts: DiffViewOptions): HTMLElement {
  const { signal } = word;
  const expected = signal.expected;

  const actions: HTMLElement[] = [];

  if (expected && opts.modelVoiceId) {
    // Cut from the full line rather than synthesised alone: a bare word has no
    // sentence prosody and makes the voice's own accent far more obvious.
    const index = signal.expectedIndex;
    actions.push(
      button('Hear this word', () => {
        void (index === undefined
          ? playLine(expected, opts.modelVoiceId!, true)
          : getWordAudio(opts.target, opts.modelVoiceId!, index).then((b) => playBlob(b)));
      }),
    );
    actions.push(
      button('Hear it in the line', () => {
        void playLine(opts.target, opts.modelVoiceId!, true);
      }),
    );
  }

  if (opts.take && signal.start !== undefined && signal.end !== undefined) {
    actions.push(
      button('Hear yourself', () => {
        void sliceAudio(opts.take!, signal.start!, signal.end!).then((b) => playBlob(b));
      }),
    );
  }

  const facts: string[] = [];
  if (signal.alignmentLoss !== undefined) {
    facts.push(`alignment loss ${signal.alignmentLoss.toFixed(2)}`);
  }
  if (signal.logprob !== undefined) facts.push(`logprob ${signal.logprob.toFixed(2)}`);
  if (signal.isFocus) facts.push('pronunciation target for this turn');
  if (signal.languageDrift) facts.push('this turn drifted out of Catalan');

  return el(
    'div',
    { class: 'detail' },
    el('strong', {}, expected ?? signal.heard ?? ''),
    el('p', {}, word.reason),
    word.verdict === 'unclear'
      ? el(
          'p',
          { class: 'hint' },
          'Unclear, not wrong. Alignment loss is a word-level proxy, not phoneme ' +
            'grading, so this is a flag rather than a verdict.',
        )
      : null,
    facts.length > 0 ? el('p', { class: 'hint' }, facts.join(' · ')) : null,
    el('div', { class: 'row' }, ...actions),
  );
}

export function renderDiff(opts: DiffViewOptions): HTMLElement {
  const failures = opts.words.filter((w) => w.verdict !== 'pass');

  const fluencyLine: string[] = [];
  if (opts.fluency?.wordsPerMinute !== undefined) {
    fluencyLine.push(`${opts.fluency.wordsPerMinute} words/min`);
  }
  if (opts.fluency?.durationSeconds !== undefined) {
    fluencyLine.push(`${opts.fluency.durationSeconds.toFixed(1)}s`);
  }

  return el(
    'div',
    { class: 'diff' },
    el(
      'div',
      { class: 'chips' },
      ...opts.words.map((w) => wordChip(w, opts)),
    ),
    el('div', { class: 'word-detail' }),
    el(
      'dl',
      { class: 'compare' },
      el('dt', {}, 'Target'),
      el('dd', {}, opts.target),
      el('dt', {}, 'Heard'),
      el('dd', {}, opts.transcript || '(nothing)'),
    ),
    failures.length > 0
      ? el('p', { class: 'hint' }, 'Tap any word for the model audio and your own.')
      : null,
    fluencyLine.length > 0
      ? el('p', { class: 'hint' }, `Fluency: ${fluencyLine.join(' · ')} (shown, not scored)`)
      : null,
  );
}

export { errorBox };
