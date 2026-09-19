import { describe, expect, it } from 'vitest';
import { applyHardFloor } from '../src/judge';
import { thresholdJudge } from '../src/judge/threshold';
import { config } from '../src/config';
import type { WordSignal } from '../src/judge/types';

const signal = (over: Partial<WordSignal> = {}): WordSignal => ({
  status: 'match',
  expected: 'tomàquets',
  heard: 'tomàquets',
  isFocus: false,
  level: 'A1',
  alignmentLoss: 0.1,
  logprob: -0.2,
  ...over,
});

const judgeOne = async (s: WordSignal) => (await thresholdJudge.judge([s]))[0]!;

describe('thresholdJudge', () => {
  it('passes a clean word', async () => {
    expect((await judgeOne(signal())).verdict).toBe('pass');
  });

  it('fails the right word pronounced badly — the case Scribe alone misses', async () => {
    const v = await judgeOne(signal({ alignmentLoss: config.judge.alignmentLossFail + 0.1 }));
    expect(v.verdict).toBe('fail_pronunciation');
  });

  it('is readier to fail a focus word than an incidental one', async () => {
    const loss = config.judge.alignmentLossFail + 0.1;
    const focus = await judgeOne(signal({ alignmentLoss: loss, isFocus: true }));
    const plain = await judgeOne(signal({ alignmentLoss: loss }));
    expect(focus.confidence).toBeGreaterThan(plain.confidence);
  });

  it('calls a middling word unclear rather than guessing', async () => {
    const v = await judgeOne(signal({ alignmentLoss: config.judge.alignmentLossUnclear + 0.05 }));
    expect(v.verdict).toBe('unclear');
  });

  it('flags a word it could barely hear', async () => {
    const v = await judgeOne(
      signal({ alignmentLoss: 0.1, logprob: config.judge.logprobUnclear - 0.5 }),
    );
    expect(v.verdict).toBe('unclear');
  });

  it('says so when it has no pronunciation signal at all', async () => {
    const bare: WordSignal = {
      status: 'match',
      expected: 'pa',
      heard: 'pa',
      isFocus: false,
      level: 'A1',
    };
    const v = await judgeOne(bare);
    expect(v.verdict).toBe('unclear');
    expect(v.confidence).toBeLessThan(config.judge.confidenceCutoff);
  });

  it('fails a turn that drifted out of Catalan', async () => {
    const v = await judgeOne(signal({ languageDrift: true }));
    expect(v.verdict).toBe('fail_pronunciation');
  });
});

describe('applyHardFloor', () => {
  it('fails a wrong word even when the judge passed it with full confidence', () => {
    const wrong = signal({ status: 'substitution', expected: 'setenta', heard: 'setanta' });
    const v = applyHardFloor(wrong, { verdict: 'pass', confidence: 1, reason: 'close enough' });
    expect(v.verdict).toBe('fail_word');
    expect(v.reason).toContain('setenta');
  });

  it('fails a missing word whatever the judge said', () => {
    const missing = signal({ status: 'missing', heard: undefined });
    expect(applyHardFloor(missing, { verdict: 'pass', confidence: 1, reason: '' }).verdict).toBe(
      'fail_word',
    );
  });

  it('fails an extra word whatever the judge said', () => {
    const extra = signal({ status: 'extra', expected: undefined, heard: 'senyor' });
    expect(applyHardFloor(extra, { verdict: 'pass', confidence: 1, reason: '' }).verdict).toBe(
      'fail_word',
    );
  });

  it('refuses a vocabulary verdict on a word that was right', () => {
    // Judges decide pronunciation; they never get to invent a wrong word.
    const v = applyHardFloor(signal(), {
      verdict: 'fail_word',
      confidence: 0.99,
      reason: 'wrong word',
    });
    expect(v.verdict).toBe('unclear');
  });

  it('downgrades a low-confidence verdict to unclear rather than guessing', () => {
    const v = applyHardFloor(signal(), {
      verdict: 'fail_pronunciation',
      confidence: config.judge.confidenceCutoff - 0.2,
      reason: 'maybe off',
    });
    expect(v.verdict).toBe('unclear');
  });

  it('lets a confident pronunciation verdict stand', () => {
    const v = applyHardFloor(signal(), {
      verdict: 'fail_pronunciation',
      confidence: 0.9,
      reason: 'off',
    });
    expect(v.verdict).toBe('fail_pronunciation');
  });
});
