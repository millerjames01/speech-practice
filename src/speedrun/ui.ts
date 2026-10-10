/**
 * Speedrun views: the level map, a lesson's intro, the typing drill, and the
 * end-of-lesson split.
 *
 * Every item has to be answered correctly once before a lesson ends: a miss
 * goes back into the queue a few items later, so the learner always finishes
 * on the right answer, and the score counts first tries only.
 *
 * Styling lives under body[data-mode="speedrun"] in styles.css, so none of it
 * leaks into the conversation trainer.
 */

import { button, clear, el, errorBox } from '../ui/dom';
import { checkAnswer, normalize, type CheckResult } from './check';
import { loadSpeedrun } from './content';
import { canonical, expand } from './pattern';
import {
  allLessonRecords,
  allCards,
  cardStats,
  exportProgress,
  formatMs,
  getPrefs,
  importProgress,
  recordAnswer,
  recordLesson,
  resetProgress,
  setPrefs,
} from './progress';
import { planToday, shuffle } from './srs';
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
    blurb: 'Core verbs in every basic tense, cognate rules, core nouns and the traps a Castellano ear walks into.',
  },
  B1: {
    name: 'Pronouns and moods',
    blurb: 'Pronoms febles, conditional, present subjunctive, core verb forms and the verbs that diverge.',
  },
  B2: {
    name: 'Nuance',
    blurb: 'Imperfect subjunctive, si-clauses, deure, periphrases, Castellano "lo" and the Castilianisms to unlearn.',
  },
  C1: {
    name: 'Register',
    blurb: 'Formal writing, literary past, pronoun mastery, dislocation and spoken idiom.',
  },
};

const REQUEUE_GAP = 3;

let cleanups: (() => void)[] = [];

function resetView(root: HTMLElement): void {
  for (const fn of cleanups) fn();
  cleanups = [];
  stopSpeaking();
  clear(root);
  document.body.dataset.mode = 'speedrun';
}

/** Leaves speedrun styling; called when returning to the conversation trainer. */
export function leaveSpeedrun(): void {
  for (const fn of cleanups) fn();
  cleanups = [];
  stopSpeaking();
  delete document.body.dataset.mode;
}

/** A document-level key handler that lives as long as the current view. */
function onKey(handler: (ev: KeyboardEvent) => void): void {
  document.addEventListener('keydown', handler);
  cleanups.push(() => document.removeEventListener('keydown', handler));
}

/* ---------- icons ---------- */

const SVG_NS = 'http://www.w3.org/2000/svg';

function icon(paths: string[], size = 16): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

const ICONS = {
  speaker: ['M11 5 6 9H3v6h3l5 4V5z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M18.5 5.5a9 9 0 0 1 0 13'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  back: ['M19 12H5', 'M11 18l-6-6 6-6'],
  play: ['M7 5v14l11-7z'],
  refresh: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 5v6h-6'],
};

function iconButton(
  label: string,
  iconPaths: string[],
  onClick: () => void,
  className = 'sr-btn',
): HTMLButtonElement {
  const b = el('button', { class: className, type: 'button' }, icon(iconPaths), el('span', {}, label));
  b.addEventListener('click', onClick);
  return b;
}

const kbd = (key: string) => el('kbd', {}, key);

/* ---------- shared bits ---------- */

function listenButton(text: string, slow = false): HTMLButtonElement {
  const b = iconButton(slow ? '0.75×' : 'Listen', ICONS.speaker, () => {
    b.disabled = true;
    void speak(text, slow).finally(() => {
      b.disabled = false;
    });
  }, 'sr-btn ghost');
  b.title = slow ? 'Listen slowly (S)' : 'Listen (L)';
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
  const cell = el('td', { class: 'sr-ca', tabIndex: 0 }, text);
  cell.title = 'Listen';
  const play = () => void speak(text);
  cell.addEventListener('click', play);
  cell.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      play();
    }
  });
  return cell;
}

function topbar(root: HTMLElement, nav: SpeedrunNav, crumb?: { label: string; back: () => void }): void {
  root.append(
    el(
      'header',
      { class: 'sr-top' },
      el(
        'div',
        { class: 'sr-brand' },
        el('span', { class: 'sr-mark' }, 'CA'),
        el('span', { class: 'sr-wordmark' }, 'Speedrun'),
        crumb ? el('span', { class: 'sr-crumb' }, crumb.label) : null,
      ),
      el(
        'nav',
        { class: 'sr-nav' },
        crumb
          ? iconButton('Map', ICONS.back, crumb.back, 'sr-btn ghost')
          : button('Conversation', nav.onExit, 'sr-btn ghost'),
        button('Settings', () => nav.onSettings(() => renderSpeedrun(root, nav)), 'sr-btn ghost'),
      ),
    ),
  );
}

function audioNotice(): HTMLElement | null {
  const src = speechSource();
  const err = lastSpeechError();
  if (src === 'elevenlabs' && !err) return null;
  if (err) return el('div', { class: 'sr-banner' }, `ElevenLabs failed; using the browser voice. ${err}`);
  if (src === 'browser' && !hasBrowserCatalanVoice()) {
    return el(
      'div',
      { class: 'sr-banner' },
      'No Catalan voice in this browser, so audio may sound off. Add an ElevenLabs key in Settings ' +
        'and a narrator voice id in curriculum.json, or install a ca-ES system voice.',
    );
  }
  if (src === 'none') return el('div', { class: 'sr-banner' }, 'Audio is unavailable in this browser.');
  return null;
}

function stat(value: string, label: string): HTMLElement {
  return el('div', { class: 'sr-stat' }, el('span', { class: 'sr-stat-value' }, value), el('span', { class: 'sr-stat-label' }, label));
}

function meter(fraction: number): HTMLElement {
  const fill = el('span', { class: 'sr-meter-fill' });
  fill.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  return el('span', { class: 'sr-meter' }, fill);
}

/* ---------- map ---------- */

export function renderSpeedrun(root: HTMLElement, nav: SpeedrunNav): void {
  resetView(root);
  const content = loadSpeedrun();
  const records = allLessonRecords();
  topbar(root, nav);

  const page = el('main', { class: 'sr-page' });
  root.append(page);

  for (const message of content.errors) page.append(errorBox(`Skipped an invalid lesson file — ${message}`));

  const done = content.lessons.filter((l) => records[l.id]);
  const totalMs = done.reduce((sum, l) => sum + (records[l.id]?.bestMs ?? 0), 0);
  const avg = done.length
    ? Math.round((done.reduce((s, l) => s + (records[l.id]?.bestScore ?? 0), 0) / done.length) * 100)
    : 0;
  const next = content.lessons.find((l) => !records[l.id]);
  const cards = cardStats();

  const prefs = getPrefs();
  const autoplay = el('input', { type: 'checkbox', checked: prefs.autoplay });
  autoplay.addEventListener('change', () => setPrefs({ ...getPrefs(), autoplay: autoplay.checked }));
  const dictation = el('input', { type: 'checkbox', checked: prefs.dictation });
  dictation.addEventListener('change', () => setPrefs({ ...getPrefs(), dictation: dictation.checked }));

  const openLesson = next
    ? iconButton(
        `${cards.learned ? 'New lesson' : 'Start'} · ${next.id.toUpperCase()} ${next.title}`,
        ICONS.play,
        () => renderIntro(root, nav, next),
        cards.learned ? 'sr-btn' : 'sr-btn primary',
      )
    : null;
  const today = cards.learned
    ? iconButton(
        cards.due ? `Today · ${cards.due} due${next ? ' + new lesson' : ''}` : `Today · practice mix${next ? ' + new lesson' : ''}`,
        ICONS.play,
        () => startToday(root, nav),
        'sr-btn primary',
      )
    : null;

  page.append(
    el(
      'section',
      { class: 'sr-hero' },
      el(
        'div',
        { class: 'sr-hero-text' },
        el('p', { class: 'sr-eyebrow' }, 'Castellano → Català'),
        el('h1', { class: 'sr-title' }, 'From Castellano to C1, by the shortest route.'),
        el(
          'p',
          { class: 'sr-lede' },
          'Five-minute written drills on the verbs, pronouns and structures that carry most of real Catalan. ' +
            'No topic lists.',
        ),
        el(
          'div',
          { class: 'sr-actions' },
          today,
          openLesson,
          !next ? el('span', { class: 'sr-complete' }, 'All lessons done. Keep the reviews going.') : null,
        ),
        el(
          'p',
          { class: 'sr-muted' },
          cards.learned
            ? 'Daily: press Today. It brings back what is due, mixes in older items, then hands you the next lesson.'
            : 'Start with the first lesson. From then on, a daily Today session schedules your reviews.',
        ),
      ),
      el(
        'div',
        { class: 'sr-hero-stats' },
        stat(`${done.length}/${content.lessons.length}`, 'Lessons'),
        stat(String(cards.due), 'Due today'),
        stat(cards.learned ? `${cards.longTerm}/${cards.learned}` : '—', 'Long-term'),
        stat(done.length ? `${avg}%` : '—', 'First try'),
      ),
    ),
  );

  const banners = el('div', { class: 'sr-banners' });
  if (content.unreviewed.size > 0) {
    banners.append(
      el(
        'div',
        { class: 'sr-banner' },
        `Content not yet reviewed by a Catalan speaker (${[...content.unreviewed].join(', ')}). ` +
          'It follows the IEC norm for Central Catalan.',
      ),
    );
  }
  const notice = audioNotice();
  if (notice) banners.append(notice);
  void voicesReady().then(() => {
    // The browser voice list arrives late; drop the notice once it does.
    if (notice && !audioNotice()) notice.remove();
  });
  page.append(banners);

  for (const level of SPEEDRUN_LEVELS) {
    const lessons = content.byLevel[level];
    if (lessons.length === 0) continue;
    const levelDone = lessons.filter((l) => records[l.id]).length;
    const info = LEVEL_INFO[level];
    page.append(
      el(
        'section',
        { class: 'sr-level' },
        el(
          'div',
          { class: 'sr-level-head' },
          el('span', { class: 'sr-level-tag' }, level),
          el('div', { class: 'sr-level-text' }, el('h2', {}, info.name), el('p', {}, info.blurb)),
          el('div', { class: 'sr-level-progress' }, el('span', {}, `${levelDone}/${lessons.length}`), meter(levelDone / lessons.length)),
        ),
        el(
          'div',
          { class: 'sr-grid' },
          ...lessons.map((lesson, i) => {
            const rec = records[lesson.id];
            const card = el(
              'button',
              { class: `sr-card${rec ? ' cleared' : ''}${lesson === next ? ' next' : ''}`, type: 'button' },
              el(
                'span',
                { class: 'sr-card-top' },
                el('span', { class: 'sr-num' }, lesson.id.slice(3)),
                rec ? el('span', { class: 'sr-tick' }, icon(ICONS.check, 14)) : null,
              ),
              el('span', { class: 'sr-card-title' }, lesson.title),
              el(
                'span',
                { class: 'sr-card-meta' },
                rec ? `${formatMs(rec.bestMs)} · ${Math.round(rec.bestScore * 100)}%` : `${lesson.items.length} items`,
              ),
            );
            // Staggers the entrance animation; capped so long levels don't drag.
            card.style.setProperty('--i', String(Math.min(i, 16)));
            card.addEventListener('click', () => renderIntro(root, nav, lesson));
            return card;
          }),
        ),
      ),
    );
  }

  page.append(
    el(
      'footer',
      { class: 'sr-footer' },
      el(
        'div',
        { class: 'sr-toggles' },
        el('label', { class: 'sr-toggle' }, autoplay, el('span', {}, 'Auto-play the answer after each check')),
        el('label', { class: 'sr-toggle' }, dictation, el('span', {}, 'Dictation: hear the Catalan and write it')),
        el('span', { class: 'sr-muted' }, `Run time ${formatMs(totalMs)}`),
      ),
      el(
        'div',
        { class: 'sr-footer-actions' },
        button('Export progress', () => downloadProgress(), 'sr-btn ghost small'),
        button('Import progress', () => pickProgressFile(root, nav, banners), 'sr-btn ghost small'),
        button('Reset progress', () => {
        if (confirm('Clear all Speedrun progress, best times and the review deck?')) {
          resetProgress();
          renderSpeedrun(root, nav);
        }
      }, 'sr-btn ghost small'),
      ),
    ),
  );
}

function downloadProgress(): void {
  const blob = new Blob([exportProgress()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `catalan-speedrun-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickProgressFile(root: HTMLElement, nav: SpeedrunNav, banners: HTMLElement): void {
  const input = el('input', { type: 'file', accept: 'application/json,.json' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (!confirm('Replace the progress on this device with the progress in this file?')) return;
    try {
      importProgress(await file.text());
      renderSpeedrun(root, nav);
    } catch (err) {
      banners.prepend(errorBox(err instanceof Error ? err.message : String(err)));
      banners.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
  input.click();
}

/* ---------- intro ---------- */

function renderIntro(root: HTMLElement, nav: SpeedrunNav, lesson: SpeedrunLesson): void {
  resetView(root);
  const toMap = () => renderSpeedrun(root, nav);
  topbar(root, nav, { label: `${lesson.level} · ${lesson.id.slice(3)}`, back: toMap });

  const begin = () => runSession(root, nav, lessonEntries(lesson), lesson);
  const start = iconButton('Start', ICONS.play, begin, 'sr-btn primary');
  onKey((ev) => {
    if (ev.key === 'Escape') toMap();
  });

  root.append(
    el(
      'main',
      { class: 'sr-page sr-intro' },
      el(
        'header',
        { class: 'sr-intro-head' },
        el('p', { class: 'sr-eyebrow' }, `${lesson.level} · Lesson ${lesson.id.slice(3)} · ${lesson.items.length} items`),
        el('h1', { class: 'sr-title' }, lesson.title),
        el('p', { class: 'sr-lede' }, lesson.goal),
      ),
      rich(lesson.note),
      lesson.tables?.length
        ? el(
            'div',
            { class: 'sr-tables' },
            ...lesson.tables.map((t) =>
              el(
                'figure',
                { class: 'sr-table-card' },
                el('figcaption', {}, t.title),
                el(
                  'table',
                  { class: 'sr-table' },
                  t.cols ? el('thead', {}, el('tr', {}, ...t.cols.map((c) => el('th', {}, c)))) : null,
                  el(
                    'tbody',
                    {},
                    ...t.rows.map((row) => el('tr', {}, el('th', {}, row[0] ?? ''), ...row.slice(1).map(catalanCell))),
                  ),
                ),
              ),
            ),
          )
        : null,
      lesson.vocab?.length
        ? el(
            'section',
            { class: 'sr-vocab' },
            el('h2', { class: 'sr-section-label' }, 'Core words'),
            el(
              'div',
              { class: 'sr-vocab-list' },
              ...lesson.vocab.map(([ca, es]) => {
                const chip = el('button', { class: 'sr-word', type: 'button', title: 'Listen' }, el('span', { class: 'sr-word-ca' }, ca), el('span', { class: 'sr-word-es' }, es));
                chip.addEventListener('click', () => void speak(ca));
                return chip;
              }),
            ),
          )
        : null,
      el(
        'div',
        { class: 'sr-intro-foot' },
        start,
        el('span', { class: 'sr-keys' }, kbd('Enter'), ' start', kbd('Esc'), ' map', ' · Catalan in tables plays on click'),
      ),
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

/**
 * Today's session: due reviews plus a few older items, shuffled together so
 * consecutive items come from different lessons. The next new lesson follows.
 */
function startToday(root: HTMLElement, nav: SpeedrunNav): void {
  const content = loadSpeedrun();
  const byId = new Map(content.lessons.map((l) => [l.id, l]));
  const plan = planToday(allCards(), Date.now());
  const entries: Entry[] = [];
  for (const card of shuffle([...plan.due, ...plan.mix])) {
    const item = byId.get(card.lessonId)?.items[card.index];
    if (item) entries.push({ lessonId: card.lessonId, index: card.index, item });
  }
  if (entries.length > 0) return runSession(root, nav, entries, null);
  const records = allLessonRecords();
  const next = content.lessons.find((l) => !records[l.id]);
  if (next) renderIntro(root, nav, next);
  else renderSpeedrun(root, nav);
}

const ACCENT_KEYS = ['à', 'è', 'é', 'í', 'ï', 'ò', 'ó', 'ú', 'ü', 'ç', 'l·l', '·'];

function runSession(
  root: HTMLElement,
  nav: SpeedrunNav,
  entries: Entry[],
  lesson: SpeedrunLesson | null,
): void {
  resetView(root);
  const backToMap = () => renderSpeedrun(root, nav);

  const queue = [...entries];
  const firstTry = new Map<string, boolean>();
  let slips = 0;
  const started = Date.now();
  const key = (e: Entry) => `${e.lessonId}#${e.index}`;
  const unique = new Set(entries.map(key)).size;

  const fill = el('span', { class: 'sr-progress-fill' });
  const timer = el('span', { class: 'sr-timer' }, '0:00');
  const counter = el('span', { class: 'sr-counter' });
  const tick = setInterval(() => {
    timer.textContent = formatMs(Date.now() - started);
  }, 500);
  cleanups.push(() => clearInterval(tick));

  const quit = el('button', { class: 'sr-icon-btn', type: 'button', title: 'Back to map (Esc)' }, icon(ICONS.close, 18));
  quit.addEventListener('click', backToMap);

  root.append(
    el(
      'header',
      { class: 'sr-drill-top' },
      quit,
      el('span', { class: 'sr-progress' }, fill),
      counter,
      timer,
    ),
  );
  const stage = el('main', { class: 'sr-drill' });
  root.append(stage);

  // Shortcuts: Esc leaves; L / S replay the audio. While typing in the box
  // they need Alt, so they never eat a letter.
  let replay: ((slow: boolean) => void) | null = null;
  onKey((ev) => {
    if (ev.key === 'Escape') return backToMap();
    if (!replay || ev.metaKey || ev.ctrlKey) return;
    if (ev.code !== 'KeyL' && ev.code !== 'KeyS') return;
    const active = document.activeElement;
    const typing = active instanceof HTMLInputElement && !active.disabled;
    if (typing && !ev.altKey) return;
    ev.preventDefault();
    replay(ev.code === 'KeyS');
  });

  const updateBar = () => {
    const cleared = [...firstTry.keys()].filter((k) => !queue.some((e) => key(e) === k)).length;
    fill.style.width = `${(cleared / unique) * 100}%`;
    counter.textContent = `${cleared} / ${unique}`;
  };

  const showItem = () => {
    updateBar();
    replay = null;
    const entry = queue[0];
    if (!entry) return finish();
    const [es, pattern, hint] = entry.item;
    const dictation = getPrefs().dictation;
    const spoken = canonical(pattern);
    clear(stage);

    const input = el('input', {
      class: 'sr-input',
      type: 'text',
      autocomplete: 'off',
      spellcheck: false,
      placeholder: 'Escriu-ho en català',
    });
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('lang', 'ca');
    input.setAttribute('aria-label', 'Your Catalan translation');

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
        }, 'sr-key');
        b.tabIndex = -1;
        return b;
      }),
    );

    const feedback = el('div', { class: 'sr-feedback', role: 'status' });
    const checkBtn = el('button', { class: 'sr-btn primary', type: 'submit' }, 'Check');
    const giveUp = button('Show answer', () => resolve(null), 'sr-btn ghost');
    const actions = el(
      'div',
      { class: 'sr-drill-actions' },
      checkBtn,
      giveUp,
      dictation
        ? el('span', { class: 'sr-keys' }, kbd('Enter'), ' check', kbd('Alt'), kbd('L'), ' replay')
        : el('span', { class: 'sr-keys' }, kbd('Enter'), ' check', kbd('Esc'), ' map'),
    );
    const form = el('form', { class: 'sr-form' }, input, accentBar, actions);
    let answered = false;

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (answered || !input.value.trim()) return;
      resolve(checkAnswer(pattern, input.value));
    });

    const source = lesson ? '' : ` · from ${entry.lessonId.toUpperCase()}`;
    const prompt = el('h1', { class: 'sr-prompt' }, es);
    let promptBlock: HTMLElement[];
    if (dictation) {
      prompt.hidden = true;
      const reveal = button('Show Castellano', () => {
        prompt.hidden = false;
        reveal.remove();
        input.focus();
      }, 'sr-btn ghost');
      promptBlock = [
        el('p', { class: 'sr-eyebrow' }, `Listen and write${source}`),
        el(
          'div',
          { class: 'sr-listen-row' },
          iconButton('Play', ICONS.speaker, () => void speak(spoken), 'sr-btn sr-play'),
          listenButton(spoken, true),
          reveal,
        ),
        prompt,
      ];
      replay = (slow) => void speak(spoken, slow);
      void speak(spoken);
    } else {
      promptBlock = [el('p', { class: 'sr-eyebrow' }, `${lesson ? 'Translate into Catalan' : 'Today'}${source}`), prompt];
    }

    stage.append(
      el(
        'section',
        { class: 'sr-card-prompt' },
        ...promptBlock,
        ...(hint && !dictation ? [el('p', { class: 'sr-hint' }, hint)] : []),
        form,
      ),
      feedback,
    );
    input.focus();

    const resolve = (result: CheckResult | null) => {
      answered = true;
      input.disabled = true;
      accentBar.remove();
      actions.remove();

      const k = key(entry);
      const correct = result !== null && result.verdict !== 'wrong';
      if (!firstTry.has(k)) {
        firstTry.set(k, correct);
        recordAnswer(entry.lessonId, entry.index, correct, lesson ? 'lesson' : 'review');
      }
      if (result?.verdict === 'spelling') slips += 1;

      queue.shift();
      if (!correct) queue.splice(Math.min(REQUEUE_GAP, queue.length), 0, entry);

      const answer = result?.target ?? canonical(pattern);
      replay = (slow) => void speak(answer, slow);
      const next = iconButton(queue.length ? 'Continue' : 'Finish', ICONS.arrow, showItem, 'sr-btn primary');
      feedback.className = `sr-feedback ${verdictClass(result)}`;
      feedback.append(
        renderFeedback(result, pattern, input.value),
        ...(dictation ? [el('p', { class: 'sr-muted' }, 'Meaning: ', el('span', { lang: 'es' }, es))] : []),
        el(
          'div',
          { class: 'sr-drill-actions' },
          next,
          listenButton(answer),
          listenButton(answer, true),
          el('span', { class: 'sr-keys' }, kbd('Enter'), ' next', kbd('L'), ' listen', kbd('S'), ' slow'),
        ),
      );
      next.focus();
      // In dictation the learner has just heard it; replay only when they missed it.
      if (getPrefs().autoplay && (!dictation || result?.verdict !== 'exact')) void speak(answer);
    };
  };

  const finish = () => {
    clearInterval(tick);
    replay = null;
    const ms = Date.now() - started;
    const hits = [...firstTry.values()].filter(Boolean).length;
    const score = unique ? hits / unique : 0;
    clear(stage);

    const rec = lesson ? recordLesson(lesson.id, ms, score) : null;
    const content = loadSpeedrun();
    const records = allLessonRecords();
    const nextLesson = lesson
      ? content.lessons[content.lessons.indexOf(lesson) + 1]
      : content.lessons.find((l) => !records[l.id]);
    const newBest = rec !== null && rec.runs > 1 && rec.bestMs === ms;

    const nextBtn = nextLesson
      ? iconButton(`${lesson ? 'Next' : 'New lesson'} · ${nextLesson.title}`, ICONS.arrow, () => renderIntro(root, nav, nextLesson), 'sr-btn primary')
      : iconButton('Back to map', ICONS.back, backToMap, 'sr-btn primary');

    stage.append(
      el(
        'section',
        { class: 'sr-summary' },
        el('p', { class: 'sr-eyebrow' }, lesson ? `${lesson.level} · ${lesson.title}` : 'Today'),
        el('h1', { class: 'sr-title' }, lesson ? (newBest ? 'New best.' : 'Lesson complete.') : 'Reviews done.'),
        el(
          'div',
          { class: 'sr-hero-stats' },
          stat(formatMs(ms), 'Time'),
          stat(`${Math.round(score * 100)}%`, 'First try'),
          stat(String(slips), 'Spelling slips'),
        ),
        ...(rec
          ? [el('p', { class: 'sr-muted' }, `Personal best ${formatMs(rec.bestMs)} · ${Math.round(rec.bestScore * 100)}% · ${rec.runs} ${rec.runs === 1 ? 'run' : 'runs'}`)]
          : []),
        el(
          'div',
          { class: 'sr-actions' },
          nextBtn,
          lesson ? iconButton('Retry', ICONS.refresh, () => runSession(root, nav, lessonEntries(lesson), lesson), 'sr-btn') : null,
          nextLesson ? button('Map', backToMap, 'sr-btn ghost') : null,
        ),
      ),
    );
    nextBtn.focus();
  };

  showItem();
}

function verdictClass(result: CheckResult | null): string {
  if (result === null) return 'is-reveal';
  return result.verdict === 'exact' ? 'is-pass' : result.verdict === 'spelling' ? 'is-slip' : 'is-fail';
}

function renderFeedback(result: CheckResult | null, pattern: string, typed: string): HTMLElement {
  const box = el('div', { class: 'sr-feedback-body' });
  const status = (text: string, withIcon?: string[]) =>
    el('p', { class: 'sr-status' }, withIcon ? icon(withIcon, 16) : null, el('span', {}, text));
  const words = (r: CheckResult) =>
    el(
      'p',
      { class: 'sr-answer', lang: 'ca' },
      ...r.marks.flatMap((m, i) => [
        i > 0 ? ' ' : '',
        m.mark === 'ok' ? m.word : el('mark', { class: `sr-mark-${m.mark}` }, m.word),
      ]),
    );

  if (result === null) {
    box.append(status('Answer — it comes back in a moment'), el('p', { class: 'sr-answer', lang: 'ca' }, canonical(pattern)));
  } else if (result.verdict === 'exact') {
    box.append(status('Correct', ICONS.check), el('p', { class: 'sr-answer', lang: 'ca' }, result.target));
  } else if (result.verdict === 'spelling') {
    box.append(status('Right words — check the spelling'), words(result));
  } else {
    box.append(
      status('Not quite — it comes back in a moment', ICONS.close),
      words(result),
      el(
        'p',
        { class: 'sr-muted' },
        'You wrote ',
        el('span', { class: 'sr-typed' }, typed),
        ...(result.extra.length ? [' · extra ', el('s', {}, result.extra.join(' '))] : []),
      ),
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
    box.append(el('p', { class: 'sr-muted' }, 'Also accepted: ', el('span', { lang: 'ca' }, others.join(' · '))));
  }
  return box;
}
