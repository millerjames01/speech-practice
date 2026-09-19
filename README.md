# Conversation Trainer — Catalan

A local, single-user web app for practising spoken Catalan. Each unit moves from
listening, to scripted speaking, to open conversation.

Its defining trait is **strictness**: it never charitably guesses what you meant.
Wrong words always fail, in code. Shaky pronunciation is flagged separately, and
when the app is not sure, it says *unclear* rather than guessing in your favour.

Everything runs in the browser. No backend, no database, no accounts.

## Setup

```bash
npm install
npm run dev          # http://localhost:5173
```

Open Settings and paste your keys:

| Key | Used for |
| --- | --- |
| ElevenLabs | Text-to-speech, Scribe transcription, forced alignment |
| Text LLM | Free-form counterpart replies and the correction report |

Pick **OpenRouter** (BYOK) or **Anthropic** (direct) as the LLM provider.

Keys are held in a module-level variable for the life of the page. They are
never written to `.env`, `localStorage`, logs or the audio cache. The "remember
for this tab" checkbox — off by default — copies them to `sessionStorage`, which
dies with the tab.

If a call is blocked by CORS, tick **route calls through the dev proxy** in
Settings. That uses the Vite dev-server proxy in `vite.config.ts`; it is still
not a real backend.

Before practising, replace the `REPLACE_WITH_VOICE_ID` placeholders in
`curriculum.json` and in each file under `units/` with ElevenLabs voice ids.

## The three phases

1. **Guided conversation.** The counterpart's line plays; you see an English cue
   (the target Catalan is behind a toggle, off by default) and record. A turn
   passes only when it matches. After three failures the answer is shown, and
   one clean repeat is still required.
2. **Monologue.** You deliver a longer script in one take, judged per sentence.
   Failed sentences are replayed and redone individually, then the full take
   again. Three passes of fading support: full text, every other sentence
   hidden, then English cues only.
3. **Free form.** Open conversation with the LLM counterpart, in Catalan, on
   theme. Nothing is corrected during the conversation. At the end you get one
   report, grouped by grammar, vocabulary, Castilianisms and pronunciation, with
   playback of the correct version and a slice of your own audio.

## The correction engine

`src/judge/` combines four independent signals, so no single model gets to decide
what you meant:

| Signal | Source | Catches |
| --- | --- | --- |
| Word diff | Scribe transcript vs the turn's `accept` list | Wrong, missing, extra words |
| Alignment loss | `POST /v1/forced-alignment` vs the expected text | Mispronounced *correct* words |
| Word logprob | Scribe, per word | Words it was unsure it heard |
| Language drift | Sampled second Scribe pass with auto-detect | Castilian accent, code-switching |

Scribe answers *what did you say*; forced alignment answers *how well did your
audio match what you should have said*. Both calls run in parallel per attempt.

**The hard floor lives in code.** `applyHardFloor` in `src/judge/index.ts` fails
any wrong, missing or extra word whatever the judge said, and refuses a
vocabulary verdict on a word that was right. Judges decide pronunciation; they
never forgive vocabulary. Verdicts below the confidence cutoff are shown as
unclear rather than guessed.

### Judges

The shipping judge is the deterministic threshold rule
(`src/judge/threshold.ts`), behind a `WordJudge` interface. `src/judge/jev.ts`
is a stub for the per-word classifier the design calls for; it is **not
registered**, because its endpoint and response shape could not be verified.
Wiring it in means implementing one interface and calling `setJudge` — and
running both side by side is how you answer whether a classifier actually beats
the threshold rule on borderline words.

Every attempt's per-word loss and logprob goes to IndexedDB
(`src/calibration.ts`). Over a few sessions this shows which words you
consistently miss, and gives you real numbers to tune the thresholds in
`src/config.ts` against your own voice and mic.

## The spike

Run this before trusting any pronunciation feedback. It answers whether Scribe
transcribes your Catalan faithfully *including your errors*, whether alignment
loss separates correct words from mispronounced ones, whether per-word logprobs
come back at all, and whether the endpoints are reachable.

```bash
ELEVENLABS_API_KEY=... npm run spike -- ./recordings
```

`./recordings` needs your audio files and an `expected.json`:

```json
[
  { "file": "01.webm",
    "text": "Un quilo de tomàquets, si us plau",
    "deliberateErrors": ["tomàquets"] }
]
```

Record ten sentences including deliberate mistakes and Castilian-sounding
vowels. `deliberateErrors` is what makes the result readable: the script
compares alignment loss on those words against the rest and tells you whether
the two separate. If they do not, pronunciation feedback should degrade to
confidence flags only — and the UI should say so rather than implying a
precision it does not have.

## Units and generation

One JSON file per unit in `units/`, loaded at startup. No audio is committed:
it is generated lazily from the text and cached in IndexedDB, keyed by
`hash(voice + model + text)`, so each scripted line is paid for once and
survives reloads.

`curriculum.json` fixes what each unit teaches — its type, situation, grammar
targets and new vocabulary. Generation only writes the dialogues, monologue and
free-form brief:

```bash
OPENROUTER_API_KEY=... npm run generate -- a1-05
ANTHROPIC_API_KEY=...  npm run generate -- a1-05 --provider anthropic
```

The script sends the unit spec plus every word taught in earlier units, so new
units build on old ones and never introduce vocabulary out of order. Output is
validated against the schema in `scripts/schema.ts`, and invalid output is
**retried, not patched** — a silently repaired unit is how wrong Catalan gets in.

### Review gate

Generated units are written with `reviewed: false`, and the app shows a warning
until you change it. This is not a formality: wrong Catalan in an `accept` list
would actively train errors. **The three A1 units in this repo are hand-written
and also marked `reviewed: false`** — they have not been checked by a Catalan
speaker. Read them before practising them.

Target variety is Central Catalan with a Girona-leaning lexical preference; the
generation prompt forbids Castilianisms explicitly.

## Tests

```bash
npm test     # vitest
npm run build
```

The tests cover the pure logic, which is where the strictness lives: accents are
never stripped (`setanta` fails against `setenta`), the closest `accept` variant
is chosen without forgiving wrong words, the hard floor overrides any judge, and
the unit schema rejects malformed content.

## Known limits

- **STT auto-correction.** Scribe may output the correct word for one you
  mispronounced. Run the spike to find out how much this happens to you; the
  word diff cannot catch what Scribe silently fixes.
- **No true pronunciation scoring.** Alignment loss is a word-level proxy, not
  phoneme grading. It will not reliably separate subtle vowel errors. The UI
  labels these words *unclear*, not *wrong*, for that reason.
- Desktop Chrome only. No mobile layout, no accounts, no spaced repetition, and
  no progress history beyond the calibration data.
