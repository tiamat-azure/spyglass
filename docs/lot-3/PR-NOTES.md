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
VAD**) as PCM 16 kHz mono and sends frames over IPC `spyglass:voice:frame`.
The **main** process is the only WebSocket client: it owns a localhost sidecar
(`@spyglass/stt`) that never leaves `127.0.0.1` (ADR-0005). The renderer does
not open STT sockets.

Streaming STT paints **partials** in a live strip, then consolidates a
**final** segment in the chat. Each `voice.final` line in `raw.jsonl` carries
timestamps plus `voice.relation` `before` | `after` | `unanchored` and, when
known, `correlatedEventId` / `correlatedStepIndex` (F-32). Append-only: a
dictation *before* an action predicts the next `stepIndex`; a dictation *after*
points at the last committed DOM step.

Local engine (ADR-0004 / ADR-0013): **whisper.cpp** `small` q5_1, invoked as a
child process with **no network**. CI and this environment use the **mock**
engine (`SPYGLASS_STT_ENGINE=mock`) because binaries/models are too heavy to
vendor. The real path is `createWhisperEngine` + `scripts/fetch-whisper.mjs` →
`vendor/whisper/` (gitignored `.bin` / `whisper-cli`). Auto-selects whisper
when both files exist.

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

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:schemas`,
`pnpm test:coverage`, and `pnpm test:e2e` (Lot 0–3) on this branch. CI uses
mock STT + fake PCM (`SPYGLASS_VOICE_FAKE=1`). whisper.cpp is covered by a
**local stub binary** unit test that writes a `.txt` transcript with no HTTP.

1. **Dictate before and after an action.** Playwright
   `packages/app/e2e/lot3-voice.spec.ts` Records, hold-to-talk (fake PCM → mock
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

- Guest `WebContentsView` still cannot obtain `media`. Chrome renderer may,
  for the mic only.
- Sidecar binds `127.0.0.1`. Upgrade requests with a non-local Host header are
  dropped.
- `raw.jsonl` stays append-only. Correlation never rewrites a previous voice
  line.

## Screenshots (committed)

| Relative path | What it shows |
| --- | --- |
| [`screenshots/hold-vad-ui.png`](screenshots/hold-vad-ui.png) | Mic + Hold/VAD toggle in the composer |
| [`screenshots/partial-to-final.png`](screenshots/partial-to-final.png) | Live partial strip during hold-to-talk |
| [`screenshots/before-after-correlation.png`](screenshots/before-after-correlation.png) | Chat: dictation before, click, dictation after |
| [`screenshots/offline-dictation.png`](screenshots/offline-dictation.png) | Dictation with LLM offline / network cut |

Absolute paths in this checkout:

- `/workspace/docs/lot-3/screenshots/hold-vad-ui.png`
- `/workspace/docs/lot-3/screenshots/partial-to-final.png`
- `/workspace/docs/lot-3/screenshots/before-after-correlation.png`
- `/workspace/docs/lot-3/screenshots/offline-dictation.png`

Parent remounts copies to
`/home/box/agent-data/grok-ship/reports/spyglass-screenshots/FM-spyglass-lot-3-20260908/`
(this environment may not be able to write that path; files live under
`docs/lot-3/screenshots/`).
