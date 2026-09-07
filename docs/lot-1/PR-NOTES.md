# Lot 1 evidence and PR notes

Do **not** open the pull request from this lot unless a human asks. This file
is the hand-off for a later PR. Parent runs adversarial review, then opens the
PR.

Branch: `cursor/lot-1-capture-29d8`  
Base: `f4fb4177418b089d3b27ca74fc3c6a5f9e0e3137` (Lot 0 merged `main`)

## Suggested PR title

```
feat(lot-1): DOM capture, Record/Stop, raw.jsonl, act() without LLM
```

## Suggested PR body (paste)

Lot 1 (Capture) only, plus D-10 / Lot 0 bis docs closed as **confirmed**.

Captain closed Lot 0 bis on **2026-09-08** (scout evidence + explicit word).
Outlook Web / MSAL used `interactionType: redirect` in a single
`WebContentsView`. No `window.open`, `target=_blank`, or
`nav.popup-redirected`. The MFA / directory-federation hop was **not**
completed; the `loginRedirect` hypothesis is still marked confirmed, with
residual IdP-popup risk and `pageId` remaining additive (ADR-0010). Scout
branch `scout/lot-0bis-evidence-20260908` @ `840f187` (`docs/lot-0bis-scout/`)
is referenced, not merged.

The guest probe captures multi-frame and **open** shadow DOM (`framePath` /
`shadowPath` first-class, ADR-0009). Closed shadow is out of scope. Capture
normalizes, masks secrets (F-15), denoises click+change / input aggregation /
scroll threshold (F-16), and assigns `stepIndex`. Each user step gets a
**local** ObserveResult-compatible replay descriptor (F-22) — **no LLM at
capture**. Events append to `raw.jsonl` with fsync (F-40). Retraction appends
`step.retracted` and never deletes (F-19). Chrome UI Record/Stop (F-10) uses
`webdesign.md` tokens (REC pill, magenta recording outline). Retention (D-11 /
ADR-0011) keeps a sliding buffer of N=10 JPEG screenshots plus lightweight DOM
snapshots. Capture pins a step when its snapshot or screenshot write fails
(P1a). `act()` does not pin or un-prune JPEGs.

Stagehand `act()` replays those descriptors over CDP with `selfHeal: false`.
The act worker's stub LLM **throws** if `createChatCompletion` is called, so a
green run proves zero LLM usage (I-07).

A local fixture (`packages/app/resources/lot1-fixture.html` +
`lot1-iframe.html`) provides a 10-action path with one iframe action and one
open-shadow custom element so CI does not need external sites.

**No Lot 2+** (no LLM chat, narration batches, voice, refinement, or runner).

Electron security from Lot 0 is unchanged: sandboxed guest, no
`nodeIntegration`, no guest preload, chrome-only IPC, CDP opt-in,
`remote-allow-origins` empty string (never `*`).

### Exit criteria (PRD §11 Lot 1)

- [x] Record / Stop in chrome UI (F-10)
- [x] Multi-frame + open shadow probe (`framePath` / `shadowPath`, ADR-0009)
- [x] Normalization, masking (F-15), denoising (F-16), `stepIndex`
- [x] Local replayable action descriptor, ObserveResult-compatible, no LLM (F-22)
- [x] Append-only `raw.jsonl` (F-40)
- [x] Retraction appends `step.retracted`, never deletes (F-19)
- [x] Sliding screenshot buffer N=10 + lightweight snapshots (D-11 / ADR-0011)
- [x] 10-action fixture path including **one iframe** and **one open shadow**
      action produces a complete `raw.jsonl`
- [x] Each local descriptor replays via Stagehand `act()` with **no LLM call**
- [x] D-10 / I-02 / Lot 0 bis: hypothesis **confirmed** (MFA hop not played)

### How the 10-action / act()-no-LLM exit was proven

1. Unit tests (`pnpm test`): masking, hops (`iframe#… >> [data-testid]`),
   shadow selectors **without** `>>` (Stagehand treats `>>` as iframe
   FrameLocators; open shadow is CSS pierce-fallback), journal recover,
   retention prune + pin, schema fixtures.
2. Schema corpus (`pnpm test:schemas`): iframe click, shadow click, and
   `step.retracted` examples validate.
3. Playwright e2e `packages/app/e2e/lot1-capture.spec.ts` (`SPYGLASS_GUEST_PAGE=lot1-fixture.html`):
   Record → 10 actions (click, fill, password, select, checkbox check then
   uncheck, continue, scroll, Enter, iframe `#step-9`, open-shadow `#step-10`)
   → retract → Stop → assert `raw.jsonl` (iframe `framePath`, non-empty
   `shadowPath`, masked password, `dom.check` true **and** false, `step.retracted`)
   → reload guest → **Replay capture (no LLM)** → log contains
   `act() ok · llmCalls=0`. Checkbox replay uses `setChecked` with the
   journaled boolean (C1b), not a click-toggle; after reload+replay `#step-5`
   stays unchecked.

The act worker (`packages/app/scripts/stagehand-act.mjs`) sets
`selfHeal: false` and increments `llmCalls` only if the stub
`createChatCompletion` runs (it throws). Success requires `llmCalls === 0`.

### Residual / not in this lot

- MFA / enterprise STS popup after email (D-10 residual). `pageId` additive.
- Closed shadow DOM (ADR-0009 out of scope).
- I-08 extra DOM snapshot on mutation-without-user-action: not implemented.
  Per-step lightweight snapshots still run on captured user actions.
- **S1 (captain / Firstmate, 2026-09-08): accepted.** Per-step lightweight
  snapshots stay **main-frame only** for Lot 1 (`captureSnapshot` uses
  `webContents.mainFrame` + `snapshotScript(['main'])`). Probe events still
  carry `framePath` / `shadowPath` on the element descriptor. Per-step
  `framePath` snapshots are deferred to a later lot.
- **C1b (captain / Firstmate): applied.** `dom.check` records `true`/`false`
  and replays with `setChecked` (plus `uncheck` when false) so reload cannot
  invert the control. Not a click-toggle.
- **S2a (captain / Firstmate): applied.** Once `record.stop` is durable in
  `raw.jsonl`, the session is terminal and non-recording. Meta write failure
  enters `sealed-failed` (appends frozen, Record cannot continue that session).
  Retry Stop repairs `meta.json` / force-seals only — it does not append a
  second `record.stop`. Do not revert to `recording` after a durable stop.
- **P1a (captain / Firstmate): applied.** D-11 pins are **capture-time only**
  (snapshot or screenshot write miss). `act()` does not pin failures and does
  not preserve already-pruned JPEGs.
- Replay of masked values uses the `SECRET_*` ref string, not the clear
  secret (F-15). Fixture proof fills `SECRET_PASSWORD` after reload.

### Adversarial changelog (do not reopen locked S1 / C1b / S2a / P1a)

- **Pass 9:** Stop last-fill is a real drain. `flushAllPendingInputs` **returns**
  pending payloads; main `executeJavaScript` returns `eventsJson`; orchestrator
  `processProbePayload`s them **before** `stopping` / `record.stop`. No
  `console.log` + `setTimeout(0)` barrier. Missing `Symbol.for('spyglass.probe.flush')`
  fails Stop (reinject once, then throw) — does not silently seal. Probe will
  not attach listeners if the flush hook cannot be installed. `setChecked`
  prefers Playwright `locator.setChecked`; otherwise click-to-desired plus
  `isChecked()` verify. DOM-only `el.checked =` / CDP `Runtime.callFunctionOn`
  is gone.

## Screenshots (committed)

Playwright's chrome `Page.screenshot()` captures the Electron renderer, not the
child `WebContentsView`, so the guest pane is black in chrome shots. Guest
DOM evidence is `fixture-after-capture.png`. Iframe/shadow proof is the
capture log plus `raw.jsonl`.

| Relative path | What it shows |
| --- | --- |
| [`screenshots/record-stop-ui.png`](screenshots/record-stop-ui.png) | Record / Replay (no LLM) chrome UI + REC pill (idle) |
| [`screenshots/iframe-shadow-capture.png`](screenshots/iframe-shadow-capture.png) | Recording: Stop, REC active, iframe + shadow log rows, retract |
| [`screenshots/fixture-after-capture.png`](screenshots/fixture-after-capture.png) | Guest fixture after the 10-action path (iframe + shadow controls) |
| [`screenshots/raw-jsonl-excerpt.txt`](screenshots/raw-jsonl-excerpt.txt) | Pretty excerpt: masked password, iframe hop, open shadow, retract |
| [`screenshots/act-replay-success.png`](screenshots/act-replay-success.png) | `act() ok · llmCalls=0 · 11 actions` |

Absolute paths in this checkout:

- `/workspace/docs/lot-1/screenshots/record-stop-ui.png`
- `/workspace/docs/lot-1/screenshots/iframe-shadow-capture.png`
- `/workspace/docs/lot-1/screenshots/fixture-after-capture.png`
- `/workspace/docs/lot-1/screenshots/raw-jsonl-excerpt.txt`
- `/workspace/docs/lot-1/screenshots/act-replay-success.png`

Parent remounts copies to
`/home/box/agent-data/grok-ship/reports/spyglass-screenshots/FM-spyglass-lot-1-20260908/`
(this environment could not write that path; files live under `docs/lot-1/screenshots/`).
