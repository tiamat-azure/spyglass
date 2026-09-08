# Lot 3 evidence and PR notes

Do **not** open the pull request from this lot unless a human asks. This file
is the hand-off for a later PR. Parent runs adversarial review, then opens the
PR.

Branch: `cursor/lot-3-voice-7300`  
Base: `41d081dd1ebd4ecc30350d838c21b9ebd09f961e` (Lot 2 merged `main`)

## Suggested PR title

```
feat(lot-3): local voice capture, whisper.cpp sidecar, DOM correlation
```

## Suggested PR body (paste)

Lot 3 (Voix) only. Lots 0–2 (Electron security, capture, observer
gabarits/enrichment) are unchanged.

The chrome renderer captures the microphone (**hold-to-talk** or **continuous
energy VAD**) as PCM 16 kHz mono and sends frames over IPC
`spyglass:voice:frame`. **Hold** begins/ends one utterance from pointer
down/up. **Continuous** (`#voice-mode` → VAD) arms capture; `@spyglass/stt`
`createVadState` / `pushVad` / `gateVadUtterance` in main `VoiceBridge` start
an STT utterance on speech energy and end it after hangover silence. The
**main** process is the only WebSocket client: it owns a localhost sidecar
(`@spyglass/stt`) that never leaves `127.0.0.1` (ADR-0005). The renderer does
not open STT sockets.

Streaming STT paints **partials** in a live strip, then consolidates a
**final** segment in the chat. Each `voice.final` line in `raw.jsonl` carries
timestamps plus `voice.relation` `before` | `after` | `unanchored` and, when
known, `correlatedEventId` / `correlatedStepIndex` (F-32, **C2b**). Append-only:
an utterance that **starts before** the next stable capture is `before` (including
overlap with a click). Commentary that **starts after** a capture within the
margin is `after`. A distant previous capture becomes before-next.

Local engine (ADR-0004 / ADR-0013): **whisper.cpp** `small` q5_1, invoked as a
child process with **no network**. CI and this environment use the **mock**
engine (`SPYGLASS_STT_ENGINE=mock`, `SPYGLASS_STT_IN_PROCESS=1`) because
binaries/models are too heavy to vendor. The real path is `createWhisperEngine`
+ `scripts/fetch-whisper.mjs` → `vendor/whisper/` (gitignored `.bin` /
`whisper-cli`). Auto-selects whisper when both files exist. Packaged/dev still
spawns `stt-sidecar.js` and talks to it over `ws://127.0.0.1` from **main**.

`AUDIO_RETENTION=none` by default (F-49): `voice.audioRef` is `null` and no
`audio/` directory is created. `corrected` / `all` can persist WAV next to the
session.

Offline dictation does not depend on the LLM: `SPYGLASS_LLM_OFFLINE=1` still
transcribes and journals voice events.

**No Lot 4+** (no refinement, runner, or generated script).

### Exit criteria (PRD §11 Lot 3)

- [x] Dictate **before** and **after** an action
- [x] Association present in the raw artifact (`raw.jsonl` / voice events)
- [x] Works with **network cut** (local STT)

### How the three exit demos were proven

`pnpm lint`, `pnpm typecheck`, `pnpm test` (221 passed, 1 skipped),
`pnpm test:schemas`, and `xvfb-run pnpm test:e2e` (**12 passed**, Lots 0–3) on
this branch. CI uses mock STT + fake PCM (`SPYGLASS_VOICE_FAKE=1`) in-process so
the suite does not ship whisper weights. whisper.cpp is covered by a **local
stub binary** unit test that writes a `.txt` transcript with no HTTP.

1. **Dictate before and after an action.** Playwright
   `packages/app/e2e/lot3-voice.spec.ts` records, hold-to-talk (fake PCM → mock
   STT “Je vais cliquer sur Démarrer”), clicks `#step-1`, hold-to-talk again
   (“J'ai validé l'étape”). Chat rows are `data-kind=voice.final` with
   `data-relation=before` then `after`. Unit test
   `lot 3 voice journal > correlates dictation before and after a committed click`
   does the same against `SessionOrchestrator` without Electron.
2. **Association in `raw.jsonl`.** After Stop, the session journal contains two
   `voice.final` lines with `"relation":"before"` (predicted `correlatedStepIndex`)
   and `"relation":"after"` (`correlatedEventId` of the click), plus
   `"audioRef":null`. No `audio/` directory.
3. **Network cut.** Same e2e with `SPYGLASS_LLM_OFFLINE=1` /
   `SPYGLASS_LLM_TRANSPORT=offline`: two finals, zero `data-mode=llm` rows,
   meter stays offline, `raw.jsonl` still has voice events and no `"mode": "llm"`.
   Mock/whisper engines never call `fetch`.

**V1a (captain):** continuous energy VAD is wired, not a label. Unit tests
`gates continuous utterances` and `continuous energy VAD starts and ends
utterances from RMS`; e2e `continuous energy VAD starts and ends utterances`
listens in VAD mode and gets two `voice.final` rows from speech/silence
energy cycles without hold-to-talk.

**C2b (captain):** `correlateVoiceSegment` prefers `before` when `startTs` is
before the last stable capture (overlap is not `after`). `recordVoiceFinal`
still flushes a pending click first so that capture is visible, then applies
C2b. Unit tests cover overlap → before and start-after → after; e2e
`C2b: utterance that starts before a click is before, not after` holds the
mic, clicks `#step-1`, then releases. Sequential hold → click → hold still
yields before then after.

### Residuals / not in this lot

- Real `ggml-small-q5_1.bin` (~190 MB) is **not** in git or CI. Run
  `node scripts/fetch-whisper.mjs` on a packaged/dev machine and set
  `SPYGLASS_STT_ENGINE=whisper` (or rely on auto-detect).
- F-36 reserved voice commands and F-38/F-39 model upgrade are Lot 3+ later
  (P2). Segment **edit** (F-33 P1) is wired (`spyglass:voice:edit` →
  `voice.edited`).
- Live French quality of whisper `small` was not baked off here (no GPU, no
  weights). ADR-0017 remains the upgrade path.

### Adversarial notes

- Guest `WebContentsView` still cannot obtain `media`. Chrome renderer may
  obtain **microphone/audio only** (`mediaTypes: ['audio']`); camera or mixed
  audio+video requests are denied. Blanket `permission === 'media'` without
  audio-only types is denied.
- `AUDIO_RETENTION=none` does not keep PCM in `voicePcm` for the session.
- Real-mic `getUserMedia` failure does not fall back to fake PCM; the live
  strip shows the error and capture stops.
- Sidecar binds `127.0.0.1`. Upgrade requests with a non-local Host header are
  dropped.
- `raw.jsonl` stays append-only. Correlation never rewrites a previous voice
  line.
- Renderer/preload contain neither `new WebSocket` nor `ws://`.

### Adversarial pass 2 (auto-fixes)

Applied on tip `906c075`. V1a energy VAD and C2b `before`-on-overlap are unchanged.

1. **high — empty hold / mic-fail.** Hold does not `beginUtterance` until the first PCM frame. `stopCapture` with 0 bytes **aborts** (drop), not `end`. Mock assigns a phrase only on `pushPcm`; `finalize` of a 0-byte utterance is `''` and is not journaled. Renderer `getUserMedia` failure calls `spyglass:voice:abort` (not stop). `recordVoiceFinal` ignores blank text.
2. **medium — capturing flag.** `startCapture` sets `capturing`; `stopCapture` / `abort` clear it. `sendFrame` returns immediately when disarmed, so post-stop VAD cannot open a new utterance.
3. **medium — Chat Edit.** Observer chat payload carries `transcript` = raw `voice.text`. Edit prompt seeds that string, not the gabarit wrapper. `recordVoiceEdited` persists `asEditedVoiceTranscript` only (unwraps a pasted gabarit).
4. **medium — real-mic PCM.** Renderer resamples ScriptProcessor floats to 16 kHz mono (`resampleToSttPcm` / `STT_SAMPLE_RATE`) before IPC; AudioContext rate is not assumed.
5. **medium — overlapping utterances.** VoiceBridge snapshots PCM in `pcmByUtterance` per id until that id’s `final`. Sidecar keeps a session map; a new `start` does not abort a prior utterance still awaiting `end`/`final`.
6. **low — ws Host allowlist.** `isLoopbackWsHost` is exact `127.0.0.1` / `localhost` or those names with a port — not `startsWith`.

### Adversarial pass 3 (auto-fixes)

Applied on tip `b6867f8`. V1a energy VAD and C2b `before`-on-overlap are unchanged.

1. **N1 high — session Stop disarms voice.** `sessionStop` and `onBeforeSeal` `await voiceBridge.stopCapture()` so the current utterance is ended and `voice.final` is journaled while the session is still `recording`. Renderer `onState` leaving recording calls `setArmed(false)`: `stopGraph`, idle mic, disable mic/VAD, abort in-flight capture. Mic stays off until the next Record.
2. **N2 medium — sidecar reconnect.** `releaseSidecarTransport` closes a half-open socket and `SIGKILL`s the previous `stt-sidecar` child before spawn/reconnect.
3. **N3 medium — whisper-cli overlap.** At most one in-flight `whisper-cli`; a new transcribe cancels the previous. `abort` / `dispose` `SIGKILL` children, not only Map entries.
4. **N4 low — Hold↔VAD mid-capture.** `spyglass:voice:mode` updates main `captureMode` (and resets VAD) without requiring a capture restart.

### Adversarial pass 4 (auto-fixes)

Applied on tip `2b5ab40`. V1a energy VAD and C2b `before`-on-overlap are unchanged.

1. **P3-N1 high — mic race.** `begin()` / `toggleContinuous` re-validate `armed`/`holding` after `voice.start` and `getUserMedia`. If Stop/`setArmed(false)` raced mid-begin, any late `MediaStream` is stopped and the graph is torn down; main is aborted so the mic is not left hot.
2. **P3-N1 high — flush budget.** `stopCapture` flush wait is `VOICE_FLUSH_MS` (`WHISPER_TIMEOUT_MS_DEFAULT` + 2s = 10s), not 4s. Aligns with whisper timeout so a slow final is not dropped. Wait covers `onFinal`/journal completion.
3. **P3-N1 medium — WS waiter.** Sidecar `final` adopts `trackFinal(journal)` **before** resolving `finalWaiter`; `resolveFinalWaiter` runs in `journal.finally` so `Promise.all(pendingFinals)` cannot finish before the journal promise is in the wait set.
4. **P3-N2 medium — sidecar grandchildren.** Sidecar `close` calls `engine.dispose()` (kills detached `whisper-cli` process groups). Spawn uses `detached: true`. `releaseSidecarTransport` SIGTERMs the sidecar (so dispose runs) then SIGKILLs the process group — not only the Node child.
5. **P3-N3 medium — InProcessStt.abort.** `abort` calls `engine.dispose()` even when `live` was already cleared by `end()`, so in-flight `finalize` / `killJobs` is cancelled. `dispose` delegates to `abort`.

## Screenshots (committed)

| Relative path | What it shows |
| --- | --- |
| [`screenshots/hold-vad-ui.png`](screenshots/hold-vad-ui.png) | Mic + Hold/VAD toggle in the composer |
| [`screenshots/partial-to-final.png`](screenshots/partial-to-final.png) | Live transcript + chat gabarit after hold-to-talk |
| [`screenshots/before-after-correlation.png`](screenshots/before-after-correlation.png) | Chat: dictation before, click, dictation after |
| [`screenshots/c2b-before-overlap.png`](screenshots/c2b-before-overlap.png) | Hold overlapping a click → `before`, not `after` |

Absolute paths in this checkout:

- `/workspace/docs/lot-3/screenshots/hold-vad-ui.png`
- `/workspace/docs/lot-3/screenshots/partial-to-final.png`
- `/workspace/docs/lot-3/screenshots/before-after-correlation.png`
- `/workspace/docs/lot-3/screenshots/offline-dictation.png`
- `/workspace/docs/lot-3/screenshots/continuous-vad.png`
- `/workspace/docs/lot-3/screenshots/c2b-before-overlap.png`

Parent remounts copies to
`/home/box/agent-data/grok-ship/reports/spyglass-screenshots/FM-spyglass-lot-3-20260908/`
(this environment cannot write that path; files live under
`docs/lot-3/screenshots/`).
