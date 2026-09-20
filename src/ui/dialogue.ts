/**
 * Guided conversation, strict - run twice per unit with different support.
 *
 * "follow" shows the Catalan you are aiming for, so the work is producing it
 * accurately. "cue" shows only the English instruction, so the work is
 * retrieving it. Same dialogues, same judging; the second pass is the one that
 * proves you know it rather than can read it.
 *
 * A turn passes only when it matches. After three failures the answer is shown
 * and one clean repeat is still required before moving on.
 */

import { playLine } from '../audio/player';
import { config } from '../config';
import { judgeAttempt } from '../judge';
import { isLearnerTurn, type Dialogue, type LearnerTurn, type Unit } from '../types';
import { renderDiff } from './diffview';
import { button, clear, el, errorBox } from './dom';
import { recordButton } from './recordbutton';

export type GuidedSupport = 'follow' | 'cue';

export function renderDialogues(
  root: HTMLElement,
  unit: Unit,
  support: GuidedSupport,
  onComplete: () => void,
): void {
  let dialogueIndex = 0;

  const next = () => {
    const dialogue = unit.dialogues[dialogueIndex];
    if (!dialogue) {
      onComplete();
      return;
    }
    renderDialogue(root, unit, dialogue, dialogueIndex, support, () => {
      dialogueIndex += 1;
      next();
    });
  };

  next();
}

function renderDialogue(
  root: HTMLElement,
  unit: Unit,
  dialogue: Dialogue,
  index: number,
  support: GuidedSupport,
  onDone: () => void,
): void {
  let turnIndex = 0;
  let attempts = 0;
  let answerShown = false;
  // Follow-along shows the Catalan outright; the cue pass earns it back only
  // after three failed attempts.
  let showTarget = support === 'follow';

  const transcript = el('div', { class: 'transcript' });
  const stage = el('div', { class: 'stage' });

  const advance = () => {
    turnIndex += 1;
    attempts = 0;
    answerShown = false;
    step();
  };

  const step = () => {
    clear(stage);
    const turn = dialogue.turns[turnIndex];

    if (!turn) {
      stage.append(
        el('p', { class: 'verdict done' }, 'Dialogue complete.'),
        button('Continue', onDone, 'btn primary'),
      );
      return;
    }

    if (!isLearnerTurn(turn)) {
      const voiceId = unit.voices[turn.speaker] ?? '';
      transcript.append(el('p', { class: 'line counterpart' }, turn.text));
      stage.append(
        el('p', { class: 'speaker-label' }, turn.speaker),
        el('p', { class: 'target' }, turn.text),
        el(
          'div',
          { class: 'row' },
          button('Play', () => void playLine(turn.text, voiceId)),
          button('Play slowly', () => void playLine(turn.text, voiceId, true)),
          button('Next', advance, 'btn primary'),
        ),
      );
      void playLine(turn.text, voiceId).catch(() => {
        stage.append(errorBox('Could not play this line. Check your ElevenLabs key in Settings.'));
      });
      return;
    }

    renderLearnerTurn(turn);
  };

  const renderLearnerTurn = (turn: LearnerTurn) => {
    const feedback = el('div', { class: 'feedback' });
    const target = turn.accept[0] ?? '';
    const modelVoice = unit.monologue?.modelVoice ?? Object.keys(unit.voices)[0] ?? '';
    const modelVoiceId = unit.voices[modelVoice] ?? '';

    const targetLine = el('p', { class: 'target' }, target);
    targetLine.hidden = !showTarget;

    const control = recordButton(async (audio) => {
      clear(feedback);
      try {
        const result = await judgeAttempt(audio, {
          accept: turn.accept,
          focus: turn.focus ?? [],
          level: unit.level,
        });

        feedback.append(
          renderDiff({
            words: result.words,
            target: result.target,
            transcript: result.transcript,
            take: audio,
            modelVoiceId,
            fluency: {
              ...(result.durationSeconds !== undefined
                ? { durationSeconds: result.durationSeconds }
                : {}),
              ...(result.wordsPerMinute !== undefined
                ? { wordsPerMinute: result.wordsPerMinute }
                : {}),
            },
          }),
        );

        if (result.passed) {
          transcript.append(
            el('p', { class: 'line learner' }, result.target),
          );
          feedback.append(
            el(
              'p',
              { class: 'verdict pass' },
              answerShown ? 'Clean repeat. Moving on.' : 'Correct.',
            ),
            button('Next', advance, 'btn primary'),
          );
          control.setDisabled(true);
          return;
        }

        attempts += 1;

        // After three failures, show the answer - but a clean repeat is still
        // required, so the turn is never passed by attrition.
        if (attempts >= config.judge.maxAttempts && !answerShown) {
          answerShown = true;
          showTarget = true;
          targetLine.hidden = false;
          feedback.append(
            el(
              'p',
              { class: 'verdict reveal' },
              `The answer is: ${target}. Say it once cleanly to move on.`,
            ),
          );
        }

        feedback.append(
          el(
            'div',
            { class: 'row' },
            button('Hear it', () => void playLine(target, modelVoiceId)),
            button('Hear it slowly', () => void playLine(target, modelVoiceId, true)),
          ),
        );
      } catch (err) {
        feedback.append(errorBox(err instanceof Error ? err.message : String(err)));
      }
    });

    const toggle = button(
      showTarget ? 'Hide the Catalan' : 'Show the Catalan',
      () => {
        showTarget = !showTarget;
        targetLine.hidden = !showTarget;
        toggle.textContent = showTarget ? 'Hide the Catalan' : 'Show the Catalan';
      },
      'btn quiet',
    );

    stage.append(
      el('p', { class: 'speaker-label' }, 'Your turn'),
      el('p', { class: 'cue' }, turn.cue),
      targetLine,
      toggle,
      control.node,
      feedback,
    );
  };

  clear(root);
  root.append(
    el(
      'div',
      { class: 'phases' },
      el(
        'span',
        { class: 'phase-name' },
        support === 'follow' ? 'Follow along' : 'From the cue',
      ),
      el(
        'span',
        {},
        support === 'follow'
          ? 'the Catalan is in front of you'
          : 'English prompt only — recall it',
      ),
      el('span', { class: 'phase-count' }, `${index + 1} of ${unit.dialogues.length}`),
    ),
    stage,
    transcript,
  );

  step();
}
