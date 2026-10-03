/**
 * The correction report, shown once free form ends.
 *
 * Errors are grouped by type, each with playback of the correct version and a
 * slice of the learner's own audio from the turn it came from.
 */

import { playBlob, playLine } from '../audio/player';
import { sliceAudio } from '../audio/slice';
import { troubleWords } from '../calibration';
import {
  buildReport,
  categoryLabels,
  type CorrectionReport,
  type ErrorCategory,
  type LearnerTurnLog,
  type ReportError,
} from '../freeform';
import type { Unit } from '../types';
import { button, clear, el, errorBox } from './dom';

const ORDER: ErrorCategory[] = ['grammar', 'vocabulary', 'castilianism', 'pronunciation'];

function errorCard(
  error: ReportError,
  turns: LearnerTurnLog[],
  modelVoiceId: string,
): HTMLElement {
  const turn = turns[error.turnIndex];

  const actions: HTMLElement[] = [
    button('Hear the correct version', () => void playLine(error.correct, modelVoiceId, true)),
  ];

  if (turn) {
    actions.push(
      button('Hear what you said', () => {
        // Slice to the words in question when we can locate them; otherwise
        // play the whole turn rather than nothing.
        const said = error.said.toLowerCase();
        const hits = turn.words.filter((w) => said.includes(w.text.toLowerCase()));
        const first = hits[0];
        const last = hits[hits.length - 1];
        if (first && last) {
          void sliceAudio(turn.audio, first.start, last.end).then((b) => playBlob(b));
        } else {
          void playBlob(turn.audio);
        }
      }),
    );
  }

  return el(
    'div',
    { class: `error-card sev-${error.severity}` },
    el(
      'p',
      { class: 'said' },
      el('span', { class: 'strike' }, error.said),
      ' → ',
      el('strong', {}, error.correct),
    ),
    el('p', { class: 'reason' }, error.reason),
    el(
      'p',
      { class: 'hint' },
      `${error.severity}${
        error.pronunciationConfirmed
          ? ' · re-alignment against the corrected text confirms a pronunciation issue too'
          : ''
      }`,
    ),
    el('div', { class: 'row' }, ...actions),
  );
}

export function renderReport(
  root: HTMLElement,
  unit: Unit,
  turns: LearnerTurnLog[],
  onRestart: () => void,
): void {
  const modelVoice = unit.monologue?.modelVoice ?? Object.keys(unit.voices)[0] ?? '';
  const modelVoiceId = unit.voices[modelVoice] ?? '';

  clear(root);
  const body = el('div', {}, el('p', { class: 'hint' }, 'Building the correction report…'));
  root.append(
    el(
      'div',
      { class: 'phases' },
      el('span', { class: 'phase-name' }, 'Correction report'),
      el('span', {}, unit.title),
    ),
    body,
  );

  const show = (report: CorrectionReport) => {
    clear(body);

    if (turns.length === 0) {
      body.append(el('p', {}, 'No turns were recorded, so there is nothing to correct.'));
    } else if (report.errors.length === 0) {
      body.append(el('p', { class: 'verdict pass' }, 'No errors found in this session.'));
    }

    if (report.summary) body.append(el('p', { class: 'summary' }, report.summary));

    for (const category of ORDER) {
      const errors = report.errors.filter((e) => e.category === category);
      if (errors.length === 0) continue;
      body.append(
        el(
          'section',
          { class: 'error-group' },
          el('h3', {}, `${categoryLabels[category]} (${errors.length})`),
          ...errors.map((e) => errorCard(e, turns, modelVoiceId)),
        ),
      );
    }

    body.append(
      el(
        'section',
        { class: 'transcript-dump' },
        el('h3', {}, 'What you said'),
        ...turns.map((t, i) => el('p', { class: 'line learner' }, `${i}: ${t.transcript}`)),
      ),
      el('div', { class: 'row' }, button('Back to units', onRestart, 'btn primary')),
    );

    void troubleWords().then((stats) => {
      if (stats.length === 0) return;
      body.append(
        el(
          'section',
          { class: 'calibration' },
          el('h3', {}, 'Words you keep missing'),
          el(
            'p',
            { class: 'hint' },
            'From every attempt across your sessions, kept locally.',
          ),
          el(
            'ul',
            {},
            ...stats.map((s) =>
              el(
                'li',
                {},
                `${s.word} — ${s.failures}/${s.attempts} attempts missed` +
                  (s.meanLoss !== undefined ? ` · mean loss ${s.meanLoss.toFixed(2)}` : ''),
              ),
            ),
          ),
        ),
      );
    });
  };

  buildReport(unit, turns)
    .then(show)
    .catch((err: unknown) => {
      clear(body);
      body.append(
        errorBox(
          err instanceof Error
            ? `Could not build the report: ${err.message}`
            : String(err),
        ),
        // The transcript is the session's real record; show it even when the
        // LLM call fails, so the practice is not lost.
        el(
          'section',
          { class: 'transcript-dump' },
          el('h3', {}, 'What you said'),
          ...turns.map((t, i) => el('p', { class: 'line learner' }, `${i}: ${t.transcript}`)),
        ),
        button('Back to units', onRestart, 'btn primary'),
      );
    });
}
