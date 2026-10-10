/**
 * Speedrun views: the level map, a lesson's intro card, the typing drill, and
 * the end-of-lesson split.
 *
 * Every item has to be answered correctly once before a lesson ends: a miss
 * goes back into the queue a few items later, so the learner always finishes
 * on the right answer, and the score counts first tries only.
 */

import { button, clear, el, errorBox } from '../ui/dom';
import { checkAnswer, normalize, type CheckResult } from './check';
import { loadSpeedrun } from './content';
import { canonical, expand } from './pattern';
import {
  allLessonRecords,
  clearMiss,
  formatMs,
  getPrefs,
  missedCount,
  missedItems,
  recordLesson,
  recordMiss,
  resetProgress,
  setPrefs,
} from './progress';
import {
  hasBrowserCatalanVoice,
  lastSpeechError,
  speak,
  speechSource,
  stopSpeaking,
  voicesReady,
} from './speak';
import { SPEEDRUN_LEVELS, type SpeedrunItem, type SpeedrunLesson, type SpeedrunLevel } from './types';

export interface SpeedrunNav {
  onExit: () => void;
  onSettings: (back: () => void) => void;
}

const LEVEL_INFO: Record<SpeedrunLevel, { name: string; blurb: string }> = {
  A2: {
    name: 'Foundations',
    blurb: 'Core verbs in the present, both pasts, the future, and the traps a Castellano ear walks into.',
  },
  B1: {
    name: 'Weak pronouns and moods',
    blurb: 'Pronoms febles, conditional, present subjunctive, and the verbs that diverge from Castellano.',
  },
  B2: {
    name: 'Nuance',
    blurb: 'Imperfect subjunctive, si-clauses, deure, periphrases, "lo" and the Castilianisms to unlearn.',
  },
  C1: {
    name: 'Register and idiom',
    blurb: 'Formal writing, literary past, pronoun mastery, dislocation and frases fetes.',
  },
};

const REVIEW_SIZE = 12;
const REQUEUE_GAP = 3;

let cleanups: (() => void)[] = [];

function resetView(root: HTMLElement): void {
  for (const fn of cleanups) fn();
  cleanups = [];
  stopSpeaking();
  clear(root);
}

/* ---------- shared bits ---------- */

function listen(text: string, label = '🔊', slow = false): HTMLButtonElement {
  const b = button(label, () => {
    b.disabled = true;
    void speak(text, slow).finally(() => {
      b.disabled = false;
    });
  }, 'btn tiny listen');
  b.title = slow ? 'Listen slowly' : 'Listen';
  return b;
}

/** Plain text with **bold** (Catalan), *italic* (Castellano), blank-line paragraphs and "- " bullets. */
function rich(text: string): HTMLElement {
  const box = el('div', { class: 'sr-note' });
  const inline = (line: string): Node[] =>
    line.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/).map((part) =>
      part.startsWith('**') && part.endsWith('**')
        ? el('strong', {}, part.slice(2, -2))
        : part.length > 2 && part.startsWith('*') && part.endsWith('*')
          ? el('em', {}, part.slice(1, -1))
          : document.createTextNode(part),
    );
  for (const para of text.split(/\n\s*\n/)) {
    const lines = para.split('\n');
    if (lines.every((l) => l.trim().startsWith('- '))) {
      box.append(el('ul', {}, ...lines.map((l) => el('li', {}, ...inline(l.trim().slice(2))))));
    } else {
      const p = el('p', {});
      lines.forEach((l, i) => {
        if (i > 0) p.append(el('br'));
        p.append(...inline(l));
      });
      box.append(p);
    }
  }
  return box;
}

function catalanCell(text: string): HTMLElement {
  if (!text.trim() || text.trim() === '—') return el('td', {}, text);
  const cell = el('td', { class: 'sr-ca' }, text);
  cell.title = 'Click to listen';
  cell.addEventListener('click', () => void speak(text));
  return cell;
}

function header(root: HTMLElement, nav: SpeedrunNav, subtitle: string, back?: () => void): void {
  root.append(
    el(
      'header',
      { class: 'app-header' },
      el('h1', {}, 'Speedrun to C1'),
      el('p', { class: 'subtitle' }, subtitle),
      back ? button('Map', back) : button('Conversation trainer', nav.onExit),
      button('Settings', () => nav.onSettings(() => renderSpeedrun(root, nav))),
    ),
  );
}

function audioNotice(): HTMLElement | null {
  const src = speechSource();
  const err = lastSpeechError();
  if (src === 'elevenlabs' && !err) return null;
  if (err) {
    return el('div', { class: 'notice' }, `ElevenLabs failed, using the browser voice instead. ${err}`);
  }
  if (src === 'browser' && !hasBrowserCatalanVoice()) {
    return el(
      'div',
      { class: 'notice' },
      'Audio: no Catalan voice found in this browser, so playback may sound Spanish or English. ' +
        'Add an ElevenLabs key in Settings and a narrator voice id in curriculum.json for natural audio, ' +
        'or install a Catalan (ca-ES) system voice.',
    );
  }
  if (src === 'none') return el('div', { class: 'notice' }, 'Audio is unavailable in this browser.');
  return null;
}

/* ---------- map ---------- */

export function renderSpeedrun(root: HTMLElement, nav: SpeedrunNav): void {
  resetView(root);
  const content = loadSpeedrun();
  const records = allLessonRecords();
  header(root, nav, 'Castellano → Català · written translation · 5-minute lessons');

  for (const message of content.errors) root.append(errorBox(`Skipped an invalid lesson file — ${message}`));

  if (content.unreviewed.size > 0) {
    root.append(
      el(
        'div',
        { class: 'notice warning' },
        `Not yet reviewed by a Catalan speaker: ${[...content.unreviewed].join(', ')}. ` +
          'The content follows the IEC norm (Central Catalan), but check anything that looks off.',
      ),
    );
  }

  const notice = audioNotice();
  if (notice) root.append(notice);
  void voicesReady().then(() => {
    // The browser voice list arrives late; refresh the notice once it does.
    const fresh = audioNotice();
    if (!fresh && notice) notice.remove();
  });

  const done = content.lessons.filter((l) => records[l.id]);
  const totalMs = done.reduce((sum, l) => sum + (records[l.id]?.bestMs ?? 0), 0);
  const avg = done.length
    ? Math.round((done.reduce((s, l) => s + (records[l.id]?.bestScore ?? 0), 0) / done.length) * 100)
    : 0;
  const next = content.lessons.find((l) => !records[l.id]);

  const prefs = getPrefs();
  const autoplay = el('input', { type: 'checkbox', checked: prefs.autoplay });
  autoplay.addEventListener('change', () => setPrefs({ ...getPrefs(), autoplay: autoplay.checked }));

  const misses = missedCount();
  root.append(
    el(
      'section',
      { class: 'sr-stats' },
      el(
        'div',
        { class: 'sr-stat-row' },
        stat(`${done.length}/${content.lessons.length}`, 'lessons'),
        stat(formatMs(totalMs), 'run time (sum of bests)'),
        stat(done.length ? `${avg}%` : '—', 'first-try accuracy'),
      ),
      el(
        'div',
        { class: 'row' },
        next
          ? button(`▶ ${done.length ? 'Continue' : 'Start'}: ${next.id.toUpperCase()} ${next.title}`, () =>
              renderIntro(root, nav, next),
            'btn primary')
          : el('span', { class: 'done' }, 'Run complete. Beat your splits or clear the review deck.'),
        misses > 0
          ? button(`Review mistakes (${misses})`, () => startReview(root, nav))
          : null,
      ),
      el(
        'label',
        { class: 'checkbox' },
        autoplay,
        el('span', {}, 'Auto-play the Catalan answer after each check'),
      ),
    ),
  );

  for (const level of SPEEDRUN_LEVELS) {
    const lessons = content.byLevel[level];
    if (lessons.length === 0) continue;
    const levelDone = lessons.filter((l) => records[l.id]).length;
    const info = LEVEL_INFO[level];
    root.append(
      el(
        'section',
        { class: 'sr-level' },
        el('h2', {}, `${level} · ${info.name}`, el('span', { class: 'hint' }, `  ${levelDone}/${lessons.length}`)),
        el('p', { class: 'hint' }, info.blurb),
        el(
          'div',
          { class: 'sr-grid' },
          ...lessons.map((lesson) => {
            const rec = records[lesson.id];
            const card = el(
              'button',
              { class: `sr-card ${rec ? 'cleared' : ''} ${lesson === next ? 'next' : ''}`, type: 'button' },
              el('span', { class: 'sr-num' }, lesson.id.slice(3)),
              el('span', { class: 'sr-title' }, lesson.title),
              el(
                'span',
                { class: 'sr-best' },
                rec ? `✓ ${formatMs(rec.bestMs)} · ${Math.round(rec.bestScore * 100)}%` : `${lesson.items.length} items`,
              ),
            );
            card.addEventListener('click', () => renderIntro(root, nav, lesson));
            return card;
          }),
        ),
      ),
    );
  }

  root.append(
    el(
      'div',
      { class: 'row sr-footer' },
      button('Reset progress', () => {
        if (confirm('Clear all Speedrun progress, best times and the review deck?')) {
          resetProgress();
          renderSpeedrun(root, nav);
        }
      }, 'btn tiny'),
    ),
  );
}

function stat(value: string, label: string): HTMLElement {
  return el('div', { class: 'sr-stat' }, el('strong', {}, value), el('span', { class: 'hint' }, label));
}

/* ---------- intro ---------- */

function renderIntro(root: HTMLElement, nav: SpeedrunNav, lesson: SpeedrunLesson): void {
  resetView(root);
  header(root, nav, `${lesson.level} · ${lesson.id.toUpperCase()}`, () => renderSpeedrun(root, nav));

  const start = button('▶ Start', () => runSession(root, nav, lessonEntries(lesson), lesson), 'btn primary');

  root.append(
    el(
      'main',
      { class: 'stage sr-intro' },
      el('h2', {}, lesson.title),
      el('p', { class: 'cue' }, lesson.goal),
      rich(lesson.note),
      ...(lesson.tables ?? []).map((t) =>
        el(
          'div',
          { class: 'sr-table-wrap' },
          el('h4', {}, t.title),
          el(
            'table',
            { class: 'sr-table' },
            t.cols ? el('thead', {}, el('tr', {}, ...t.cols.map((c) => el('th', {}, c)))) : null,
            el(
              'tbody',
              {},
              ...t.rows.map((row) =>
                el('tr', {}, el('th', {}, row[0] ?? ''), ...row.slice(1).map(catalanCell)),
              ),
            ),
          ),
        ),
      ),
      lesson.vocab?.length
        ? el(
            'div',
            {},
            el('h4', {}, 'Core words'),
            el(
              'div',
              { class: 'chips' },
              ...lesson.vocab.map(([ca, es]) => {
                const chip = el('button', { class: 'chip sr-vocab', type: 'button' }, el('strong', {}, ca), ` ${es}`);
                chip.addEventListener('click', () => void speak(ca));
                return chip;
              }),
            ),
          )
        : null,
      el('p', { class: 'hint' }, 'Tip: click any Catalan word in the tables to hear it.'),
      el('div', { class: 'row' }, start),
    ),
  );
  start.focus();
}

/* ---------- drill ---------- */

interface Entry {
  lessonId: string;
  index: number;
  item: SpeedrunItem;
}

const lessonEntries = (lesson: SpeedrunLesson): Entry[] =>
  lesson.items.map((item, index) => ({ lessonId: lesson.id, index, item }));

function startReview(root: HTMLElement, nav: SpeedrunNav): void {
  const content = loadSpeedrun();
  const byId = new Map(content.lessons.map((l) => [l.id, l]));
  const entries: Entry[] = [];
  for (const miss of missedItems(REVIEW_SIZE)) {
    const item = byId.get(miss.lessonId)?.items[miss.index];
    if (item) entries.push({ lessonId: miss.lessonId, index: miss.index, item });
  }
  if (entries.length === 0) return renderSpeedrun(root, nav);
  runSession(root, nav, entries, null);
}

const ACCENT_KEYS = ['à', 'è', 'é', 'í', 'ï', 'ò', 'ó', 'ú', 'ü', 'ç', 'l·l', "'"];

function runSession(
  root: HTMLElement,
  nav: SpeedrunNav,
  entries: Entry[],
  lesson: SpeedrunLesson | null,
): void {
  resetView(root);
  const backToMap = () => renderSpeedrun(root, nav);
  header(root, nav, lesson ? `${lesson.level} · ${lesson.title}` : 'Review deck', backToMap);

  const queue = [...entries];
  const firstTry = new Map<string, boolean>();
  let slips = 0;
  const started = Date.now();
  const key = (e: Entry) => `${e.lessonId}#${e.index}`;
  const unique = new Set(entries.map(key)).size;

  const bar = el('div', { class: 'sr-bar-fill' });
  const timer = el('span', { class: 'sr-timer' }, '0:00');
  const counter = el('span', { class: 'hint' });
  const tick = setInterval(() => {
    timer.textContent = formatMs(Date.now() - started);
  }, 500);
  cleanups.push(() => clearInterval(tick));

  const stage = el('main', { class: 'stage sr-drill' });
  root.append(
    el('div', { class: 'sr-topbar' }, el('div', { class: 'sr-bar' }, bar), counter, timer),
    stage,
  );

  const updateBar = () => {
    const cleared = [...firstTry.keys()].filter((k) => !queue.some((e) => key(e) === k)).length;
    bar.style.width = `${(cleared / unique) * 100}%`;
    counter.textContent = `${cleared}/${unique}`;
  };

  const showItem = () => {
    updateBar();
    const entry = queue[0];
    if (!entry) return finish();
    const [es, pattern, hint] = entry.item;
    clear(stage);

    const input = el('input', {
      class: 'input sr-input',
      type: 'text',
      autocomplete: 'off',
      spellcheck: false,
      placeholder: 'Escriu-ho en català…',
    });
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('lang', 'ca');

    const accentBar = el(
      'div',
      { class: 'sr-accents' },
      ...ACCENT_KEYS.map((ch) => {
        const b = button(ch, () => {
          const s = input.selectionStart ?? input.value.length;
          const t = input.selectionEnd ?? s;
          input.value = input.value.slice(0, s) + ch + input.value.slice(t);
          input.focus();
          input.setSelectionRange(s + ch.length, s + ch.length);
        }, 'btn tiny');
        b.tabIndex = -1;
        return b;
      }),
    );

    const feedback = el('div', { class: 'sr-feedback' });
    const checkBtn = el('button', { class: 'btn primary', type: 'submit' }, 'Check');
    const giveUp = button("Don't know", () => resolve(null));
    const form = el('form', { class: 'sr-form' }, input, accentBar, el('div', { class: 'row' }, checkBtn, giveUp));
    let answered = false;

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (answered) return;
      if (!input.value.trim()) return;
      resolve(checkAnswer(pattern, input.value));
    });

    stage.append(
      el('p', { class: 'hint' }, lesson ? 'Translate into Catalan' : `From ${entry.lessonId.toUpperCase()}`),
      el('h2', { class: 'sr-prompt' }, es),
      ...(hint ? [el('p', { class: 'sr-hint' }, hint)] : []),
      form,
      feedback,
    );
    input.focus();

    const resolve = (result: CheckResult | null) => {
      answered = true;
      input.disabled = true;
      checkBtn.disabled = true;
      giveUp.disabled = true;
      accentBar.remove();

      const k = key(entry);
      const correct = result !== null && result.verdict !== 'wrong';
      if (!firstTry.has(k)) {
        firstTry.set(k, correct);
        if (correct) clearMiss(entry.lessonId, entry.index);
        else recordMiss(entry.lessonId, entry.index);
      }
      if (result?.verdict === 'spelling') slips += 1;

      queue.shift();
      if (!correct) queue.splice(Math.min(REQUEUE_GAP, queue.length), 0, entry);

      const answer = result?.target ?? canonical(pattern);
      feedback.append(renderFeedback(result, pattern, input.value));
      const next = button(queue.length ? 'Continue →' : 'Finish →', showItem, 'btn primary');
      feedback.append(
        el('div', { class: 'row' }, listen(answer, '🔊 Listen'), listen(answer, '🐢 Slow', true), next),
      );
      next.focus();
      if (getPrefs().autoplay) void speak(answer);
    };
  };

  const finish = () => {
    clearInterval(tick);
    const ms = Date.now() - started;
    const hits = [...firstTry.values()].filter(Boolean).length;
    const score = unique ? hits / unique : 0;
    clear(stage);

    const rec = lesson ? recordLesson(lesson.id, ms, score) : null;
    const content = loadSpeedrun();
    const nextLesson = lesson ? content.lessons[content.lessons.indexOf(lesson) + 1] : undefined;

    const nextBtn = nextLesson
      ? button(`▶ Next: ${nextLesson.title}`, () => renderIntro(root, nav, nextLesson), 'btn primary')
      : button('Back to map', backToMap, 'btn primary');

    stage.append(
      el('h2', {}, lesson ? 'Lesson cleared' : 'Review done'),
      el(
        'div',
        { class: 'sr-stat-row' },
        stat(formatMs(ms), rec && rec.bestMs === ms && rec.runs > 1 ? 'new best!' : 'time'),
        stat(`${Math.round(score * 100)}%`, 'first try'),
        stat(String(slips), 'spelling slips'),
      ),
      ...(rec
        ? [el('p', { class: 'hint' }, `Best: ${formatMs(rec.bestMs)} · ${Math.round(rec.bestScore * 100)}% · runs: ${rec.runs}`)]
        : []),
      el(
        'div',
        { class: 'row' },
        nextBtn,
        lesson ? button('Retry', () => runSession(root, nav, lessonEntries(lesson), lesson)) : null,
        lesson && nextLesson ? button('Map', backToMap) : null,
      ),
    );
    nextBtn.focus();
  };

  showItem();
}

function renderFeedback(result: CheckResult | null, pattern: string, typed: string): HTMLElement {
  const box = el('div', {});
  const words = (r: CheckResult) =>
    el(
      'p',
      { class: 'sr-answer' },
      ...r.marks.flatMap((m, i) => [
        i > 0 ? ' ' : '',
        m.mark === 'ok' ? m.word : el('span', { class: `sr-mark-${m.mark}` }, m.word),
      ]),
    );

  if (result === null) {
    box.append(
      el('p', { class: 'reveal' }, 'Here it is — it comes back in a moment.'),
      el('p', { class: 'sr-answer' }, canonical(pattern)),
    );
  } else if (result.verdict === 'exact') {
    box.append(el('p', { class: 'pass' }, '✓ Correct'), el('p', { class: 'sr-answer' }, result.target));
  } else if (result.verdict === 'spelling') {
    box.append(
      el('p', { class: 'sr-slip' }, '≈ Right words — check the spelling (accents, ç, l·l, hyphens)'),
      words(result),
    );
  } else {
    box.append(
      el('p', { class: 'fail' }, '✗ Not quite — it comes back in a moment'),
      el(
        'p',
        { class: 'hint' },
        'You wrote: ',
        el('span', { class: 'sr-typed' }, typed),
        result.extra.length ? el('span', {}, ` · extra: `, el('span', { class: 'strike' }, result.extra.join(' '))) : null,
      ),
      words(result),
    );
  }

  // Variants that differ only in punctuation are the same answer to the learner.
  const target = result?.target ?? canonical(pattern);
  const seen = new Set([normalize(target).join(' ')]);
  const others = expand(pattern)
    .filter((a) => {
      const k = normalize(a).join(' ');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 3);
  if (others.length) {
    box.append(el('p', { class: 'hint' }, `Also accepted: ${others.join(' · ')}`));
  }
  return box;
}
