import { describe, expect, it, vi } from 'vitest';
import { bestHearing } from '../src/speedrun/listen';

describe('voice answers', () => {
  it('credits the answer if any of the recogniser’s guesses is right', () => {
    const best = bestHearing('Tinc por.', ['tinc pa', 'tinc por', 'ting por']);
    expect(best?.text).toBe('tinc por');
    expect(best?.result.verdict).toBe('exact');
  });

  it('forgives a homophone spelling and reports the closest miss otherwise', () => {
    expect(bestHearing('[No he estat mai|Mai (no) he estat] a Londres.', ['no he estat mai a londres'])?.result.verdict).toBe('exact');
    expect(bestHearing('Sóc de Barcelona.', ['soc de barcelona'])?.result.verdict).not.toBe('wrong');
    const miss = bestHearing('Tinc por.', ['tinc pa']);
    expect(miss?.result.verdict).toBe('wrong');
    expect(bestHearing('Tinc por.', [])).toBeNull();
  });
});

describe('listening on real phones', () => {
  type Handlers = { onresult?: (ev: unknown) => void; onend?: () => void; onerror?: (ev: { error: string }) => void; onspeechend?: () => void };
  let last: (Handlers & { stopped: boolean; aborted: boolean }) | null = null;
  const install = (stopEnds: boolean) => {
    last = null;
    (globalThis as { window?: unknown }).window = {
      SpeechRecognition: class {
        stopped = false;
        aborted = false;
        constructor() {
          last = this as never;
        }
        start() {}
        stop() {
          this.stopped = true;
          if (stopEnds) (this as Handlers).onend?.();
        }
        abort() {
          this.aborted = true;
        }
      },
    };
  };
  const result = (transcripts: string[], isFinal: boolean) => {
    const r = Object.assign(transcripts.map((transcript) => ({ transcript })), { isFinal });
    return { resultIndex: 0, results: [r] };
  };

  it('resolves with every guess once the final result arrives', async () => {
    install(true);
    const { listen } = await import('../src/speedrun/listen');
    const heard: string[] = [];
    const l = listen({ onInterim: (t) => heard.push(t) });
    last!.onresult!(result(['tinc p'], false));
    last!.onresult!(result(['tinc por', 'tinc pa'], true));
    expect(await l.result).toEqual(['tinc por', 'tinc pa']);
    expect(heard).toEqual(['tinc p', 'tinc por']);
  });

  it('“done” keeps what was heard even if the phone never ends the recognition', async () => {
    vi.useFakeTimers();
    install(false);
    const { listen, SETTLE_MS } = await import('../src/speedrun/listen');
    const l = listen();
    last!.onresult!(result(['soc de barcelona'], false));
    l.stop();
    expect(last!.stopped).toBe(true);
    vi.advanceTimersByTime(SETTLE_MS);
    expect(await l.result).toEqual(['soc de barcelona']);
    expect(last!.aborted).toBe(true);
    vi.useRealTimers();
  });

  it('stops by itself after the time cap, and cancelling gives nothing', async () => {
    vi.useFakeTimers();
    install(false);
    const { listen, MAX_LISTEN_MS, SETTLE_MS } = await import('../src/speedrun/listen');
    const l = listen();
    vi.advanceTimersByTime(MAX_LISTEN_MS + SETTLE_MS);
    expect(await l.result).toEqual([]);
    const c = listen();
    last!.onresult!(result(['hola'], false));
    c.abort();
    expect(await c.result).toEqual([]);
    vi.useRealTimers();
  });

  it('explains a blocked microphone', async () => {
    install(true);
    const { listen } = await import('../src/speedrun/listen');
    const l = listen();
    last!.onerror!({ error: 'not-allowed' });
    await expect(l.result).rejects.toThrow(/Microphone access is blocked/);
  });
});
