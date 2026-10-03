/**
 * Phase 2 - monologue, strict and longer form.
 *
 * Three passes of fading support: read the full text, then read with every
 * other sentence hidden, then deliver from English cues only. Each pass is one
 * take, judged per sentence; failed sentences are replayed and redone
 * individually, then the full take once more.
 */

import { playLine } from '../audio/player';
import { judgeAttempt, type AttemptResult } from '../judge';
import type { MonologueSentence, Unit } from '../types';
import { renderDiff } from './diffview';
import { button, clear, el, errorBox } from './dom';
import { recordButton } from './recordbutton';

type Support = 'full' | 'alternating' | 'cues';

const PASSES: { support: Support; label: string; hint: string }[] = [
  { support: 'full', label: 'Pass 1 — full text', hint: 'Read the whole thing.' },
  {
    support: 'alternating',
    label: 'Pass 2 — every other sentence hidden',
    hint: 'The hidden sentences are on you.',
  },
  { support: 'cues', label: 'Pass 3 — cues only', hint: 'English cues only. Deliver it.' },
];

/** Shows a sentence, hides it, or shows only its English cue. */
function sentenceLine(
  sentence: MonologueSentence,
  index: number,
  support: Support,
  voiceId: string,
): HTMLElement {
  const hidden = support === 'cues' || (support === 'alternating' && index % 2 === 1);
  const body = hidden
    ? el('span', { class: 'cue' }, sentence.cue)
    : el('span', { class: 'sentence' }, sentence.text);

  return el(
    'li',
    { class: 'mono-line' },
    body,
    button('▶', () => void playLine(sentence.text, voiceId), 'btn tiny'),
    button('0.75×', () => void playLine(sentence.text, voiceId, true), 'btn tiny'),
  );
}

export function renderMonologue(root: HTMLElement, unit: Unit, onComplete: () => void): void {
  const monologue = unit.monologue;
  if (!monologue) {
    onComplete();
    return;
  }
  const voiceId = unit.voices[monologue.modelVoice] ?? '';
  let passIndex = 0;

  const stage = el('div', { class: 'stage' });

  const renderPass = () => {
    const pass = PASSES[passIndex];
    clear(stage);

    if (!pass) {
      stage.append(
        el('p', { class: 'verdict done' }, 'Monologue complete.'),
        button('Continue to free form', onComplete, 'btn primary'),
      );
      return;
    }

    const feedback = el('div', { class: 'feedback' });

    const control = recordButton(async (audio) => {
      clear(feedback);
      try {
        // One take, judged sentence by sentence against the same audio: the
        // learner delivers the whole thing in one go, as they would in life.
        const results: AttemptResult[] = [];
        for (const sentence of monologue.sentences) {
          results.push(
            await judgeAttempt(audio, { accept: [sentence.text], level: unit.level }),
          );
        }
        renderResults(feedback, monologue.sentences, results, audio, voiceId, () => {
          passIndex += 1;
          renderPass();
        });
      } catch (err) {
        feedback.append(errorBox(err instanceof Error ? err.message : String(err)));
      }
    }, 'Hold to record the whole take');

    stage.append(
      el('h3', {}, pass.label),
      el('p', { class: 'hint' }, pass.hint),
      el(
        'ol',
        { class: 'mono-list' },
        ...monologue.sentences.map((s, i) => sentenceLine(s, i, pass.support, voiceId)),
      ),
      control.node,
      feedback,
    );
  };

  clear(root);
  root.append(
    el(
      'div',
      { class: 'phases' },
      el('span', { class: 'phase-name' }, 'Monologue'),
      el('span', {}, 'deliver it in one take'),
    ),
    stage,
  );
  renderPass();
}

function renderResults(
  feedback: HTMLElement,
  sentences: MonologueSentence[],
  results: AttemptResult[],
  take: Blob,
  voiceId: string,
  onPassComplete: () => void,
): void {
  const failedIndexes = results
    .map((r, i) => (r.passed ? -1 : i))
    .filter((i) => i >= 0);

  feedback.append(
    ...results.map((result, i) =>
      el(
        'div',
        { class: `sentence-result ${result.passed ? 'ok' : 'bad'}` },
        el('h4', {}, sentences[i]?.text ?? ''),
        renderDiff({
          words: result.words,
          target: result.target,
          transcript: result.transcript,
          take,
          modelVoiceId: voiceId,
        }),
      ),
    ),
  );

  if (failedIndexes.length === 0) {
    feedback.append(
      el('p', { class: 'verdict pass' }, 'Clean take.'),
      button('Next pass', onPassComplete, 'btn primary'),
    );
    return;
  }

  // Failed sentences are replayed and redone individually, then the full take
  // once more - which is what "Retake" restarts.
  feedback.append(
    el(
      'p',
      { class: 'verdict reveal' },
      `${failedIndexes.length} sentence(s) to redo before the full take again.`,
    ),
    renderRetries(failedIndexes, sentences, voiceId, onPassComplete),
  );
}

function renderRetries(
  indexes: number[],
  sentences: MonologueSentence[],
  voiceId: string,
  onAllFixed: () => void,
): HTMLElement {
  const remaining = new Set(indexes);
  const container = el('div', { class: 'retries' });

  const checkDone = () => {
    if (remaining.size === 0) {
      container.append(
        el('p', { class: 'verdict pass' }, 'All sentences clean. Do the full take once more.'),
        button('Full take again', onAllFixed, 'btn primary'),
      );
    }
  };

  for (const index of indexes) {
    const sentence = sentences[index];
    if (!sentence) continue;
    const status = el('div', { class: 'feedback' });

    const control = recordButton(async (audio) => {
      clear(status);
      try {
        const result = await judgeAttempt(audio, { accept: [sentence.text], level: 'A1' });
        status.append(
          renderDiff({
            words: result.words,
            target: result.target,
            transcript: result.transcript,
            take: audio,
            modelVoiceId: voiceId,
          }),
        );
        if (result.passed) {
          status.append(el('p', { class: 'verdict pass' }, 'Clean.'));
          remaining.delete(index);
          control.setDisabled(true);
          checkDone();
        }
      } catch (err) {
        status.append(errorBox(err instanceof Error ? err.message : String(err)));
      }
    }, 'Hold to redo this sentence');

    container.append(
      el(
        'div',
        { class: 'retry' },
        el('p', { class: 'sentence' }, sentence.text),
        el(
          'div',
          { class: 'row' },
          button('Hear it', () => void playLine(sentence.text, voiceId)),
          button('Hear it slowly', () => void playLine(sentence.text, voiceId, true)),
        ),
        control.node,
        status,
      ),
    );
  }

  return container;
}
