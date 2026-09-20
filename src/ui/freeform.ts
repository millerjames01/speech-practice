/**
 * Phase 3 - free form.
 *
 * The LLM plays the counterpart, speaking via TTS. No interruptions for errors:
 * nothing is shown during the conversation except the counterpart's replies.
 * Ends by button or after maxTurns, then hands the log to the report.
 */

import { playLine } from '../audio/player';
import { config } from '../config';
import {
  counterpartReply,
  logLearnerTurn,
  type ConversationEntry,
  type LearnerTurnLog,
} from '../freeform';
import type { Unit } from '../types';
import { button, clear, el, errorBox } from './dom';
import { recordButton } from './recordbutton';

export function renderFreeform(
  root: HTMLElement,
  unit: Unit,
  onFinish: (turns: LearnerTurnLog[]) => void,
): void {
  const history: ConversationEntry[] = [];
  const logs: LearnerTurnLog[] = [];
  const maxTurns = unit.freeform.maxTurns || config.freeform.defaultMaxTurns;

  const voiceName = Object.keys(unit.voices).find((v) => v !== unit.monologue?.modelVoice)
    ?? Object.keys(unit.voices)[0]
    ?? '';
  const voiceId = unit.voices[voiceName] ?? '';

  const thread = el('div', { class: 'transcript' });
  const status = el('p', { class: 'hint' });
  const stage = el('div', { class: 'stage' });

  const finish = () => onFinish(logs);

  const updateStatus = () => {
    status.textContent = `Turn ${logs.length} of ${maxTurns}. Nothing is corrected until the end.`;
  };

  const speak = async (text: string) => {
    thread.append(el('p', { class: 'line counterpart' }, text));
    thread.scrollTop = thread.scrollHeight;
    await playLine(text, voiceId).catch(() => {
      thread.append(errorBox('Could not play that reply.'));
    });
  };

  const takeTurn = async (audio: Blob) => {
    try {
      // Sample the drift check rather than paying for it every turn.
      const log = await logLearnerTurn(audio, Math.random() < config.judge.driftSampleRate);
      logs.push(log);
      history.push({ role: 'learner', text: log.transcript });
      // The learner's own words are shown, but never marked up: corrections are
      // deferred to the report by design.
      thread.append(el('p', { class: 'line learner' }, log.transcript || '(nothing heard)'));
      updateStatus();

      if (logs.length >= maxTurns) {
        stage.append(el('p', { class: 'verdict done' }, 'That is the last turn.'));
        finish();
        return;
      }

      const reply = await counterpartReply(unit, history);
      history.push({ role: 'counterpart', text: reply });
      await speak(reply);
    } catch (err) {
      thread.append(errorBox(err instanceof Error ? err.message : String(err)));
    }
  };

  const control = recordButton(takeTurn, 'Hold to reply');

  clear(root);
  root.append(
    el(
      'div',
      { class: 'phases' },
      el('span', { class: 'phase-name' }, 'Free form'),
      el('span', {}, 'nothing is corrected until the end'),
      status,
    ),
    el('p', { class: 'scenario' }, unit.freeform.scenario),
    thread,
    stage,
    el(
      'div',
      { class: 'row' },
      control.node,
      button('End and get the report', finish, 'btn primary'),
    ),
  );

  updateStatus();

  // The counterpart opens, so the learner is answering rather than inventing.
  void counterpartReply(unit, history)
    .then((reply) => {
      history.push({ role: 'counterpart', text: reply });
      return speak(reply);
    })
    .catch((err: unknown) => {
      thread.append(
        errorBox(
          err instanceof Error
            ? `${err.message} — check your LLM key in Settings.`
            : String(err),
        ),
      );
    });
}
