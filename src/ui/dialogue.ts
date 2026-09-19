/**
 * Phase 1 - guided conversation, strict.
 *
 * The counterpart's line plays, the learner sees an English cue (target text
 * behind a toggle), records, and is judged against the turn's accept list. A
 * turn passes only when it matches; after three failures the answer is shown
 * and one clean repeat is required before moving on.
 */

import { playLine } from '../audio/player';
import { config } from '../config';
import { judgeAttempt } from '../judge';
import { isLearnerTurn, type Dialogue, type LearnerTurn, type Unit } from '../types';
import { renderDiff } from './diffview';
import { button, clear, el, errorBox } from './dom';
import { recordButton } from './recordbutton';

export function renderDialogues(
  root: HTMLElement,
  unit: Unit,
  onComplete: () => void,
): void {
  let dialogueIndex = 0;

  const next = () => {
    const dialogue = unit.dialogues[dialogueIndex];
    if (!dialogue) {
      onComplete();
      return;
    }
    renderDialogue(root, unit, dialogue, dialogueIndex, () => {
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
  onDone: () => void,
): void {
  let turnIndex = 0;
  let attempts = 0;
  let answerShown = false;
  let showTarget = config.ui.showTargetTextByDefault;

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
        el('p', { class: 'done' }, 'Dialogue complete.'),
        button('Continue', onDone, 'btn primary'),
      );
      return;
    }

    if (!isLearnerTurn(turn)) {
      const voiceId = unit.voices[turn.speaker] ?? '';
      transcript.append(
        el('p', { class: 'line counterpart' }, el('strong', {}, `${turn.speaker}: `), turn.text),
      );
      stage.append(
        el('p', { class: 'cue' }, `${turn.speaker} speaks.`),
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
            el('p', { class: 'line learner' }, el('strong', {}, 'you: '), result.target),
          );
          feedback.append(
            el('p', { class: 'pass' }, answerShown ? 'Clean repeat. Moving on.' : 'Correct.'),
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
              { class: 'reveal' },
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

    stage.append(
      el('p', { class: 'cue' }, turn.cue),
      targetLine,
      button(showTarget ? 'Hide target text' : 'Show target text', function toggle(this: void) {
        showTarget = !showTarget;
        targetLine.hidden = !showTarget;
        step();
      }),
      control.node,
      feedback,
    );
  };

  clear(root);
  root.append(
    el('h2', {}, `Guided conversation ${index + 1} of ${unit.dialogues.length}`),
    el(
      'p',
      { class: 'hint' },
      'A turn passes only when it matches. Wrong words always fail; unclear ' +
        'pronunciation is flagged separately.',
    ),
    stage,
    transcript,
  );

  step();
}
