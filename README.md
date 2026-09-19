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

Voice ids need no setup. Units carry `"AUTO"` for each speaker, and the app
fills those in from your account's voices on first use (`src/voices.ts`). Put a
real voice id in a unit file and it wins.

An ElevenLabs voice is a timbre, not a language, so there is no such thing as a
"Catalan voice" to hunt for — what matters is that the **model** speaks Catalan.
That is why `config.elevenlabs.ttsModel` is `eleven_v3`: it covers 70+ languages
including Catalan, while `eleven_multilingual_v2` (29 languages) and the faster
Flash/Turbo v2.5 models (32) do not. Swapping in a faster model would silently
read Catalan with Spanish phonology.

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

| Signal | Source | Catches | Live for Catalan |
| --- | --- | --- | --- |
| Word diff | Scribe transcript vs the turn's `accept` list | Wrong, missing, extra words | yes |
| Word logprob | Scribe, per word | Words it was unsure it heard | yes |
| Language drift | Sampled second Scribe pass with auto-detect | Castilian accent, code-switching | yes |
| Alignment loss | `POST /v1/forced-alignment` vs the expected text | Mispronounced *correct* words | **no — see Known limits** |

Scribe answers *what did you say*. The signal that would answer *how well did
you say it* is unavailable for Catalan, so judging currently runs on the first
three rows. `WordSignal.alignmentLoss` and the threshold logic behind it are
kept intact, so a provider that does support Catalan drops straight in.

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
the two separate.

For Catalan the alignment half will not return anything — the endpoint does not
support it, and the script reports the failure rather than pretending. What the
spike still answers, and what it is worth running for, is whether Scribe hears
your Catalan faithfully including your errors, and whether per-word logprobs
come back at all. Those two are the whole judging signal now.

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

- **No pronunciation scoring at all, for Catalan.** ElevenLabs forced alignment
  covers the same 29 languages as multilingual v2, and Catalan is not among
  them, so the call is not made. Judging runs on word diff, logprob and drift:
  wrong words still always fail, but *right word said badly* will pass. The app
  does not announce this — it is a deliberate choice for a personal demo, not an
  oversight. If this ever becomes more than that, put the disclaimer back.
- **STT auto-correction.** Scribe may output the correct word for one you
  mispronounced. Without alignment there is now no second signal to catch it,
  which makes this limitation bite harder than the brief assumed.
- **If you want the pronunciation signal back**, Azure Speech pronunciation
  assessment supports `ca-ES` and returns phoneme-level accuracy — better than
  the alignment-loss proxy this was designed around. Two caveats worth knowing
  before committing: **prosody** assessment (intonation, stress, rhythm) is
  `en-US` only, and so are **spoken phonemes in IPA** and syllable groups. So
  for Catalan you would learn that a word's phonemes scored badly, but not get
  them named in IPA. Wire it into `WordSignal.alignmentLoss` and the existing
  threshold logic takes it from there.
- Desktop Chrome only. No mobile layout, no accounts, no spaced repetition, and
  no progress history beyond the calibration data.
