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

describe('colouring what was heard', () => {
  it('marks matches green, near misses yellow and the rest grey', async () => {
    const { markHeard } = await import('../src/speedrun/listen');
    expect(markHeard('Sóc de Barcelona.', 'soc de girona').map((w) => w.mark)).toEqual(['ok', 'ok', 'miss']);
    // An accent can't be heard: respelled and green. One sound off: yellow.
    expect(markHeard('Està cansat.', 'esta cansat')).toEqual([{ word: 'està', mark: 'ok' }, { word: 'cansat', mark: 'ok' }]);
    expect(markHeard('El nen menja.', 'el nen menjo').map((w) => w.mark)).toEqual(['ok', 'ok', 'spelling']);
    expect(markHeard('El nen menja.', 'el nen dorm').map((w) => w.mark)).toEqual(['ok', 'ok', 'miss']);
    expect(markHeard('[No he estat mai|Mai (no) he estat] a Londres.', 'mai he estat a londres').every((w) => w.mark === 'ok')).toBe(true);
  });
});

describe('sound-alikes the recogniser cannot tell apart', () => {
  it('accepts what you said when the recogniser picked another spelling of the same sound', async () => {
    const { bestHearing, markHeard } = await import('../src/speedrun/listen');
    const cases: [string, string][] = [
      ['Saps nedar?', 'saps nadar'],
      ['Què beus?', 'què veus'],
      ['El compte, si us plau.', 'el comte si us plau'],
      ['(Ells) volen menjar.', 'els volen menjar'],
      ['Aquestes sabates són cares.', 'aquestes sabates son caras'],
    ];
    for (const [pattern, heard] of cases) {
      expect(bestHearing(pattern, [heard])?.result.verdict, heard).not.toBe('wrong');
    }
    expect(markHeard('Saps nedar?', 'saps nadar')).toEqual([{ word: 'saps', mark: 'ok' }, { word: 'nedar', mark: 'ok' }]);
  });

  it('still rejects a different word', async () => {
    const { bestHearing, markHeard } = await import('../src/speedrun/listen');
    expect(bestHearing('Aquestes sabates són cares.', ['aquestes zapatas son caras'])?.result.verdict).toBe('wrong');
    // Close (one sound off) shows yellow, but it is still not the word.
    expect(markHeard('Aquestes sabates són cares.', 'aquestes zapatas són cares').map((w) => w.mark)).toEqual(['ok', 'spelling', 'ok', 'ok']);
    expect(bestHearing('Tinc por.', ['tinc pa'])?.result.verdict).toBe('wrong');
    expect(bestHearing('Ellos quieren comer.', ['eis volen menjar'])?.result.verdict).toBe('wrong');
  });
});

describe('numbers and Spanish spellings from the recogniser', () => {
  it('spells Catalan numbers in every form', async () => {
    const { catalanNumber, numberToken } = await import('../src/speedrun/numbers');
    expect(catalanNumber(1)).toEqual(['un', 'una', 'u']);
    expect(catalanNumber(2)).toEqual(['dos', 'dues']);
    expect(catalanNumber(11)).toEqual(['onze']);
    expect(catalanNumber(21)).toEqual(['vint-i-un', 'vint-i-una', 'vint-i-u']);
    expect(catalanNumber(35)).toEqual(['trenta-cinc']);
    expect(catalanNumber(200)).toEqual(['dos-cents', 'dues-centes']);
    expect(catalanNumber(1714)).toEqual(['mil set-cents catorze', 'mil set-centes catorze']);
    expect(catalanNumber(2024)[0]).toBe('dos mil vint-i-quatre');
    expect(numberToken('11:00')).toEqual(['onze']);
    expect(numberToken('11:30')).toBeNull();
    expect(numberToken('casa')).toBeNull();
  });

  it('accepts digits and whole-hour times for spelled-out numbers', async () => {
    const { bestHearing, markHeard } = await import('../src/speedrun/listen');
    const pattern = '[Anem a dormir|Ens n\'anem a dormir|Ens fiquem al llit] a les onze.';
    expect(bestHearing(pattern, ['anem a dormir a les 11'])?.result.verdict).toBe('exact');
    expect(bestHearing(pattern, ['anem a dormir a les 11:00'])?.result.verdict).toBe('exact');
    expect(bestHearing('A les dues.', ['a les 2'])?.result.verdict).toBe('exact');
    expect(markHeard(pattern, 'anem a dormir a les 11').at(-1)).toEqual({ word: 'onze', mark: 'ok' });
    expect(bestHearing(pattern, ['anem a dormir a les 12'])?.result.verdict).toBe('wrong');
  });

  it('reads Spanish ñ as Catalan ny', async () => {
    const { bestHearing, markHeard } = await import('../src/speedrun/listen');
    expect(bestHearing('[la cunyada|cunyada]', ['la cuñada'])?.result.verdict).toBe('exact');
    expect(markHeard('[la cunyada|cunyada]', 'la cuñada')).toEqual([{ word: 'la', mark: 'ok' }, { word: 'cunyada', mark: 'ok' }]);
  });
});

describe('where a spoken attempt stands', () => {
  const pattern = '[Anem a dormir|Ens n\'anem a dormir|Ens fiquem al llit] a les onze.';
  it('is on track while every word so far is right and more is to come', async () => {
    const { voiceProgress } = await import('../src/speedrun/listen');
    expect(voiceProgress(pattern, 'anem a dormir').onTrack).toBe(true);
    expect(voiceProgress(pattern, 'anem a dormir a les 11').result.verdict).toBe('exact');
    expect(voiceProgress(pattern, 'anem a beure').onTrack).toBe(false);
    expect(voiceProgress(pattern, 'anem a dormir a les dotze').onTrack).toBe(false);
    expect(voiceProgress(pattern, '').onTrack).toBe(false);
    expect(voiceProgress('(Ella) és metgessa.', 'ella és').onTrack).toBe(true);
    expect(voiceProgress('(Ella) és metgessa.', 'és').onTrack).toBe(true);
  });

  it('continues what was already heard with the best guess', async () => {
    const { bestProgress } = await import('../src/speedrun/listen');
    expect(bestProgress(pattern, 'anem a dormir', ['a les 12', 'a les onze'])?.result.verdict).toBe('exact');
    expect(bestProgress(pattern, '', ['anem a', 'hem a'])?.onTrack).toBe(true);
    expect(bestProgress(pattern, '', [])).toBeNull();
  });
});

describe('starting the sentence again', () => {
  it('reads a fresh start when it beats the continuation', async () => {
    const { bestProgress, voiceState } = await import('../src/speedrun/listen');
    const p = bestProgress('Som estudiants.', 'som professors', ['som estudiants']);
    expect(p?.result.verdict).toBe('exact');
    expect(voiceState(bestProgress('Som estudiants.', 'som professors', ['som'])!)).toBe('onTrack');
    expect(voiceState(bestProgress('Som estudiants.', '', ['som professors'])!)).toBe('off');
    expect(voiceState(bestProgress('Saps nedar?', 'saps', ['nadar'])!)).toBe('right');
    // "ells" opening the answer is the pronoun, not the article it sounds like.
    expect(voiceState(bestProgress('(Ells) són els meus amics.', '', ['ells són els meus amics'])!)).toBe('right');
    expect(voiceState(bestProgress('(Ells) són els meus amics.', '', ['els són els meus amics'])!)).toBe('right');
  });
});

describe('continuous listening', () => {
  type R = { transcript: string };
  type Res = R[] & { isFinal: boolean };
  const res = (isFinal: boolean, ...alts: string[]): Res => Object.assign(alts.map((transcript) => ({ transcript })), { isFinal });
  class FakeRec {
    static all: FakeRec[] = [];
    results: Res[] = [];
    started = 0;
    aborted = false;
    onresult?: (ev: unknown) => void;
    onend?: () => void;
    onerror?: (ev: { error: string }) => void;
    constructor() {
      FakeRec.all.push(this);
    }
    start() {
      this.started += 1;
    }
    stop() {}
    abort() {
      this.aborted = true;
    }
    push(r: Res) {
      this.results.push(r);
      this.onresult?.({ resultIndex: this.results.length - 1, results: this.results });
    }
    update(r: Res) {
      this.results[this.results.length - 1] = r;
      this.onresult?.({ resultIndex: this.results.length - 1, results: this.results });
    }
  }
  const setup = async () => {
    FakeRec.all = [];
    (globalThis as { window?: unknown }).window = { SpeechRecognition: FakeRec };
    const { VoiceStream } = await import('../src/speedrun/listen');
    const heard: string[][] = [];
    const errors: string[] = [];
    const stream = new VoiceStream({ onText: (c) => heard.push(c), onError: (e) => errors.push(e.message) });
    return { stream, heard, errors, last: () => FakeRec.all.at(-1)! };
  };

  it('stays one recognition across pauses and items; reset starts a new attempt', async () => {
    const { stream, heard, last } = await setup();
    stream.start();
    const rec = last();
    rec.push(res(false, 'soc'));
    rec.update(res(true, 'soc de barcelona', 'sol de barcelona'));
    expect(heard.at(-1)).toEqual(['soc de barcelona', 'sol de barcelona']);
    stream.reset(); // next item: nothing restarts
    rec.push(res(false, "d'on"));
    expect(heard.at(-1)).toEqual(["d'on"]);
    rec.update(res(true, "d'on ets"));
    rec.push(res(false, 'i tu'));
    expect(heard.at(-1)).toEqual(["d'on ets i tu", 'i tu']);
    expect(FakeRec.all).toHaveLength(1);
    expect(rec.started).toBe(1);
  });

  it('does not double Android’s repeated finals', async () => {
    const { mergeHeard } = await import('../src/speedrun/listen');
    expect(mergeHeard('som', 'som estudiants')).toBe('som estudiants');
    expect(mergeHeard('som estudiants', 'som estudiants')).toBe('som estudiants');
    expect(mergeHeard('som', 'estudiants')).toBe('som estudiants');
    const { stream, heard, last } = await setup();
    stream.start();
    const rec = last();
    rec.push(res(true, 'tinc'));
    rec.push(res(true, 'tinc por'));
    expect(heard.at(-1)).toEqual(['tinc por']);
  });

  it('reopens when the browser closes it, keeping the words; gives up if it keeps closing', async () => {
    const { stream, heard, errors, last } = await setup();
    stream.start();
    last().push(res(true, 'ella és'));
    last().onend!();
    expect(FakeRec.all).toHaveLength(2);
    last().push(res(false, 'metgessa'));
    expect(heard.at(-1)).toEqual(['ella és metgessa', 'metgessa']);
    for (let i = 0; i < 8; i += 1) last().onend?.();
    expect(errors.at(-1)).toMatch(/keeps stopping/);
    expect(stream.active).toBe(false);
  });

  it('stops for good on a blocked mic', async () => {
    const { stream, errors, last } = await setup();
    stream.start();
    last().onerror!({ error: 'not-allowed' });
    expect(stream.active).toBe(false);
    expect(errors[0]).toMatch(/blocked/);
  });
});
