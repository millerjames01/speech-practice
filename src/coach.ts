/**
 * The coach: judging an open turn.
 *
 * The scripted phases enumerate correct answers and match them, with the hard
 * floor in code. None of that is available here - "say how home differs from
 * here" has no finite set of right answers - so the turn is judged against what
 * it was meant to achieve, by a model.
 *
 * Two things this does that error-checking alone does not:
 *
 *   - Castilianisms are named as such, separately from grammar. Saying "tenir
 *     que" is not a slip of grammar, it is Spanish wearing Catalan words, and
 *     the learner needs to see it as its own category.
 *   - Upgrades fire even when the turn was CORRECT. Expanding vocabulary means
 *     being told what a native would have said instead, not only what was
 *     wrong. The prompt has to insist on this or the model only reports faults.
 */

import { chat, parseJsonReply } from './api/llm';
import { castilianismPromptLines, findCastilianisms } from './castilianisms';
import type { ConversationTask, Unit } from './types';

export interface Correction {
  /** The learner's words, as transcribed. */
  said: string;
  better: string;
  why: string;
}

export interface TurnCoaching {
  /** Did the turn do what the task asked. */
  met: boolean;
  /** Requirements the turn did not satisfy, in the task's own words. */
  missing: string[];
  castilianisms: Correction[];
  /** Richer phrasing, offered whether or not the turn was correct. */
  upgrades: Correction[];
  errors: Correction[];
  /** Which of the task's targetVocab the learner actually reached for. */
  usedTarget: string[];
  /** The counterpart's next line, in Catalan, in character. */
  reply: string;
}

const EMPTY: TurnCoaching = {
  met: false,
  missing: [],
  castilianisms: [],
  upgrades: [],
  errors: [],
  usedTarget: [],
  reply: '',
};

function systemPrompt(unit: Unit, task: ConversationTask): string {
  return [
    `You are two things at once: the counterpart in a spoken role-play with a learner of`,
    `Catalan at ${unit.level} level, and a strict Catalan teacher watching them.`,
    '',
    `Scenario: ${unit.conversation?.scenario ?? unit.freeform.scenario}`,
    '',
    'AS THE COUNTERPART:',
    '- Reply in Central Catalan (Barcelona/Girona). Never Spanish, never English.',
    '- One or two short spoken sentences. The spoken line only: no quotation marks,',
    '  stage directions or translations.',
    '- Stay in character and on the scenario. Keep the conversation moving.',
    '- Never use a Castilianism yourself, however common in speech.',
    '- Do NOT correct the learner in your reply. The correction is separate.',
    '',
    'AS THE TEACHER:',
    `- The learner's task this turn: ${task.goal}`,
    `- It requires: ${task.requires.join('; ')}`,
    '- Decide "met": did the turn actually do that? List anything missing.',
    '- Do not interpret charitably. Meaning being clear is not the same as being correct.',
    '',
    'CASTILIANISMS are their own category, not grammar. Flag any Spanish-influenced',
    'form: a borrowed word, a calqued construction, a Spanish idiom translated whole.',
    'Common ones, not an exhaustive list — catch others too:',
    castilianismPromptLines(),
    '',
    'UPGRADES are the point of this exercise, so give them even when the learner was',
    'entirely correct. If a native speaker here would more naturally have said',
    'something else — a better verb, a set phrase, a more idiomatic turn — say so.',
    'Never leave "upgrades" empty unless the turn was already native-sounding.',
    'An upgrade is a nudge, not an error: do not put errors in it.',
    '',
    `TARGET VOCABULARY for this task: ${task.targetVocab.join(', ') || '(none)'}`,
    '- List in "usedTarget" only those the learner actually said.',
    '',
    'Reply with JSON only, in this shape:',
    '{"met": true, "missing": [], "castilianisms": [{"said": "...", "better": "...",',
    ' "why": "..."}], "upgrades": [...], "errors": [...], "usedTarget": ["..."],',
    ' "reply": "the counterpart\'s next line in Catalan"}',
  ].join('\n');
}

export interface CoachContext {
  unit: Unit;
  task: ConversationTask;
  /** Prior turns, oldest first, so the counterpart can stay coherent. */
  history: { role: 'counterpart' | 'learner'; text: string }[];
  transcript: string;
}

/**
 * Judges one turn and produces the counterpart's reply in the same call, so a
 * turn costs one round trip rather than two.
 */
export async function coachTurn(ctx: CoachContext): Promise<TurnCoaching> {
  const messages = ctx.history.map((entry) => ({
    role: entry.role === 'learner' ? ('user' as const) : ('assistant' as const),
    content: entry.text,
  }));
  messages.push({ role: 'user', content: ctx.transcript });
  if (messages[0]?.role !== 'user') {
    messages.unshift({ role: 'user', content: '[The learner has just arrived.]' });
  }

  const raw = await chat({
    system: systemPrompt(ctx.unit, ctx.task),
    messages,
    maxTokens: 1500,
    json: true,
  });

  const parsed = parseJsonReply<Partial<TurnCoaching>>(raw);

  const corrections = (value: unknown): Correction[] =>
    Array.isArray(value)
      ? value.filter(
          (c): c is Correction =>
            typeof c === 'object' &&
            c !== null &&
            typeof (c as Correction).said === 'string' &&
            typeof (c as Correction).better === 'string',
        )
      : [];

  const coaching: TurnCoaching = {
    ...EMPTY,
    met: parsed.met === true,
    missing: Array.isArray(parsed.missing)
      ? parsed.missing.filter((m): m is string => typeof m === 'string')
      : [],
    castilianisms: corrections(parsed.castilianisms),
    upgrades: corrections(parsed.upgrades),
    errors: corrections(parsed.errors),
    usedTarget: Array.isArray(parsed.usedTarget)
      ? parsed.usedTarget.filter((t): t is string => typeof t === 'string')
      : [],
    reply: typeof parsed.reply === 'string' ? parsed.reply : '',
  };

  return withDeterministicHits(coaching, ctx.transcript);
}

/**
 * Folds in the table's own matches.
 *
 * The model can miss one, or be argued out of it by context. These forms are
 * literal strings, so their presence is not a matter of judgement - if the
 * table found one and the model did not mention it, the table wins.
 */
export function withDeterministicHits(
  coaching: TurnCoaching,
  transcript: string,
): TurnCoaching {
  const already = new Set(coaching.castilianisms.map((c) => c.said.toLowerCase().trim()));

  const extra: Correction[] = findCastilianisms(transcript)
    .filter((hit) => !already.has(hit.matched.toLowerCase().trim()))
    .map((hit) => ({ said: hit.matched, better: hit.right, why: hit.why }));

  if (extra.length === 0) return coaching;
  return { ...coaching, castilianisms: [...coaching.castilianisms, ...extra] };
}
