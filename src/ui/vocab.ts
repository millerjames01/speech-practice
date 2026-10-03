/**
 * Phase 1 - vocabulary, sound to sound.
 *
 * The word is heard, then said. No English anywhere: before you can map meaning
 * to speech you have to be able to produce the sounds at all, and an English
 * gloss at this stage invites you to translate rather than imitate.
 *
 * Judged by the same engine as everything else - the brief is explicit that
 * vocabulary blocks are not a softer mode - with the guided phase's rhythm:
 * retry, and after three misses the word is revealed and one clean repeat is
 * required before moving on.
 */

import { playLine } from '../audio/player';
import { config } from '../config';
import { judgeAttempt } from '../judge';
import type { Unit } from '../types';
import { renderDiff } from './diffview';
import { button, clear, el, errorBox } from './dom';
import { recordButton } from './recordbutton';

export function renderVocab(root: HTMLElement, unit: Unit, onComplete: () => void): void {
  const words = unit.newVocab.filter((w) => w.trim().length > 0);
  if (words.length === 0) {
    onComplete();
    return;
  }

  const voiceId =
    unit.voices[unit.monologue?.modelVoice ?? ''] ??
    unit.voices[Object.keys(unit.voices)[0] ?? ''] ??
    '';

  let index = 0;
  const stage = el('div', { class: 'stage' });
  const counter = el('span', { class: 'phase-count' });

  const step = () => {
    clear(stage);
    const word = words[index];

    if (word === undefined) {
      counter.textContent = `${words.length} of ${words.length}`;
      stage.append(
        el('p', { class: 'verdict done' }, 'Vocabulary complete.'),
        el(
          'p',
          { class: 'hint' },
          'Next you will hear these in conversation, with the Catalan in front of you.',
        ),
        button('Continue', onComplete, 'btn primary'),
      );
      return;
    }

    counter.textContent = `${index + 1} of ${words.length}`;

    let attempts = 0;
    let revealed = false;
    const feedback = el('div', {});

    const advance = () => {
      index += 1;
      step();
    };

    const control = recordButton(async (audio) => {
      clear(feedback);
      try {
        const result = await judgeAttempt(audio, {
          accept: [word],
          focus: [word],
          level: unit.level,
        });

        feedback.append(
          renderDiff({
            words: result.words,
            target: result.target,
            transcript: result.transcript,
            take: audio,
            modelVoiceId: voiceId,
          }),
        );

        if (result.passed) {
          feedback.append(
            el('p', { class: 'verdict pass' }, revealed ? 'Clean repeat.' : 'Correct.'),
            button('Next word', advance, 'btn primary'),
          );
          control.setDisabled(true);
          return;
        }

        attempts += 1;
        if (attempts >= config.judge.maxAttempts && !revealed) {
          revealed = true;
          feedback.append(
            el('p', { class: 'verdict reveal' }, 'Listen once more, then say it cleanly.'),
          );
        }
        feedback.append(
          el(
            'div',
            { class: 'row' },
            button('Hear it again', () => void playLine(word, voiceId)),
            button('Slowly', () => void playLine(word, voiceId, true)),
          ),
        );
      } catch (err) {
        feedback.append(errorBox(err instanceof Error ? err.message : String(err)));
      }
    }, 'Hold to repeat');

    stage.append(
      el('p', { class: 'speaker-label' }, 'Listen, then repeat'),
      el('span', { class: 'vocab-word' }, word),
      el(
        'div',
        { class: 'row' },
        button('Play', () => void playLine(word, voiceId), 'btn primary'),
        button('Slowly', () => void playLine(word, voiceId, true)),
        button('Skip', advance, 'btn quiet'),
      ),
      control.node,
      feedback,
    );

    void playLine(word, voiceId).catch(() => {
      feedback.append(
        errorBox('Could not play this word. Check your ElevenLabs key in Settings.'),
      );
    });
  };

  clear(root);
  root.append(
    el(
      'div',
      { class: 'phases' },
      el('span', { class: 'phase-name' }, 'Vocabulary'),
      el('span', {}, 'sound to sound'),
      counter,
    ),
    stage,
  );
  step();
}
