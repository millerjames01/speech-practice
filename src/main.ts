/**
 * App shell: unit list, then the three phases in fixed order.
 *
 * A phase unlocks when the previous one is finished, not passed - the learner
 * is never stuck, but nothing is skipped either.
 */

import { hasElevenLabsKey, loadRemembered } from './keys';
import type { LearnerTurnLog } from './freeform';
import { loadUnits } from './units';
import type { Phase, Unit } from './types';
import { renderDialogues } from './ui/dialogue';
import { button, clear, el, errorBox } from './ui/dom';
import { renderFreeform } from './ui/freeform';
import { renderMonologue } from './ui/monologue';
import { renderReport } from './ui/report';
import { openSettings } from './ui/settings';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app');

const { units, errors } = loadUnits();

const PHASE_LABELS: Record<Phase, string> = {
  guided: '1. Guided conversation',
  monologue: '2. Monologue',
  freeform: '3. Free form',
  report: 'Correction report',
};

function header(subtitle?: string): HTMLElement {
  return el(
    'header',
    { class: 'app-header' },
    el('h1', {}, 'Conversation Trainer — Catalan'),
    subtitle ? el('p', { class: 'subtitle' }, subtitle) : null,
    button('Settings', () => openSettings(renderUnitList)),
  );
}

function renderUnitList(): void {
  clear(root!);
  root!.append(header('Central Catalan · strict correction'));

  if (!hasElevenLabsKey()) {
    root!.append(
      el(
        'div',
        { class: 'notice' },
        'No ElevenLabs key set. Open Settings before starting a unit.',
      ),
    );
  }

  for (const message of errors) {
    root!.append(errorBox(`Skipped an invalid unit — ${message}`));
  }

  if (units.length === 0) {
    root!.append(
      el(
        'p',
        {},
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
            el('p', { class: 'hint' }, `${unit.level} · ${unit.type} · ${unit.id}`),
            unit.reviewed
              ? null
              : el(
                  'p',
                  { class: 'warning' },
                  'Not reviewed. Wrong Catalan in the accepted answers would train ' +
                    'errors — check this unit before practising it.',
                ),
          ),
          button('Start', () => startUnit(unit), 'btn primary'),
        ),
      ),
    ),
  );
}

function startUnit(unit: Unit): void {
  runPhase(unit, 'guided');
}

function phaseNav(current: Phase): HTMLElement {
  const phases: Phase[] = ['guided', 'monologue', 'freeform'];
  return el(
    'nav',
    { class: 'phases' },
    ...phases.map((phase) =>
      el('span', { class: `phase ${phase === current ? 'current' : ''}` }, PHASE_LABELS[phase]),
    ),
    button('Leave unit', renderUnitList),
  );
}

function runPhase(unit: Unit, phase: Phase, turns: LearnerTurnLog[] = []): void {
  clear(root!);
  root!.append(header(unit.title), phaseNav(phase));

  if (!unit.reviewed) {
    root!.append(
      el('div', { class: 'notice warning' }, 'This unit has not been reviewed.'),
    );
  }

  const stage = el('main', { class: 'phase-stage' });
  root!.append(stage);

  switch (phase) {
    case 'guided':
      renderDialogues(stage, unit, () => runPhase(unit, 'monologue'));
      break;
    case 'monologue':
      renderMonologue(stage, unit, () => runPhase(unit, 'freeform'));
      break;
    case 'freeform':
      renderFreeform(stage, unit, (logs) => runPhase(unit, 'report', logs));
      break;
    case 'report':
      renderReport(stage, unit, turns, renderUnitList);
      break;
  }
}

loadRemembered();
renderUnitList();
if (!hasElevenLabsKey()) openSettings(renderUnitList);
