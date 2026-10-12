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
  STAR_RULES,
  compareLevels,
  itemCredit,
  conjugationRating,
  courseRating,
  indexCards,
  isLessonCard,
  lessonDue,
  availableStars,
  isPerfect,
  lessonStars,
  levelProgress,
  nextStarOpensIn,
  vocabRating,
  type Rating,
  type Stars,
} from './mastery';
import {
  addXp,
  allCards,
  allForms,
  allFormsSeen,
  allLessonRecords,
  allXp,
  exportProgress,
  formatMs,
  getPrefs,
  getSprintBest,
  importProgress,
  mergeProgress,
  migrateProgress,
  needsMigration,
  recordAnswer,
  recordForms,
  recordLesson,
  recordSprint,
  resetProgress,
  setPrefs,
  xpStats,
} from './progress';
import { VoiceStream, bestProgress, canListen, markHeard, voiceState, type VoiceProgress } from './listen';
import { buildMigrationPlan } from './migrate';
import { SPRINT_SECONDS, conjugation, openTenses, roundFrom, sprintQueue, workingVerbs, type SprintCard } from './sprint';
import { planLessonReview, planToday, type SrsCard } from './srs';
import { planVocab, planVocabSet, setDue, unlockedSets, vocab, vocabStats } from './vocab';
import { decodeSync, downloadSync, encodeSync, formatShortCode, uploadSync } from './sync';
import {
  betterVoiceTip,
  catalanVoice,
  catalanVoices,
  isSpeaking,
  lastSpeechError,
  speak,
  speechSource,
  stopSpeaking,
  voicesReady,
} from './speak';
import { SPEEDRUN_LEVELS, type SpeedrunItem, type SpeedrunLesson, type SpeedrunLevel } from './types';

export interface SpeedrunNav {
  onExit: () => void;
  /** Opens Settings; `extra` is the speedrun's Practice section, `back` runs when it closes. */
  onSettings: (back: () => void, extra?: HTMLElement) => void;
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

/** Voice answers: with nothing said, the mic pauses after this long (battery), or the short one. */
const VOICE_IDLE_MS = 60_000;
const VOICE_SHORT_IDLE_MS = 8000;
/** Silence before deciding, by where the attempt stands: right, right so far (thinking), wrong. */
const ACCEPT_PAUSE_MS = 600;
const THINKING_PAUSE_MS = 3000;
const RESET_PAUSE_MS = 1500;
/** How long a wrong try stays on screen before it clears for the next. */
const RETRY_SHOW_MS = 900;

/** Pause before the mic starts by itself on a new phrase, when auto-start is on. */
const AUTO_LISTEN_MS = 1000;

/** Seconds before moving on after a perfect answer, when auto-advance is on. */
const AUTO_ADVANCE_SECONDS = 3;

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
  mic: ['M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z', 'M19 11a7 7 0 0 1-14 0', 'M12 18v3'],
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
        button('Settings', () => nav.onSettings(() => renderSpeedrun(root, nav), practiceSettings()), 'sr-btn ghost'),
      ),
    ),
  );
}

function audioNotice(): HTMLElement | null {
  const src = speechSource();
  const err = lastSpeechError();
  if (src === 'elevenlabs' && !err) return null;
  if (err) return el('div', { class: 'sr-banner' }, `ElevenLabs failed; using the browser voice. ${err}`);
  if (src === 'browser') {
    const tip = betterVoiceTip();
    if (!tip || getPrefs().voiceTipHidden) return null;
    const banner = el(
      'div',
      { class: 'sr-banner sr-voice-tip' },
      el('span', {}, `${catalanVoice() ? '' : 'No Catalan voice in this browser, so audio may sound off. '}${tip}`),
    );
    const hide = button('Hide', () => {
      setPrefs({ ...getPrefs(), voiceTipHidden: true });
      banner.remove();
    }, 'sr-btn ghost small');
    banner.append(hide);
    return banner;
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

/* ---------- practice preferences ----------
 * The same switches show at the bottom of the map and in Settings; each
 * change is saved at once.
 */

type PrefSwitch =
  | 'autoplay'
  | 'dictation'
  | 'voiceAnswers'
  | 'autoListen'
  | 'holdOpen'
  | 'waitForRest'
  | 'autoRetry'
  | 'autoAdvance';

/** The voice options, nested under Voice and greyed out while it is off. */
const VOICE_OPTIONS: [PrefSwitch, string][] = [
  ['autoListen', 'Start the mic by itself on each new phrase'],
  ['holdOpen', 'Keep listening until you speak'],
  ['waitForRest', 'Wait while the phrase is right so far'],
  ['autoRetry', 'After a wrong try, clear and listen again'],
];

function practiceToggles(): HTMLElement[] {
  const prefs = getPrefs();
  const toggle = (key: PrefSwitch, label: string, onChange?: (on: boolean) => void) => {
    const box = el('input', { type: 'checkbox', checked: prefs[key] });
    box.addEventListener('change', () => {
      setPrefs({ ...getPrefs(), [key]: box.checked });
      onChange?.(box.checked);
    });
    return el('label', { class: 'sr-toggle' }, box, el('span', {}, label));
  };
  const voiceGroup = (): HTMLElement[] => {
    const subs = VOICE_OPTIONS.map(([key, label]) => toggle(key, label));
    const setEnabled = (on: boolean) => {
      for (const sub of subs) {
        sub.classList.toggle('is-disabled', !on);
        sub.querySelector('input')!.disabled = !on;
      }
    };
    setEnabled(prefs.voiceAnswers);
    return [
      el(
        'div',
        { class: 'sr-toggle-group' },
        toggle('voiceAnswers', 'Voice: say the answer instead of typing', setEnabled),
        el('div', { class: 'sr-toggle-subs' }, ...subs),
      ),
    ];
  };
  return [
    toggle('autoplay', 'Auto-play the answer after each check'),
    toggle('dictation', 'Dictation: hear the Catalan and write it'),
    ...(canListen() ? voiceGroup() : []),
    toggle('autoAdvance', `Auto-advance after a perfect answer (${AUTO_ADVANCE_SECONDS} s)`),
  ];
}

/** The Catalan voice picker; empty until the device lists more than one Catalan voice. */
function voicePickerControl(): { el: HTMLElement; refresh: () => void } {
  const box = el('label', { class: 'sr-toggle sr-voice-pick' });
  const refresh = () => {
    clear(box);
    const voices = catalanVoices();
    if (voices.length < 2 || speechSource() !== 'browser') return;
    const select = el(
      'select',
      { class: 'sr-select' },
      el('option', { value: '' }, `Best available (${voices[0]!.name})`),
      ...voices.map((v) => el('option', { value: v.voiceURI, selected: v.voiceURI === getPrefs().voice }, v.name)),
    );
    select.setAttribute('aria-label', 'Catalan voice');
    select.addEventListener('change', () => {
      setPrefs({ ...getPrefs(), voice: select.value });
      void speak('Bon dia! Com estàs?');
    });
    box.append(el('span', {}, 'Voice'), select);
  };
  refresh();
  return { el: box, refresh };
}

/** The Practice section of the Settings dialog. */
function practiceSettings(): HTMLElement {
  const picker = voicePickerControl();
  void voicesReady().then(picker.refresh);
  return el(
    'section',
    { class: 'sr-settings-practice' },
    el('h3', {}, 'Practice'),
    el('div', { class: 'sr-settings-toggles' }, ...practiceToggles(), picker.el),
  );
}

/* ---------- map ---------- */

/** ★★☆ as spans, one per star open so far, so filled and empty stars can be styled. */
export function starRow(n: Stars, of: number = 3): HTMLElement {
  const row = el('span', { class: 'sr-stars', title: `${n} of ${of} ${of === 1 ? 'star' : 'stars'} open so far` });
  for (let i = 1; i <= of; i += 1) row.append(el('span', { class: i <= n ? 'on' : '' }, '★'));
  return row;
}

/** Held / open stars over a set of lessons: the denominator grows as tiers open with time. */
function starTally(lessons: SpeedrunLesson[], records: Record<string, { firstAt?: number }>, index: Map<string, SrsCard>, now: number): { held: number; open: number } {
  let held = 0;
  let open = 0;
  for (const l of lessons) {
    held += lessonStars(l, !!records[l.id], index);
    open += availableStars(l, records[l.id], index, now);
  }
  return { held, open };
}

/** A small mark for a lesson run with every item right first time. */
const perfectMark = () => el('span', { class: 'sr-perfect', title: 'Perfect run: every item right on the first try' }, '100%');

/** Due lesson items right now (the vocab builder keeps its own count). */
function lessonDueCount(now = Date.now()): number {
  return allCards().filter((c) => isLessonCard(c) && c.due <= now).length;
}

/** Above this many due items, Today skips the new lesson: reviews first. */
const HEAVY_DAY = 30;

/** The course level: where the next unfinished lesson sits. Vocab unlocks up to here. */
function courseLevel(): SpeedrunLevel {
  const records = allLessonRecords();
  const next = loadSpeedrun().lessons.find((l) => !records[l.id]);
  return next?.level ?? SPEEDRUN_LEVELS[SPEEDRUN_LEVELS.length - 1]!;
}

const pctLabel = (r: Rating) => `${r.level} · ${Math.round(r.pct * 100)}%`;

/** A side track: its rating on the course scale, how it compares with the course, and a way in. */
function ratingTile(title: string, rating: Rating, main: SpeedrunLevel, body: string, meta: string, go: () => void): HTMLElement {
  const cmp = compareLevels(rating.level, main);
  const tile = el(
    'button',
    { class: 'sr-quest', type: 'button' },
    el(
      'span',
      { class: 'sr-quest-title' },
      title,
      el('span', { class: `sr-badge${cmp < 0 ? ' behind' : ''}`, title: 'Rating on the A2-C1 scale' }, pctLabel(rating)),
    ),
    meter(rating.pct),
    el('span', { class: 'sr-quest-body' }, body),
    el(
      'span',
      { class: 'sr-quest-meta' },
      el('span', {}, meta),
      el('span', {}, cmp < 0 ? `Behind your ${main}` : cmp > 0 ? `Ahead of your ${main}` : `At your level`),
    ),
  );
  tile.addEventListener('click', go);
  return tile;
}

/**
 * One-time conversion of progress from before ratings: XP and streak are
 * backfilled, and conjugation forms from lessons already held (★★ or more)
 * are seeded. Returns a line for the map, or null when nothing changed.
 */
function migrateIfNeeded(): string | null {
  if (!needsMigration()) return null;
  const { xp, forms, words } = migrateProgress(buildMigrationPlan(loadSpeedrun().lessons, allLessonRecords(), allCards()));
  const parts = [
    xp ? `${xp} XP backfilled from your answer history` : '',
    forms ? `${forms} conjugation ${forms === 1 ? 'form' : 'forms'} carried into the new translation sprint` : '',
    words ? `${words} vocab ${words === 1 ? 'word' : 'words'} kept in the new topic list` : '',
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return `Progress converted: ${parts.join(', ')}. Stars and level percentages come straight from your reviews.`;
}

export function renderSpeedrun(root: HTMLElement, nav: SpeedrunNav, incomingSync?: string): void {
  resetView(root);
  if (incomingSync) queueMicrotask(() => void receiveSync(root, nav, incomingSync));
  const migrated = migrateIfNeeded();
  const content = loadSpeedrun();
  const records = allLessonRecords();
  const cards = allCards();
  const index = indexCards(cards);
  const now = Date.now();
  topbar(root, nav);

  const page = el('main', { class: 'sr-page' });
  root.append(page);
  for (const message of content.errors) page.append(errorBox(`Skipped an invalid lesson file — ${message}`));

  const done = content.lessons.filter((l) => records[l.id]);
  const totalMs = done.reduce((sum, l) => sum + (records[l.id]?.bestMs ?? 0), 0);
  const next = content.lessons.find((l) => !records[l.id]);
  const activeLevel: SpeedrunLevel = next?.level ?? SPEEDRUN_LEVELS[SPEEDRUN_LEVELS.length - 1]!;
  const due = lessonDueCount(now);
  const learned = cards.some(isLessonCard);
  const xp = xpStats(now);
  const vstats = vocabStats(cards, now, vocab, activeLevel);
  const conj = conjugationRating(allForms());
  const voc = vocabRating(index, vocab);
  const levelStarsOf = (lv: SpeedrunLevel) => starTally(content.byLevel[lv], records, index, now);
  const stars = starTally(content.lessons, records, index, now);
  const perfect = content.lessons.filter((l) => isPerfect(records[l.id])).length;
  const activePct = levelProgress(content.byLevel[activeLevel], index);

  const voicePicker = voicePickerControl();

  const openLesson = next
    ? iconButton(
        `${learned ? 'New lesson' : 'Start'} · ${next.id.toUpperCase()} ${next.title}`,
        ICONS.play,
        () => renderIntro(root, nav, next),
        learned ? 'sr-btn' : 'sr-btn primary',
      )
    : null;
  const today = learned
    ? iconButton(due ? `Today · ${due} due` : 'Today · practice mix', ICONS.play, () => startToday(root, nav), 'sr-btn primary')
    : null;

  page.append(
    el(
      'section',
      { class: 'sr-hero' },
      el(
        'div',
        { class: 'sr-hero-text' },
        el('p', { class: 'sr-eyebrow' }, `Castellano → Català · ${activeLevel} · ${LEVEL_INFO[activeLevel].name}`),
        el(
          'h1',
          { class: 'sr-title' },
          learned ? `${Math.round(activePct * 100)}% of ${activeLevel} held long-term.` : 'From Castellano to C1, by the shortest route.',
        ),
        el('div', { class: 'sr-hero-meter' }, meter(activePct)),
        el('div', { class: 'sr-actions' }, today, openLesson, !next ? el('span', { class: 'sr-complete' }, 'All lessons done. Keep the reviews going.') : null),
        el(
          'p',
          { class: 'sr-muted' },
          learned
            ? due > HEAVY_DAY
              ? `${due} items are due: clear them before new lessons. Today takes the weakest first.`
              : 'Daily: Today first (weakest items, mixed across lessons), then a new lesson.'
            : 'Five-minute drills on the verbs, pronouns and structures that carry most of real Catalan.',
        ),
      ),
      el(
        'div',
        { class: 'sr-hero-stats' },
        stat(xp.streak ? `${xp.streak}d` : '—', 'Streak'),
        stat(String(xp.today), 'XP today'),
        (() => {
          const t = levelStarsOf(activeLevel);
          return stat(`${t.held}/${t.open}`, `${activeLevel} stars`);
        })(),
      ),
    ),
  );

  const banners = el('div', { class: 'sr-banners' });
  if (migrated) banners.append(el('div', { class: 'sr-banner good' }, migrated));
  if (content.unreviewed.size > 0) {
    banners.append(el('div', { class: 'sr-banner' }, `Content not yet reviewed by a Catalan speaker (${[...content.unreviewed].join(', ')}). It follows the IEC norm for Central Catalan.`));
  }
  const notice = audioNotice();
  if (notice) banners.append(notice);
  void voicesReady().then(() => {
    // The browser voice list arrives late: refresh the notice and the voice picker once it does.
    const fresh = audioNotice();
    if (notice) notice.remove();
    if (fresh) banners.append(fresh);
    voicePicker.refresh();
  });
  page.append(banners);

  /* Side tracks: conjugation and vocab, rated on the same A2-C1 scale as the course. */
  page.append(
    el(
      'section',
      { class: 'sr-quests' },
      el('h2', { class: 'sr-section-label' }, 'Side tracks · rated against your level'),
      el(
        'div',
        { class: 'sr-quest-grid' },
        ratingTile(
          'Conjugation sprint',
          conj,
          activeLevel,
          `${SPRINT_SECONDS} seconds translating verb forms: 45 core verbs, each tense opening with its lesson.`,
          getSprintBest() ? `Best ${getSprintBest()}` : 'No sprint yet',
          () => renderSprint(root, nav),
        ),
        ratingTile(
          'Vocab builder',
          voc,
          activeLevel,
          `Exam-topic words the lessons skip. ${vstats.unlocked} of ${vstats.total} unlocked; more open with each level.`,
          `${vstats.known} known${vstats.due ? ` · ${vstats.due} due` : ''}`,
          () => renderVocab(root, nav),
        ),
      ),
    ),
  );

  for (const level of SPEEDRUN_LEVELS) {
    const lessons = content.byLevel[level];
    if (lessons.length === 0) continue;
    const levelDone = lessons.filter((l) => records[l.id]).length;
    const levelStars = levelStarsOf(level);
    const levelDue = lessons.reduce((n, l) => n + lessonDue(l, index, now), 0);
    const pct = levelProgress(lessons, index);
    const info = LEVEL_INFO[level];
    const section = el(
      'details',
      { class: 'sr-level', open: level === activeLevel },
      el(
        'summary',
        { class: 'sr-level-head' },
        el('span', { class: 'sr-level-tag' }, level),
        el('div', { class: 'sr-level-text' }, el('h2', {}, info.name), el('p', {}, `${levelDone}/${lessons.length} lessons · ★ ${levelStars.held}/${levelStars.open}${levelDue ? ` · ${levelDue} due` : ''}`)),
        el('div', { class: 'sr-level-progress' }, el('span', {}, `${Math.round(pct * 100)}%`), meter(pct)),
      ),
      el('p', { class: 'sr-level-blurb' }, info.blurb),
      el(
        'div',
        { class: 'sr-grid' },
        ...lessons.map((lesson, i) => {
          const rec = records[lesson.id];
          const n = lessonStars(lesson, !!rec, index);
          const ld = rec ? lessonDue(lesson, index, now) : 0;
          const card = el(
            'button',
            { class: `sr-card${rec ? ' cleared' : ''}${lesson === next ? ' next' : ''}`, type: 'button' },
            el(
              'span',
              { class: 'sr-card-top' },
              el('span', { class: 'sr-num' }, lesson.id.slice(3)),
              ld ? el('span', { class: 'sr-due', title: `${ld} due for review` }, `${ld} due`) : null,
            ),
            el('span', { class: 'sr-card-title' }, lesson.title),
            el(
              'span',
              { class: 'sr-card-meta' },
              rec ? el('span', { class: 'sr-card-stars' }, starRow(n, availableStars(lesson, rec, index, now)), isPerfect(rec) ? perfectMark() : null) : `${lesson.items.length} items`,
              rec ? el('span', {}, formatMs(rec.bestMs)) : null,
            ),
          );
          // Staggers the entrance animation; capped so long levels don't drag.
          card.style.setProperty('--i', String(Math.min(i, 16)));
          card.addEventListener('click', () => renderIntro(root, nav, lesson));
          return card;
        }),
      ),
    );
    page.append(section);
  }

  /* The whole course at a glance; the hero above stays on the current level. */
  const course = courseRating(content.byLevel, index);
  const rows: [string, Rating][] = [['Lessons', course], ['Conjugation', conj], ['Vocab', voc]];
  page.append(
    el(
      'section',
      { class: 'sr-overview' },
      el('h2', { class: 'sr-section-label' }, 'Course overview'),
      el(
        'div',
        { class: 'sr-overview-stats' },
        stat(`${Math.round(course.overall * 100)}%`, 'Course held'),
        stat(`${done.length}/${content.lessons.length}`, 'Lessons'),
        stat(`${stars.held}/${stars.open}`, 'Stars'),
        stat(`${perfect}/${done.length}`, 'Perfect runs'),
        stat(String(xp.total), 'XP'),
        stat(formatMs(totalMs), 'Run time'),
      ),
      el(
        'table',
        { class: 'sr-overview-grid' },
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', {}, ''),
            ...SPEEDRUN_LEVELS.map((lv) => el('th', { class: lv === activeLevel ? 'current' : '' }, lv)),
            el('th', {}, 'All'),
          ),
        ),
        el(
          'tbody',
          {},
          ...rows.map(([label, r]) =>
            el(
              'tr',
              {},
              el('th', {}, label),
              ...SPEEDRUN_LEVELS.map((lv) =>
                el('td', { class: lv === activeLevel ? 'current' : '' }, el('span', {}, `${Math.round(r.byLevel[lv] * 100)}%`), meter(r.byLevel[lv])),
              ),
              el('td', { class: 'all' }, el('span', {}, `${Math.round(r.overall * 100)}%`), meter(r.overall)),
            ),
          ),
        ),
      ),
      el('p', { class: 'sr-fineprint' }, 'Share of each level held long-term. A track rates at the first level below 80%.'),
    ),
  );

  page.append(
    el(
      'footer',
      { class: 'sr-footer' },
      el(
        'div',
        { class: 'sr-toggles' },
        ...practiceToggles(),
        voicePicker.el,
              ),
      el(
        'div',
        { class: 'sr-footer-actions' },
        button('Sync devices', () => openSyncPanel(root, nav), 'sr-btn ghost small'),
        button('Export progress', () => downloadProgress(), 'sr-btn ghost small'),
        button('Import progress', () => pickProgressFile(root, nav, banners), 'sr-btn ghost small'),
        button('Reset progress', () => {
          if (confirm('Clear all Speedrun progress, best times, XP and reviews?')) {
            resetProgress();
            renderSpeedrun(root, nav);
          }
        }, 'sr-btn ghost small'),
      ),
    ),
  );
}

/* ---------- sync ---------- */

function modal(...children: (Node | null)[]): { overlay: HTMLElement; close: () => void } {
  const overlay = el('div', { class: 'overlay sr-overlay' });
  const close = () => overlay.remove();
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) close();
  });
  overlay.append(el('div', { class: 'modal sr-modal', role: 'dialog' }, ...children));
  document.body.append(overlay);
  return { overlay, close };
}

/** Everything a device carries to another: lessons, review cards, XP, sprint best and conjugation forms. */
const currentSyncCode = () =>
  encodeSync(allLessonRecords(), allCards(), Date.now(), { xp: allXp(), sprintBest: getSprintBest(), forms: allForms() });

async function syncLink(): Promise<string> {
  const code = await currentSyncCode();
  return `${location.origin}${location.pathname}#sync=${code}`;
}

function openSyncPanel(root: HTMLElement, nav: SpeedrunNav): void {
  let close = () => {};

  /* Quick: short code through the paste service. */
  const codeOut = el('div', { class: 'sr-shortcode' });
  codeOut.setAttribute('aria-live', 'polite');
  const codeStatus = el('p', { class: 'sr-muted', role: 'status' });
  const getCode = iconButton('Get sync code', ICONS.arrow, async () => {
    getCode.disabled = true;
    codeStatus.textContent = 'Uploading…';
    try {
      const id = await uploadSync(await currentSyncCode());
      codeOut.textContent = formatShortCode(id);
      codeStatus.textContent = 'On your other device: Sync devices → Enter code. Valid for 24 hours.';
    } catch (err) {
      codeStatus.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      getCode.disabled = false;
    }
  }, 'sr-btn primary');

  const codeIn = el('input', {
    class: 'sr-input sr-code-input',
    type: 'text',
    placeholder: 'AU4-DFN-HWN',
    autocomplete: 'off',
    spellcheck: false,
  });
  codeIn.setAttribute('autocapitalize', 'characters');
  codeIn.setAttribute('aria-label', 'Sync code from your other device');
  const fetchStatus = el('p', { class: 'sr-muted', role: 'status' });
  const fetchCode = button('Get progress', async () => {
    fetchCode.disabled = true;
    fetchStatus.textContent = 'Fetching…';
    try {
      const text = await downloadSync(codeIn.value);
      close();
      await receiveSync(root, nav, text);
    } catch (err) {
      fetchStatus.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      fetchCode.disabled = false;
    }
  }, 'sr-btn primary');
  codeIn.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') fetchCode.click();
  });

  /* Fallback: the progress travels inside a link. */
  const status = el('p', { class: 'sr-muted', role: 'status' });
  const manual = el('textarea', { class: 'sr-code', readOnly: true, rows: 3 });
  manual.hidden = true;
  const copy = async () => {
    const url = await syncLink();
    try {
      await navigator.clipboard.writeText(url);
      status.textContent = 'Link copied. Paste it on your other device, or into a note or message to yourself.';
    } catch {
      // No clipboard access (older browsers, insecure context): let the person copy it by hand.
      manual.value = url;
      manual.hidden = false;
      manual.select();
      status.textContent = 'Copy this link:';
    }
  };
  const share = async () => {
    const url = await syncLink();
    try {
      await navigator.share({ title: 'Catalan Speedrun progress', text: 'Open this on your other device to sync progress.', url });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      await copy();
    }
  };
  const paste = el('textarea', { class: 'sr-code', rows: 2, placeholder: 'Paste a sync link here' });
  const merge = button('Merge link', () => {
    close();
    void receiveSync(root, nav, paste.value);
  }, 'sr-btn');

  const linkSection = el(
    'details',
    { class: 'sr-details' },
    el('summary', {}, 'No internet service? Sync with a link instead'),
    el(
      'p',
      { class: 'sr-muted' },
      'The progress travels inside the link itself. Send it any way you like — AirDrop, Messages or email to ' +
        'yourself, Notes — and open it on the other device. If it opens in a browser instead of the installed ' +
        'app (common on iPhone), paste it below.',
    ),
    el(
      'div',
      { class: 'sr-actions' },
      'share' in navigator ? iconButton('Share link', ICONS.arrow, () => void share(), 'sr-btn') : null,
      button('Copy link', () => void copy(), 'sr-btn'),
    ),
    status,
    manual,
    paste,
    el('div', { class: 'sr-actions' }, merge),
  );

  ({ close } = modal(
    el('h2', { class: 'sr-modal-title' }, 'Sync devices'),
    el(
      'p',
      { class: 'sr-muted' },
      'Get a code on one device, enter it on the other. Progress merges: for each item the newest answer wins. ' +
        'To make both identical, sync once in each direction.',
    ),
    el('h3', { class: 'sr-section-label' }, 'Send from this device'),
    el('div', { class: 'sr-actions' }, getCode),
    codeOut,
    codeStatus,
    el('h3', { class: 'sr-section-label' }, 'Receive on this device'),
    el('div', { class: 'sr-code-row' }, codeIn, fetchCode),
    fetchStatus,
    linkSection,
    el(
      'p',
      { class: 'sr-fineprint' },
      'Codes are stored for 24 hours on dpaste.com, a free public paste service. They contain only lesson numbers, ' +
        'scores and review dates.',
    ),
    el('div', { class: 'sr-actions' }, button('Close', () => close(), 'sr-btn ghost')),
  ));
}

async function receiveSync(root: HTMLElement, nav: SpeedrunNav, input: string): Promise<void> {
  let payload: Awaited<ReturnType<typeof decodeSync>>;
  try {
    payload = await decodeSync(input);
  } catch (err) {
    const { close } = modal(
      el('h2', { class: 'sr-modal-title' }, 'Couldn’t read that link'),
      el('p', { class: 'sr-muted' }, err instanceof Error ? err.message : String(err)),
      el('div', { class: 'sr-actions' }, button('Close', () => close(), 'sr-btn primary')),
    );
    return;
  }
  const lessons = Object.keys(payload.lessons).length;
  const when = new Date(payload.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
  let close = () => {};
  const accept = button('Merge', () => {
    const result = mergeProgress(payload);
    close();
    renderSpeedrun(root, nav);
    const done = modal(
      el('h2', { class: 'sr-modal-title' }, 'Synced.'),
      el(
        'p',
        { class: 'sr-muted' },
        `${result.lessons} lesson ${result.lessons === 1 ? 'record' : 'records'} and ${result.cards} ` +
          `review ${result.cards === 1 ? 'item' : 'items'} updated on this device.`,
      ),
      el('div', { class: 'sr-actions' }, button('Done', () => done.close(), 'sr-btn primary')),
    );
  }, 'sr-btn primary');
  ({ close } = modal(
    el('h2', { class: 'sr-modal-title' }, 'Merge progress from another device?'),
    el(
      'p',
      { class: 'sr-muted' },
      `Sent on ${when}: ${lessons} ${lessons === 1 ? 'lesson' : 'lessons'} and ${payload.cards.length} review ` +
        `${payload.cards.length === 1 ? 'item' : 'items'}. Nothing is lost: for each item, the most recent answer wins.`,
    ),
    el('div', { class: 'sr-actions' }, accept, button('Cancel', () => close(), 'sr-btn ghost')),
  ));
  accept.focus();
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

  const records = allLessonRecords();
  const finished = !!records[lesson.id];
  const index = indexCards(allCards());
  const now = Date.now();
  const stars = lessonStars(lesson, finished, index);
  const open = availableStars(lesson, records[lesson.id], index, now);
  const opensIn = nextStarOpensIn(lesson, records[lesson.id], index, now);
  const due = lessonDue(lesson, index, now);

  const begin = () => runSession(root, nav, lessonEntries(lesson), { kind: 'lesson', lesson });
  const review = () => startLessonReview(root, nav, lesson);
  // A finished lesson is reviewed by default; the full run stays available for speed.
  const start = finished
    ? iconButton(due ? `Review this lesson · ${due} due` : 'Review this lesson', ICONS.refresh, review, due ? 'sr-btn primary' : 'sr-btn')
    : iconButton('Start', ICONS.play, begin, 'sr-btn primary');
  const fullRun = finished ? iconButton('Run full lesson', ICONS.play, begin, due ? 'sr-btn' : 'sr-btn primary') : null;
  onKey((ev) => {
    if (ev.key === 'Escape') toMap();
  });

  const starPanel = finished
    ? el(
        'div',
        { class: 'sr-star-panel' },
        el('div', { class: 'sr-card-stars' }, starRow(stars, open), isPerfect(records[lesson.id]) ? perfectMark() : null),
        el(
          'ul',
          { class: 'sr-star-rules' },
          ...STAR_RULES.map((rule, i) =>
            el(
              'li',
              { class: i < stars ? 'on' : i < open ? '' : 'locked' },
              el('span', { class: 'sr-star-mark' }, '★'),
              rule,
              // Only the next tier gets a countdown; the one after follows from it.
              i === open && opensIn !== null ? el('span', { class: 'sr-star-when' }, `opens in ${opensIn} ${opensIn === 1 ? 'day' : 'days'}`) : null,
            ),
          ),
        ),
        el('p', { class: 'sr-muted' }, 'Later stars open as the review gaps grow, and can fade when items slip. Today and lesson reviews win them back.'),
      )
    : null;

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
        starPanel,
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
        fullRun,
        el('span', { class: 'sr-keys' }, kbd('Enter'), finished ? ' review' : ' start', kbd('Esc'), ' map', ' · Catalan in tables plays on click'),
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
  /**
   * False for items pulled in early to fill a session (not yet due). Their
   * answer counts for practice and still catches a miss, but a hit does not
   * push them further out: being shown early is not the spacing working.
   */
  due?: boolean;
}

type SessionMode =
  | { kind: 'lesson'; lesson: SpeedrunLesson }
  | { kind: 'today' }
  | { kind: 'lessonReview'; lesson: SpeedrunLesson }
  | { kind: 'vocab'; setId?: string };

const lessonEntries = (lesson: SpeedrunLesson): Entry[] =>
  lesson.items.map((item, index) => ({ lessonId: lesson.id, index, item }));

function planEntries(plan: { due: SrsCard[]; mix: SrsCard[] }, ordered: SrsCard[]): Entry[] {
  const byId = new Map(loadSpeedrun().lessons.map((l) => [l.id, l]));
  const dueKeys = new Set(plan.due.map((c) => `${c.lessonId}#${c.index}`));
  const out: Entry[] = [];
  for (const card of ordered) {
    const item = byId.get(card.lessonId)?.items[card.index];
    if (item) out.push({ lessonId: card.lessonId, index: card.index, item, due: dueKeys.has(`${card.lessonId}#${card.index}`) });
  }
  return out;
}

/**
 * Today: the weakest due items first (most overdue, most lapsed), interleaved
 * so neighbours come from different lessons, plus a few early items for
 * spacing practice. Vocab words keep their own queue in the vocab builder.
 */
function startToday(root: HTMLElement, nav: SpeedrunNav): void {
  const plan = planToday(allCards().filter(isLessonCard), Date.now());
  // Mix items go in between the due ones rather than all at the end.
  const ordered = [...plan.due];
  plan.mix.forEach((c, i) => ordered.splice(Math.min(ordered.length, (i + 1) * 4 + i), 0, c));
  const entries = planEntries(plan, ordered);
  if (entries.length > 0) return runSession(root, nav, entries, { kind: 'today' });
  const records = allLessonRecords();
  const next = loadSpeedrun().lessons.find((l) => !records[l.id]);
  if (next) renderIntro(root, nav, next);
  else renderSpeedrun(root, nav);
}

/** Review one lesson: everything of it that is due, topped up with its weakest items. */
function startLessonReview(root: HTMLElement, nav: SpeedrunNav, lesson: SpeedrunLesson): void {
  const plan = planLessonReview(allCards().filter((c) => c.lessonId === lesson.id), Date.now());
  const entries = planEntries(plan, [...plan.due, ...plan.mix]);
  if (entries.length === 0) return runSession(root, nav, lessonEntries(lesson), { kind: 'lesson', lesson });
  runSession(root, nav, entries, { kind: 'lessonReview', lesson });
}

/** XP per answer: first try right, right after a miss, or a vocab word. Never touches level progress. */
const XP = { first: 10, retry: 2, word: 5 } as const;

const ACCENT_KEYS = ['à', 'è', 'é', 'í', 'ï', 'ò', 'ó', 'ú', 'ü', 'ç', 'l·l', '·'];

/** Buttons that type the characters a Castellano keyboard lacks, at the cursor. */
function accentBar(input: HTMLInputElement): HTMLElement {
  return el(
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
}

function runSession(
  root: HTMLElement,
  nav: SpeedrunNav,
  entries: Entry[],
  mode: SessionMode,
): void {
  resetView(root);
  const backToMap = () => renderSpeedrun(root, nav);
  const lesson = mode.kind === 'lesson' ? mode.lesson : null;
  let earned = 0;

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

  // Shortcuts: Esc leaves; L / S replay the audio; M speaks the answer in
  // voice mode. While typing in the box they need Alt, so they never eat a letter.
  let replay: ((slow: boolean) => void) | null = null;
  let mic: (() => void) | null = null;
  // Voice answers: one recognition for the whole session (VoiceStream). Each item
  // points these handlers at itself and resets the attempt, so the mic stays on
  // from phrase to phrase instead of switching off and on.
  const voiceHandlers: { text?: (candidates: string[]) => void; state?: (on: boolean) => void; error?: (err: Error) => void } = {};
  const stream = canListen()
    ? new VoiceStream({
        onText: (c) => voiceHandlers.text?.(c),
        onState: (on) => voiceHandlers.state?.(on),
        onError: (err) => voiceHandlers.error?.(err),
      })
    : null;
  cleanups.push(() => stream?.stop());
  /** Things one item puts outside the stage (the mic dock), undone when the item ends. */
  let itemCleanups: (() => void)[] = [];
  const endItem = () => {
    for (const fn of itemCleanups) fn();
    itemCleanups = [];
  };
  cleanups.push(endItem);
  onKey((ev) => {
    if (ev.key === 'Escape') return backToMap();
    if (ev.metaKey || ev.ctrlKey) return;
    if (ev.code !== 'KeyL' && ev.code !== 'KeyS' && ev.code !== 'KeyM') return;
    const active = document.activeElement;
    const typing = active instanceof HTMLInputElement && !active.disabled;
    if (typing && !ev.altKey) return;
    if (ev.code === 'KeyM') {
      if (!mic) return;
      ev.preventDefault();
      return mic();
    }
    if (!replay) return;
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
    mic = null;
    endItem();
    const entry = queue[0];
    if (!entry) return finish();
    const [es, pattern, hint] = entry.item;
    const dictation = getPrefs().dictation;
    const voice = getPrefs().voiceAnswers && canListen();
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

    const accents = accentBar(input);

    const feedback = el('div', { class: 'sr-feedback', role: 'status' });
    const checkBtn = el('button', { class: 'sr-btn primary', type: 'submit' }, 'Check');
    const giveUp = button('Show answer', () => resolve(null), 'sr-btn ghost');
    // Voice mode: a big mic button leads; the text box waits behind "Type instead".
    // Tap and say it; it stops on a pause, or tap again when done. What is heard
    // shows word by word against the answer: green match, yellow near miss, grey no match.
    const heardLine = el('p', { class: 'sr-heard', role: 'status' });
    const retryNote = el('p', { class: 'sr-retry', role: 'status' });
    const heardWords = el('p', { class: 'sr-heard-words', lang: 'ca' });
    heardWords.setAttribute('aria-live', 'polite');
    const micBtn = voice ? el('button', { class: 'sr-mic-big', type: 'button', title: 'Speak (Alt+M)' }, icon(ICONS.mic, 36)) : null;
    micBtn?.setAttribute('aria-label', 'Speak');
    const micLabel = el('span', { class: 'sr-mic-label' }, 'Tap to speak');
    const typeBox = el('div', { class: 'sr-type-box' }, input, accents);
    const typeToggle = voice ? button('Type instead', () => openTyping(), 'sr-btn ghost') : null;
    /** Auto-start (a setting) is armed until it fires, the mic is tapped, or typing takes over. */
    let autoArmed = false;
    let introAudio: Promise<void> = Promise.resolve();
    /** Opens the text box; choosing to type stops the mic, unless keepMic (after three misses). */
    const openTyping = (keepMic = false) => {
      if (autoArmed) micLabel.textContent = 'Tap to speak';
      autoArmed = false;
      if (!keepMic && stream?.active) stream.stop();
      typeBox.hidden = false;
      checkBtn.hidden = false;
      typeToggle?.remove();
      input.focus();
    };
    if (voice) {
      typeBox.hidden = true;
      checkBtn.hidden = true;
    }
    const actions = el(
      'div',
      { class: 'sr-drill-actions' },
      checkBtn,
      giveUp,
      typeToggle,
      voice
        ? el('span', { class: 'sr-keys' }, kbd('Alt'), kbd('M'), ' speak', kbd('Esc'), ' map')
        : dictation
          ? el('span', { class: 'sr-keys' }, kbd('Enter'), ' check', kbd('Alt'), kbd('L'), ' replay')
          : el('span', { class: 'sr-keys' }, kbd('Enter'), ' check', kbd('Esc'), ' map'),
    );
    // The mic docks at the bottom of the screen, in the same place for every item.
    // It lives outside the drill card: the card's entrance animation uses a
    // transform, which would pin a fixed child to the card instead of the screen.
    const voicePanel = micBtn ? el('div', { class: 'sr-voice-dock' }, micLabel, micBtn) : null;
    if (voicePanel) {
      root.append(voicePanel);
      itemCleanups.push(() => voicePanel.remove());
    }
    const form = el('form', { class: 'sr-form' }, typeBox, actions);
    let answered = false;

    if (voice && micBtn && stream) {
      // The mic stays on (one recognition for the session). Nothing is decided
      // while the learner speaks: every word restarts the clock, and the decision
      // comes after a silence whose length depends on where the attempt stands.
      const prefs = getPrefs();
      let misses = 0;
      let current: VoiceProgress | null = null;
      let decideTimer: ReturnType<typeof setTimeout> | undefined;
      let retryTimer: ReturnType<typeof setTimeout> | undefined;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      /** The app spoke while the mic was on: what it heard is set aside once it stops. */
      let heardTheApp = false;
      itemCleanups.push(() => {
        clearTimeout(decideTimer);
        clearTimeout(retryTimer);
        clearTimeout(idleTimer);
        voiceHandlers.text = undefined;
        voiceHandlers.state = undefined;
        voiceHandlers.error = undefined;
      });
      const showMic = (on: boolean) => {
        micBtn.classList.toggle('is-listening', on);
        micLabel.textContent = on ? (current ? 'Listening… tap when done' : 'Listening…') : misses ? 'Tap to try again' : 'Tap to speak';
      };
      const showHeard = (text: string) => {
        clear(heardWords);
        heardWords.classList.remove('is-perfect');
        if (!text) {
          if (stream.active) heardWords.append(el('span', { class: 'sr-hw-wait' }, '…'));
          return;
        }
        markHeard(pattern, text).forEach(({ word, mark }, i) => {
          if (i > 0) heardWords.append(' ');
          heardWords.append(el('span', { class: `sr-hw-${mark}` }, word));
        });
      };
      /** Nothing said for a long while: pause the mic (battery); a tap resumes it. */
      const armIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          if (answered || current || !stream.active) return;
          stream.stop();
          showHeard('');
          heardLine.textContent = 'Mic paused. Tap to speak.';
        }, prefs.holdOpen ? VOICE_IDLE_MS : VOICE_SHORT_IDLE_MS);
      };
      const accept = (text: string, result: CheckResult) => {
        clearTimeout(decideTimer);
        current = null;
        showHeard(text);
        if (result.verdict === 'exact') heardWords.classList.add('is-perfect');
        input.value = text;
        resolve(result);
      };
      /** A finished attempt that is not right. */
      const missed = (text: string) => {
        clearTimeout(decideTimer);
        current = null;
        misses += 1;
        if (misses >= 3 && typeBox.hidden) {
          openTyping(true);
          heardLine.textContent = 'Having trouble? Type it instead, or keep trying.';
        }
        if (prefs.autoRetry && stream.active) {
          // Clear and listen again; the mic never went off.
          showHeard(text);
          retryNote.textContent = 'Try again';
          stream.reset();
          retryTimer = setTimeout(() => {
            if (!answered && !current) showHeard('');
          }, RETRY_SHOW_MS);
          showMic(true);
          armIdle();
          return;
        }
        stream.stop();
        showHeard(text);
        input.value = text;
        if (!heardLine.textContent) heardLine.textContent = 'Not quite. Tap to try again, or Show answer.';
      };
      const decide = (p: VoiceProgress) => {
        clearTimeout(decideTimer);
        current = p;
        const state = voiceState(p);
        const wait = state === 'right' ? ACCEPT_PAUSE_MS : state === 'onTrack' && prefs.waitForRest ? THINKING_PAUSE_MS : RESET_PAUSE_MS;
        decideTimer = setTimeout(() => {
          if (answered || current !== p) return;
          if (state === 'right') accept(p.text, p.result);
          else missed(p.text);
        }, wait);
      };
      voiceHandlers.state = showMic;
      voiceHandlers.error = (err) => {
        showMic(false);
        heardLine.textContent = err.message;
        openTyping();
      };
      voiceHandlers.text = (candidates) => {
        if (answered) return;
        if (isSpeaking()) {
          heardTheApp = true; // the mic hears the app reading Catalan; not an answer
          return;
        }
        if (heardTheApp) {
          heardTheApp = false;
          stream.reset();
          return;
        }
        clearTimeout(retryTimer);
        retryNote.textContent = '';
        heardLine.textContent = '';
        const p = bestProgress(pattern, '', candidates);
        if (!p) return;
        showHeard(p.text);
        decide(p);
        showMic(true);
        armIdle();
      };
      // A new phrase: same recognition, fresh attempt.
      stream.reset();
      showMic(stream.active);
      showHeard('');
      if (stream.active) armIdle();
      micBtn.addEventListener('click', () => mic?.());
      mic = () => {
        autoArmed = false;
        if (answered) return;
        if (!stream.active) {
          stopSpeaking();
          heardLine.textContent = '';
          stream.start();
          stream.reset();
          showHeard('');
          armIdle();
          return;
        }
        if (current) {
          // "Done": decide now.
          const p = current;
          if (p.result.verdict !== 'wrong') accept(p.text, p.result);
          else missed(p.text);
          return;
        }
        stream.stop(); // nothing said: a tap turns the mic off
        showHeard('');
      };
      // Typing takes over from the mic.
      input.addEventListener('input', () => {
        if (stream.active) stream.stop();
      });
    }

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (answered) return;
      if (stream?.active && voice) return mic?.(); // Check while listening means "done"
      if (!input.value.trim()) {
        if (voice) heardLine.textContent = 'Nothing to check yet: tap the mic and say it, or type it.';
        return;
      }
      resolve(checkAnswer(pattern, input.value));
    });

    const source = mode.kind === 'today' ? ` · from ${entry.lessonId.toUpperCase()}` : '';
    const label =
      mode.kind === 'lesson' ? 'Translate into Catalan'
      : mode.kind === 'today' ? 'Today'
      : mode.kind === 'vocab' ? `Vocab · ${vocab.sets.find((x) => x.id === mode.setId)?.title ?? 'translate the word'}`
      : `Review · ${mode.lesson.title}`;
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
      introAudio = speak(spoken);
    } else {
      promptBlock = [el('p', { class: 'sr-eyebrow' }, `${label}${source}`), prompt];
    }

    stage.append(
      el(
        'section',
        { class: 'sr-card-prompt' },
        ...promptBlock,
        ...(hint && !dictation ? [el('p', { class: 'sr-hint' }, hint)] : []),
        // What is heard sits right under the prompt, in the same type, coloured as it comes.
        ...(voice ? [retryNote, heardWords, heardLine] : []),
        form,
      ),
      feedback,
    );
    stage.classList.toggle('has-dock', voice);
    // Auto-start: the mic turns on by itself a moment after a new phrase appears
    // (after the Catalan audio, in dictation, so it doesn't hear the app).
    if (voice && getPrefs().autoListen) {
      autoArmed = true;
      micLabel.textContent = 'Starting…';
      void introAudio.then(() => {
        const timer = setTimeout(() => {
          if (autoArmed && !answered && !stream?.active) mic?.();
        }, AUTO_LISTEN_MS);
        itemCleanups.push(() => clearTimeout(timer));
      });
    }
    input.focus();

    const resolve = (result: CheckResult | null) => {
      answered = true;
      mic = null;
      endItem();
      heardLine.remove();
      stage.classList.remove('has-dock');
      input.disabled = true;
      accents.remove();
      actions.remove();

      const k = key(entry);
      const correct = result !== null && result.verdict !== 'wrong';
      if (!firstTry.has(k)) {
        firstTry.set(k, correct);
        recordAnswer(entry.lessonId, entry.index, correct, mode.kind === 'lesson' || entry.due === false ? 'lesson' : 'review');
        if (correct) earned += mode.kind === 'vocab' ? XP.word : XP.first;
        if (correct) addXp(mode.kind === 'vocab' ? XP.word : XP.first);
      } else if (correct) {
        earned += XP.retry;
        addXp(XP.retry);
      }
      if (result?.verdict === 'spelling') slips += 1;

      queue.shift();
      if (!correct) queue.splice(Math.min(REQUEUE_GAP, queue.length), 0, entry);

      const answer = result?.target ?? canonical(pattern);
      const next = iconButton(queue.length ? 'Continue' : 'Finish', ICONS.arrow, showItem, 'sr-btn primary');
      // Auto-advance (a setting): after a perfect answer, Continue counts down and moves on.
      // Replaying the audio stops the countdown; Continue still goes straight away.
      const nextLabel = next.querySelector('span')!;
      const baseLabel = nextLabel.textContent ?? '';
      let countdown: ReturnType<typeof setInterval> | undefined;
      const cancelAdvance = () => {
        if (countdown === undefined) return;
        clearInterval(countdown);
        countdown = undefined;
        nextLabel.textContent = baseLabel;
      };
      itemCleanups.push(cancelAdvance);
      if (getPrefs().autoAdvance && result?.verdict === 'exact') {
        let left = AUTO_ADVANCE_SECONDS;
        nextLabel.textContent = `${baseLabel} · ${left}`;
        countdown = setInterval(() => {
          left -= 1;
          if (left > 0) nextLabel.textContent = `${baseLabel} · ${left}`;
          else {
            cancelAdvance();
            showItem();
          }
        }, 1000);
      }
      replay = (slow) => {
        cancelAdvance();
        void speak(answer, slow);
      };
      const listenNormal = listenButton(answer);
      const listenSlow = listenButton(answer, true);
      for (const b of [listenNormal, listenSlow]) b.addEventListener('click', cancelAdvance);
      feedback.className = `sr-feedback ${verdictClass(result)}`;
      feedback.append(
        renderFeedback(result, pattern, input.value),
        ...(dictation ? [el('p', { class: 'sr-muted' }, 'Meaning: ', el('span', { lang: 'es' }, es))] : []),
        el(
          'div',
          { class: 'sr-drill-actions' },
          next,
          listenNormal,
          listenSlow,
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
    stream?.stop(); // the session is over: mic off
    const ms = Date.now() - started;
    const hits = [...firstTry.values()].filter(Boolean).length;
    const score = unique ? hits / unique : 0;
    clear(stage);

    const wasPerfect = lesson ? isPerfect(allLessonRecords()[lesson.id]) : false;
    const rec = lesson ? recordLesson(lesson.id, ms, score) : null;
    const content = loadSpeedrun();
    const records = allLessonRecords();
    const perfectRun = unique > 0 && score >= 1;
    const newBest = rec !== null && rec.runs > 1 && rec.bestMs === ms;
    const heavy = lessonDueCount() > HEAVY_DAY;
    const firstNew = content.lessons.find((l) => !records[l.id]);

    let nextBtn: HTMLButtonElement;
    let extra: (HTMLElement | null)[] = [];
    let badge: HTMLElement | null = null;
    let eyebrow: string;
    let title: string;
    if (mode.kind === 'lesson') {
      const after = content.lessons[content.lessons.indexOf(mode.lesson) + 1];
      nextBtn = after
        ? iconButton(`Next · ${after.title}`, ICONS.arrow, () => renderIntro(root, nav, after), 'sr-btn primary')
        : iconButton('Back to map', ICONS.back, backToMap, 'sr-btn primary');
      extra = [iconButton('Retry', ICONS.refresh, () => runSession(root, nav, lessonEntries(mode.lesson), mode), 'sr-btn')];
      eyebrow = `${mode.lesson.level} · ${mode.lesson.title}`;
      title = perfectRun ? (newBest ? 'Perfect run, new best.' : 'Perfect run.') : newBest ? 'New best.' : 'Lesson complete.';
      if (perfectRun && !wasPerfect) badge = el('p', { class: 'sr-perfect-note' }, perfectMark(), 'First perfect run of this lesson. It shows on the map.');
    } else if (mode.kind === 'lessonReview') {
      const l = mode.lesson;
      nextBtn = iconButton('Back to the lesson', ICONS.back, () => renderIntro(root, nav, l), 'sr-btn primary');
      eyebrow = `Review · ${l.title}`;
      title = 'Lesson reviewed.';
    } else if (mode.kind === 'vocab') {
      const set = mode.setId ? vocab.sets.find((x) => x.id === mode.setId) : undefined;
      nextBtn = set
        ? iconButton('Practise this set again', ICONS.refresh, () => startVocabSet(root, nav, set.id), 'sr-btn primary')
        : iconButton('Another round', ICONS.refresh, () => startVocab(root, nav), 'sr-btn primary');
      extra = [button('Vocab builder', () => renderVocab(root, nav), 'sr-btn')];
      eyebrow = set ? `Vocab · ${set.title}` : 'Vocab builder';
      title = set ? 'Set done.' : 'Round done.';
    } else {
      // A heavy backlog means more reviews first; otherwise the next lesson.
      nextBtn = heavy
        ? iconButton(`Keep reviewing · ${lessonDueCount()} due`, ICONS.refresh, () => startToday(root, nav), 'sr-btn primary')
        : firstNew
          ? iconButton(`New lesson · ${firstNew.title}`, ICONS.arrow, () => renderIntro(root, nav, firstNew), 'sr-btn primary')
          : iconButton('Back to map', ICONS.back, backToMap, 'sr-btn primary');
      eyebrow = 'Today';
      title = 'Reviews done.';
    }

    stage.append(
      el(
        'section',
        { class: 'sr-summary' },
        el('p', { class: 'sr-eyebrow' }, eyebrow),
        el('h1', { class: 'sr-title' }, title),
        el(
          'div',
          { class: 'sr-hero-stats' },
          stat(formatMs(ms), 'Time'),
          stat(`${Math.round(score * 100)}%`, 'First try'),
          stat(`+${earned}`, 'XP'),
          stat(String(slips), 'Spelling slips'),
        ),
        badge,
        ...(rec
          ? [el('p', { class: 'sr-muted' }, `Personal best ${formatMs(rec.bestMs)} · ${Math.round(rec.bestScore * 100)}% · ${rec.runs} ${rec.runs === 1 ? 'run' : 'runs'}`)]
          : []),
        mode.kind === 'today' && heavy ? el('p', { class: 'sr-muted' }, 'Still a backlog: one more round before new material keeps the reviews from snowballing.') : null,
        el('div', { class: 'sr-actions' }, nextBtn, ...extra, button('Map', backToMap, 'sr-btn ghost')),
      ),
    );
    nextBtn.focus();
  };

  showItem();
}

/* ---------- conjugation sprint ---------- */

function renderSprint(root: HTMLElement, nav: SpeedrunNav): void {
  resetView(root);
  const toMap = () => renderSpeedrun(root, nav);
  topbar(root, nav, { label: 'Conjugation sprint', back: toMap });
  const main = courseLevel();
  const rating = conjugationRating(allForms());
  const finished = new Set(Object.keys(allLessonRecords()));
  const queue = sprintQueue(finished, allForms(), allFormsSeen(), Date.now(), { maxLevel: main });
  const round = roundFrom(queue);
  const toReview = queue.missed.length + queue.review.length;
  const working = workingVerbs(queue);
  const best = getSprintBest();
  const start = iconButton('Start sprint', ICONS.play, () => runSprint(root, nav, round), 'sr-btn primary');
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
        el('p', { class: 'sr-eyebrow' }, `Side track · rated ${pctLabel(rating)} · course at ${main}`),
        el('h1', { class: 'sr-title' }, 'Conjugation sprint'),
        el(
          'p',
          { class: 'sr-lede' },
          `${SPRINT_SECONDS} seconds. Translate each Castellano form into Catalan; a right answer moves on at once, ` +
            'a miss shows the form. Misses come back next round; forms you get right rest (a day, then 4, then 10) ' +
            'before they return. New forms mix a handful of verbs across every open tense; when you have seen all of a verb, ' +
            'the next most common one joins.',
        ),
        working.length ? el('p', { class: 'sr-working' }, 'New forms now from ', el('strong', { lang: 'ca' }, working.join(', ')), '.') : null,
      ),
      tenseList(finished),
      verbList(main),
      el(
        'div',
        { class: 'sr-hero-stats' },
        stat(best ? String(best) : '—', 'Best'),
        stat(String(toReview), 'To review'),
        stat(pctLabel(rating), 'Rating'),
      ),
      levelBars(rating, 'A form counts once you get it right twice in a row; a miss resets it.'),
      el('div', { class: 'sr-intro-foot' }, start, el('span', { class: 'sr-keys' }, kbd('Enter'), ' start', kbd('Esc'), ' map')),
    ),
  );
  start.focus();
}

/** The sprint's tenses: open ones, and the lesson that opens each of the rest. */
function tenseList(finished: Set<string>): HTMLElement {
  const open = openTenses(finished);
  return el(
    'ul',
    { class: 'sr-tense-list' },
    ...conjugation.tenses.map((t) =>
      el(
        'li',
        { class: open.has(t.id) ? 'open' : '' },
        el('span', { class: 'sr-level-tag' }, t.level),
        el('span', {}, t.label),
        open.has(t.id) ? null : el('span', { class: 'sr-muted' }, `opens with ${t.lesson.toUpperCase()}`),
      ),
    ),
  );
}

/** The sprint's verbs by level: those at or below the course level are drilled. */
function verbList(main: SpeedrunLevel): HTMLElement {
  const top = SPEEDRUN_LEVELS.indexOf(main);
  return el(
    'div',
    { class: 'sr-verb-levels' },
    ...SPEEDRUN_LEVELS.map((lv, i) => {
      const verbs = conjugation.verbs.filter((v) => v.level === lv).map((v) => v.ca);
      return el(
        'p',
        { class: i <= top ? 'open' : '' },
        el('span', { class: 'sr-level-tag' }, lv),
        el('span', { lang: 'ca' }, verbs.join(', ')),
        i <= top ? null : el('span', { class: 'sr-muted' }, `opens at ${lv}`),
      );
    }),
  );
}

/** Per-level bars for a rating: the level being worked on, and the ones around it. */
function levelBars(rating: Rating, caption: string): HTMLElement {
  return el(
    'section',
    { class: 'sr-level-bars' },
    ...SPEEDRUN_LEVELS.map((lv) =>
      el(
        'div',
        { class: `sr-level-bar${lv === rating.level ? ' current' : ''}` },
        el('span', { class: 'sr-level-tag' }, lv),
        meter(rating.byLevel[lv]),
        el('span', { class: 'sr-muted' }, `${Math.round(rating.byLevel[lv] * 100)}%`),
      ),
    ),
    el('p', { class: 'sr-fineprint' }, caption),
  );
}

function runSprint(root: HTMLElement, nav: SpeedrunNav, round: SprintCard[]): void {
  resetView(root);
  const toMap = () => renderSpeedrun(root, nav);
  const before = conjugationRating(allForms());
  const results: [SprintCard, boolean][] = [];
  let i = 0;
  let over = false;
  const ends = Date.now() + SPRINT_SECONDS * 1000;

  const fill = el('span', { class: 'sr-progress-fill' });
  const clock = el('span', { class: 'sr-timer' }, `${SPRINT_SECONDS}s`);
  const scoreEl = el('span', { class: 'sr-counter' }, '0');
  const quit = el('button', { class: 'sr-icon-btn', type: 'button', title: 'Back to map (Esc)' }, icon(ICONS.close, 18));
  quit.addEventListener('click', toMap);
  root.append(el('header', { class: 'sr-drill-top' }, quit, el('span', { class: 'sr-progress' }, fill), scoreEl, clock));

  const context = el('p', { class: 'sr-eyebrow' });
  const prompt = el('h1', { class: 'sr-prompt sr-sprint-prompt' });
  const input = el('input', { class: 'sr-input', type: 'text', autocomplete: 'off', spellcheck: false, placeholder: 'en català' });
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('lang', 'ca');
  input.setAttribute('aria-label', 'The Catalan form');
  const flash = el('p', { class: 'sr-sprint-flash', role: 'status' });
  const form = el('form', { class: 'sr-form' }, input, accentBar(input));
  const stage = el('main', { class: 'sr-drill' }, el('section', { class: 'sr-card-prompt sr-sprint' }, context, prompt, form, flash));
  root.append(stage);

  const show = () => {
    const card = round[i % round.length]!;
    context.textContent = card.context;
    prompt.textContent = card.prompt;
    input.value = '';
    input.disabled = false;
    input.focus();
  };
  let busy = false;
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (over || busy || !input.value.trim()) return;
    const card = round[i % round.length]!;
    const correct = checkAnswer(card.pattern, input.value).verdict !== 'wrong';
    results.push([card, correct]);
    scoreEl.textContent = String(results.filter(([, ok]) => ok).length);
    i += 1;
    if (correct) {
      flash.className = 'sr-sprint-flash is-pass';
      flash.textContent = '✓';
      show();
      return;
    }
    busy = true;
    input.disabled = true;
    flash.className = 'sr-sprint-flash is-fail';
    flash.textContent = card.answer;
    setTimeout(() => {
      busy = false;
      if (!over) show();
    }, 900);
  });
  onKey((ev) => {
    if (ev.key === 'Escape') toMap();
  });

  const tick = setInterval(() => {
    const left = Math.max(0, ends - Date.now());
    clock.textContent = `${Math.ceil(left / 1000)}s`;
    fill.style.width = `${(1 - left / (SPRINT_SECONDS * 1000)) * 100}%`;
    if (left === 0) finish();
  }, 100);
  cleanups.push(() => clearInterval(tick));

  const finish = () => {
    if (over) return;
    over = true;
    clearInterval(tick);
    const score = results.filter(([, ok]) => ok).length;
    recordForms(results.map(([c, ok]) => [c.key, ok]));
    const newBest = recordSprint(score);
    addXp(score * 2);
    const after = conjugationRating(allForms());
    const misses = uniqueMisses(results);
    clear(stage);
    const again = iconButton('Again', ICONS.refresh, () => renderSprint(root, nav), 'sr-btn primary');
    stage.append(
      el(
        'section',
        { class: 'sr-summary' },
        el('p', { class: 'sr-eyebrow' }, 'Conjugation sprint'),
        el('h1', { class: 'sr-title' }, newBest ? 'New best.' : `${score} right.`),
        el(
          'div',
          { class: 'sr-hero-stats' },
          stat(String(score), 'Right'),
          stat(String(results.length - score), 'Missed'),
          stat(`+${score * 2}`, 'XP'),
          stat(pctLabel(after), after.pct !== before.pct || after.level !== before.level ? `Rating (was ${pctLabel(before)})` : 'Rating'),
        ),
        misses.length
          ? el(
              'section',
              { class: 'sr-misses' },
              el('h2', { class: 'sr-section-label' }, 'Missed forms'),
              el(
                'table',
                { class: 'sr-table' },
                el(
                  'tbody',
                  {},
                  ...misses.slice(0, 8).map((c) => el('tr', {}, el('th', {}, `${c.context} · ${c.prompt}`), catalanCell(c.answer))),
                ),
              ),
            )
          : null,
        el('div', { class: 'sr-actions' }, again, button('Map', toMap, 'sr-btn ghost')),
      ),
    );
    again.focus();
  };

  show();
}

function uniqueMisses(results: [SprintCard, boolean][]): SprintCard[] {
  const seen = new Set<string>();
  return results.filter(([c, ok]) => !ok && !seen.has(c.key) && seen.add(c.key)).map(([c]) => c);
}

/* ---------- vocab builder ---------- */

/** Practise one vocab set: all 20 words. */
function startVocabSet(root: HTMLElement, nav: SpeedrunNav, setId: string): void {
  const plan = planVocabSet(allCards(), Date.now(), setId);
  if (plan.length === 0) return renderVocab(root, nav);
  runSession(root, nav, plan.map(({ lessonId, index, item, due }) => ({ lessonId, index, item, due })), { kind: 'vocab', setId });
}

function startVocab(root: HTMLElement, nav: SpeedrunNav): void {
  const plan = planVocab(allCards(), Date.now(), { maxLevel: courseLevel() });
  if (plan.length === 0) return renderVocab(root, nav);
  runSession(root, nav, plan.map(({ lessonId, index, item, due }) => ({ lessonId, index, item, due })), { kind: 'vocab' });
}

function renderVocab(root: HTMLElement, nav: SpeedrunNav): void {
  resetView(root);
  const toMap = () => renderSpeedrun(root, nav);
  topbar(root, nav, { label: 'Vocab builder', back: toMap });
  const now = Date.now();
  const cards = allCards();
  const index = indexCards(cards);
  const main = courseLevel();
  const rating = vocabRating(index, vocab);
  const stats = vocabStats(cards, now, vocab, main);
  const plan = planVocab(cards, now, { maxLevel: main });
  const dueN = plan.filter((e) => index.has(`${e.lessonId}#${e.index}`)).length;
  const freshN = plan.length - dueN;
  const open = new Set(unlockedSets(main).map((s) => s.id));

  const practice = plan.length
    ? iconButton(
        `Practice · ${[dueN ? `${dueN} due` : '', freshN ? `${freshN} new` : ''].filter(Boolean).join(' + ')}`,
        ICONS.play,
        () => startVocab(root, nav),
        'sr-btn primary',
      )
    : null;
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
        el('p', { class: 'sr-eyebrow' }, `Side track · rated ${pctLabel(rating)} · course at ${main}`),
        el('h1', { class: 'sr-title' }, 'Vocab builder'),
        el(
          'p',
          { class: 'sr-lede' },
          `${stats.total} words for the certificate exams’ topics, the ones a Castellano speaker can’t guess: different ` +
            'roots, false friends, gender flips. No verbs: those live in the conjugation sprint. Each level’s sets ' +
            'unlock when the course reaches it, and they review on their own schedule so they never crowd Today.',
        ),
      ),
      el(
        'div',
        { class: 'sr-hero-stats' },
        stat(`${stats.known}`, 'Known'),
        stat(String(stats.due), 'Due'),
        stat(`${stats.unlocked}/${stats.total}`, 'Unlocked'),
      ),
      levelBars(rating, 'A word is fully held once it lasts a month, the same rule as lesson items.'),
      el(
        'div',
        { class: 'sr-intro-foot' },
        practice ?? el('span', { class: 'sr-muted' }, 'Nothing due and every unlocked word started. Finish lessons to unlock more.'),
        el('span', { class: 'sr-keys' }, kbd('Enter'), ' practice', kbd('Esc'), ' map'),
      ),
      el(
        'section',
        { class: 'sr-vocab-sets' },
        ...vocab.sets.map((set) => {
          const locked = !open.has(set.id);
          const credit = set.words.reduce((n, _, i) => n + itemCredit(index.get(`${set.id}#${i}`)), 0) / set.words.length;
          const due = setDue(cards, now, set.id);
          const tile = el(
            locked ? 'div' : 'button',
            { class: `sr-vocab-set${locked ? ' locked' : ''}`, ...(locked ? {} : { type: 'button', title: `Practise ${set.title}` }) },
            el(
              'span',
              { class: 'sr-quest-title' },
              set.title,
              el('span', { class: 'sr-vocab-set-tags' }, due ? el('span', { class: 'sr-due' }, `${due} due`) : null, el('span', { class: 'sr-badge' }, set.level)),
            ),
            locked ? el('span', { class: 'sr-muted' }, `Unlocks at ${set.level}`) : meter(credit),
            el('span', { class: 'sr-vocab-preview', lang: 'ca' }, locked ? '' : set.words.slice(0, 5).map(([ca]) => ca).join(' · ')),
          );
          if (!locked) tile.addEventListener('click', () => startVocabSet(root, nav, set.id));
          return tile;
        }),
      ),
    ),
  );
  practice?.focus();
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
