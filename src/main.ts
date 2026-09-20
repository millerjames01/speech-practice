/**
 * App shell: unit list, then the phases in fixed order.
 *
 * A phase unlocks when the previous one is finished, not passed - the learner
 * is never stuck, but nothing is skipped either.
 */

import { hasElevenLabsKey, loadRemembered } from './keys';
import type { LearnerTurnLog } from './freeform';
import { loadUnits } from './units';
import { PHASE_ORDER, type Phase, type Unit } from './types';
import { renderDialogues } from './ui/dialogue';
import { button, clear, el, errorBox } from './ui/dom';
import { renderFreeform } from './ui/freeform';
import { renderMonologue } from './ui/monologue';
import { renderReport } from './ui/report';
import { openSettings } from './ui/settings';
import { initTheme, toggleTheme } from './ui/theme';
import { renderVocab } from './ui/vocab';
import { resolveVoices } from './voices';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app');

const { units, errors } = loadUnits();

const PHASE_LABELS: Record<Phase, string> = {
  vocab: 'Vocabulary',
  guidedFollow: 'Follow along',
  guidedCue: 'From the cue',
  monologue: 'Monologue',
  freeform: 'Free form',
  report: 'Report',
};

function header(subtitle?: string): HTMLElement {
  const themeBtn = button('◐', () => {
    toggleTheme();
  }, 'btn quiet');
  themeBtn.title = 'Switch between light and dark';

  return el(
    'header',
    { class: 'app-header' },
    el('h1', {}, 'Conversation Trainer'),
    el('p', { class: 'subtitle' }, subtitle ?? 'Catalan'),
    el(
      'div',
      { class: 'header-actions' },
      themeBtn,
      button('Settings', () => openSettings(renderUnitList), 'btn quiet'),
    ),
  );
}

function renderUnitList(): void {
  clear(root!);
  root!.append(header('Central Catalan · strict correction'));

  if (!hasElevenLabsKey()) {
    root!.append(
      el('div', { class: 'notice' }, 'No ElevenLabs key set. Open Settings before starting.'),
    );
  }

  for (const message of errors) {
    root!.append(errorBox(`Skipped an invalid unit — ${message}`));
  }

  if (units.length === 0) {
    root!.append(
      el(
        'p',
        { class: 'hint' },
        'No units found. Generate some with `npm run generate -- <unit-id>`, or add ' +
          'JSON files to /units.',
      ),
    );
    return;
  }

  root!.append(
    el(
      'ul',
      { class: 'unit-list' },
      ...units.map((unit) =>
        el(
          'li',
          { class: 'unit' },
          el(
            'div',
            {},
            el('h3', {}, unit.title),
            el('p', { class: 'meta' }, `${unit.level} · ${unit.type} · ${unit.newVocab.length} words`),
            unit.reviewed
              ? null
              : el('p', { class: 'warning' }, 'Not reviewed by a Catalan speaker'),
          ),
          button('Start', () => startUnit(unit), 'btn primary'),
        ),
      ),
    ),
  );
}

function startUnit(unit: Unit): void {
  // Units ship without account-specific voice ids, so fill them in once here
  // and hand the phases a unit whose voices are real. Resolution failure is not
  // fatal: the phases render and the TTS error surfaces where it can be read.
  void resolveVoices(unit)
    .then((voices) => runPhase({ ...unit, voices }, 'vocab'))
    .catch(() => runPhase(unit, 'vocab'));
}

/** Dots for the phases done, current and still to come. */
function phaseProgress(current: Phase): HTMLElement {
  const index = PHASE_ORDER.indexOf(current);
  return el(
    'div',
    { class: 'phase-dots' },
    ...PHASE_ORDER.map((phase, i) =>
      el('span', {
        class: `dot ${i < index ? 'done' : ''} ${i === index ? 'current' : ''}`,
        title: PHASE_LABELS[phase],
      }),
    ),
  );
}

function unitBar(unit: Unit, phase: Phase): HTMLElement {
  return el(
    'div',
    { class: 'phases' },
    phaseProgress(phase),
    el('span', { class: 'phase-name' }, unit.title),
    // Quiet, one line, and only where it belongs - a full banner on every
    // phase reads as chrome and stops being seen.
    unit.reviewed ? null : el('span', { class: 'warning' }, 'unreviewed'),
    el('span', { class: 'push-right' }, button('Leave', renderUnitList, 'btn quiet')),
  );
}

const nextPhase = (phase: Phase): Phase => {
  const next = PHASE_ORDER[PHASE_ORDER.indexOf(phase) + 1];
  return next ?? 'report';
};

function runPhase(unit: Unit, phase: Phase, turns: LearnerTurnLog[] = []): void {
  clear(root!);
  // The unit's name lives in the bar below; repeating it in the header subtitle
  // says the same thing twice.
  root!.append(header(), unitBar(unit, phase));

  const stage = el('main', {});
  root!.append(stage);
  const advance = () => runPhase(unit, nextPhase(phase));

  switch (phase) {
    case 'vocab':
      renderVocab(stage, unit, advance);
      break;
    case 'guidedFollow':
      renderDialogues(stage, unit, 'follow', advance);
      break;
    case 'guidedCue':
      renderDialogues(stage, unit, 'cue', advance);
      break;
    case 'monologue':
      renderMonologue(stage, unit, advance);
      break;
    case 'freeform':
      renderFreeform(stage, unit, (logs) => runPhase(unit, 'report', logs));
      break;
    case 'report':
      renderReport(stage, unit, turns, renderUnitList);
      break;
  }
}

initTheme();
loadRemembered();
renderUnitList();
if (!hasElevenLabsKey()) openSettings(renderUnitList);
