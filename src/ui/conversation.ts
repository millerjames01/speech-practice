/**
 * Conversation - open tasks, coached immediately.
 *
 * Between the scripted phases and free form. The counterpart adapts to what you
 * say, each turn carries a goal, and the coaching appears straight after the
 * reply rather than being held to the end.
 *
 * Nothing here blocks. An open task has no single right answer, so failing a
 * turn would be arbitrary - unlike the scripted phases, where it is the point.
 * You see what you missed and decide whether to go again.
 */

import { playLine } from '../audio/player';
import { coachTurn, type Correction, type TurnCoaching } from '../coach';
import { logLearnerTurn } from '../freeform';
import type { ConversationTask, Unit } from '../types';
import { button, clear, el, errorBox } from './dom';
import { recordButton } from './recordbutton';

/** Castilianisms are wrong; upgrades are a nudge. They must not look alike. */
function corrections(
  title: string,
  items: Correction[],
  variant: 'castilianism' | 'upgrade' | 'error',
): HTMLElement | null {
  if (items.length === 0) return null;
  return el(
    'section',
    { class: `coach-group coach-${variant}` },
    el('h4', {}, title),
    ...items.map((item) =>
      el(
        'div',
        { class: 'coach-item' },
        el(
          'p',
          { class: 'said' },
          el('span', { class: variant === 'upgrade' ? 'muted' : 'strike' }, item.said),
          ' → ',
          el('strong', {}, item.better),
        ),
        item.why ? el('p', { class: 'reason' }, item.why) : null,
      ),
    ),
  );
}

function taskStatus(coaching: TurnCoaching, task: ConversationTask): HTMLElement {
  if (coaching.met) {
    return el('p', { class: 'verdict pass' }, 'Task done.');
  }
  const missing = coaching.missing.length > 0 ? coaching.missing : task.requires;
  return el(
    'div',
    {},
    el('p', { class: 'verdict reveal' }, 'Still missing'),
    el('ul', { class: 'missing' }, ...missing.map((m) => el('li', {}, m))),
  );
}

function targetChips(task: ConversationTask, used: string[]): HTMLElement | null {
  if (task.targetVocab.length === 0) return null;
  const hit = new Set(used.map((u) => u.toLowerCase()));
  return el(
    'section',
    { class: 'coach-group' },
    el('h4', {}, 'Words for this task'),
    el(
      'div',
      { class: 'chips' },
      ...task.targetVocab.map((word) =>
        el('span', { class: `chip ${hit.has(word.toLowerCase()) ? 'w-pass' : ''}` }, word),
      ),
    ),
  );
}

export function renderConversation(
  root: HTMLElement,
  unit: Unit,
  onComplete: () => void,
): void {
  const conversation = unit.conversation;
  if (!conversation || conversation.tasks.length === 0) {
    onComplete();
    return;
  }

  const voiceName =
    Object.keys(unit.voices).find((v) => v !== unit.monologue?.modelVoice) ??
    Object.keys(unit.voices)[0] ??
    '';
  const voiceId = unit.voices[voiceName] ?? '';

  const history: { role: 'counterpart' | 'learner'; text: string }[] = [];
  const thread = el('div', { class: 'transcript' });
  const stage = el('div', { class: 'stage' });
  const counter = el('span', { class: 'phase-count' });

  let index = 0;

  const step = () => {
    clear(stage);
    const task = conversation.tasks[index];

    if (!task) {
      counter.textContent = `${conversation.tasks.length} of ${conversation.tasks.length}`;
      stage.append(
        el('p', { class: 'verdict done' }, 'Conversation complete.'),
        el(
          'p',
          { class: 'hint' },
          'Free form is next: the same subject, nothing corrected until the end.',
        ),
        button('Continue', onComplete, 'btn primary'),
      );
      return;
    }

    counter.textContent = `${index + 1} of ${conversation.tasks.length}`;
    const feedback = el('div', {});

    const advance = () => {
      index += 1;
      step();
    };

    const control = recordButton(async (audio) => {
      clear(feedback);
      feedback.append(el('p', { class: 'hint' }, 'Listening back…'));
      try {
        const log = await logLearnerTurn(audio, false);
        history.push({ role: 'learner', text: log.transcript });
        thread.append(el('p', { class: 'line learner' }, log.transcript || '(nothing heard)'));

        const coaching = await coachTurn({
          unit,
          task,
          history: history.slice(0, -1),
          transcript: log.transcript,
        });

        if (coaching.reply) {
          history.push({ role: 'counterpart', text: coaching.reply });
          thread.append(el('p', { class: 'line counterpart' }, coaching.reply));
          thread.scrollTop = thread.scrollHeight;
          void playLine(coaching.reply, voiceId).catch(() => {
            /* The text is there; silence is survivable. */
          });
        }

        clear(feedback);
        feedback.append(
          el(
            'div',
            { class: 'coaching' },
            taskStatus(coaching, task),
            // Castilianisms first: the thing this phase exists to catch.
            corrections('Castilian creeping in', coaching.castilianisms, 'castilianism'),
            corrections('A native would more likely say', coaching.upgrades, 'upgrade'),
            corrections('Grammar', coaching.errors, 'error'),
            targetChips(task, coaching.usedTarget),
            el(
              'div',
              { class: 'row' },
              button('Next task', advance, 'btn primary'),
              button('Say it again', () => clear(feedback)),
            ),
          ),
        );
      } catch (err) {
        clear(feedback);
        feedback.append(
          errorBox(err instanceof Error ? err.message : String(err)),
          button('Next task', advance, 'btn quiet'),
        );
      }
    }, 'Hold to speak');

    stage.append(
      el(
        'div',
        {},
        el('p', { class: 'speaker-label' }, 'Your task'),
        el('p', { class: 'cue' }, task.goal),
        task.requires.length > 0
          ? el('ul', { class: 'requires' }, ...task.requires.map((r) => el('li', {}, r)))
          : null,
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
      el('span', { class: 'phase-name' }, 'Conversation'),
      el('span', {}, 'corrected as you go'),
      counter,
    ),
    el('p', { class: 'scenario' }, conversation.scenario),
    stage,
    thread,
  );

  step();
}
