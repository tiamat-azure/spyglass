# Lot 5 evidence and PR notes

Do **not** open the pull request from this lot unless a human asks. This file
is the hand-off for a later PR. Parent runs adversarial review, then opens the
PR.

Branch: `cursor/lot-5-runner-dbaf`  
Base: `de91d3a06057fd31127cf3d4052c73bb4078daa4` (Lot 4 merged `main`)

## Suggested PR title

```
feat(lot-5): deterministic runner, bounded AI recovery, suggested patch never applied
```

## Suggested PR body (paste)

Lot 5 (Exécution) only. Lots 0–4 (Electron security, capture, observer,
voice, refine) are unchanged. No Lot 6 thin generated script. No Lot 7
patch auto-apply / PR (F-62–F-65 stay rejected in code, never implemented).

`@spyglass/runner` (ADR-0006) replays a cached scenario from
`refined/rev-N.json` / `scenario.json` **without an LLM on the happy path**
(F-50). Each step must pass post-step verification before the next step
runs (F-51).

On verification failure, recovery is bounded: smart profile
(`claude-sonnet-4-5-20250929`, I-05), optional Stagehand `observe()` on
the recovery path only with Lot 4 **R3c target-correlated** mapping
(never array-index), max retries default 3 / `MAX_AI_RETRIES` (F-52–F-55).
Success resumes deterministic replay (F-54). Exhaustion exits non-zero
with a detailed `report.json` (F-55, F-56).

Successful recovery writes `runs/<runId>/suggested-patch.json` with
`applied: false` and **never mutates** the scenario / `rev-N.json` (F-57).

CLI `spyglass-run`: `--headless`, `--base-url`, `--timeout`,
`--max-ai-retries`, `--no-ai`, `--ai`, `--report`, `--trace` (F-58).
`CI=1` defaults recovery off (equiv `--no-ai`); explicit `--ai` forces it;
`--no-ai` always wins (F-60). Clean deterministic fail needs no API keys.

F-61: `isMultimodal` on the pinned smart snapshot; non-blocking warn at
settings **Test connection** and on each recovery attempt; text-DOM
fallback (screenshots still land on disk for F-56). `--trace` writes
`runs/<runId>/trace.zip` with `node:path` (Windows-safe).

F-59: in-app **Rejouer** in the embedded guest, step list + chat
`replay.step` follow. Checkbox maps to `--ai` / `--no-ai`.

### Exit criteria (PRD §11 Lot 5)

- [x] Successful replay without AI on an unchanged site
- [x] Successful AI recovery on a deliberately broken selector
- [x] Suggested patch produced but not applied
- [x] CI / `--no-ai`: clean fail without recovery

### How the exit demos were proven

`pnpm lint`, `pnpm typecheck`, `pnpm test` (**319 passed, 1 skipped**, 44
files), `pnpm test:schemas` (2 passed), and `xvfb-run pnpm test:e2e`
(**15 passed**, Lots 0–5) on this branch. CI uses the mock LLM transport
(no live keys).

1. **Deterministic replay.** Unit: `MemoryPageDriver` replays `#go` then
   `#next` with a recoverer that must not be called. E2E: record → refine
   → finalize → Rejouer (checkbox off) → every step `mode=script` passed.
2. **Broken-selector recovery.** Unit: `#does-not-exist` recovers via
   `StaticRecoverer` to `[data-testid="step-1"]`, next step stays script.
   E2E: mutate last `rev-1` selector, check **Forcer le rattrapage IA**,
   mock smart returns `SPYGLASS_MOCK_RECOVER_SELECTOR`.
3. **Suggested patch unapplied.** `suggested-patch.json` has
   `applied: false`; the on-disk `rev-N.json` selector remains
   `#does-not-exist`.
4. **`--no-ai` / CI fail-clean.** Unit: `CI=1` + recoverer must not run.
   E2E: uncheck the AI box and expect `mode=script` failed, no new AI
   steps.

### Screenshots

| File | What it shows |
| --- | --- |
| [`screenshots/replay-panel-ready.png`](screenshots/replay-panel-ready.png) | Rejeu panel after finalize |
| [`screenshots/deterministic-replay-success.png`](screenshots/deterministic-replay-success.png) | Script-mode passed steps |
| [`screenshots/replay-chat-follow.png`](screenshots/replay-chat-follow.png) | Chat follow (`replay.step`) |
| [`screenshots/broken-selector-recovery.png`](screenshots/broken-selector-recovery.png) | AI recovery passed |
| [`screenshots/suggested-patch-unapplied.png`](screenshots/suggested-patch-unapplied.png) | Recovery succeeded; scenario selector unchanged |
| [`screenshots/no-ai-fail-clean.png`](screenshots/no-ai-fail-clean.png) | `--no-ai` failed without recovery |

## Product decisions (ask-user)

1. **S-5 vs F-50 / F-60.** The Lot -1 state machine said Replaying requires
   smart reachable. Lot 5 implements: **deterministic replay does not
   require a live smart profile or API keys.** Only the Recovering
   sub-state does. Entering `replaying` from `finalized` is allowed
   offline / in CI. Contract `state-machine.md` S-5 is updated to match.
2. **In-app AI checkbox.** Checked → `--ai` (`forceAi`). Unchecked →
   `--no-ai`. This is stricter than CLI env-default, so the chrome can
   demonstrate fail-clean without relying on `CI=1`.
3. **`observe()` in mock CI.** Stagehand observe is skipped when
   `SPYGLASS_LLM_TRANSPORT=mock` (90s timeout would blow the e2e budget).
   Live recovery still observes, then R3c-correlates; observe throws are
   swallowed so smart can still patch.
4. **Multimodal wire format.** F-61 detects `isMultimodal` and warns.
   Recovery context is still text-DOM JSON (`screenshotIncluded` flag).
   JPEG files are written under `runs/<id>/screenshots/` (F-56) but not
   attached as binary image blocks on the smart request. `screenshotIncluded`
   stays `false` unless those bytes are actually on the transport (L5-ADV-02).

## Adversarial pass 1 (auto-fixes on `cfe8b33`)

Applied on tip `cfe8b33`. I-05 and Lot 4 R3c remain locked. L5-ADV-05
(observe vs LLM precedence) is **not** changed.

- **L5-ADV-01.** Recovered actions are sanitized before `performAction`:
  type is pinned to the failed step; fill/select/check/press/wait/scroll
  arguments stay recorded values; navigate URLs must pass
  `normalizeHttpOrHttpsUrl` (same http(s)-only gate as chrome `nav.goto`).
  `parseRecoverResponse` no longer copies unconstrained LLM arguments.
  `ElectronPageDriver.goto` uses `resolveDriverGotoUrl` — never raw
  `loadURL`. Recorded in-app `file:` start pages still load when the
  current guest already allows that resource.
- **L5-ADV-02.** `LlmRecoverer` always sends `screenshotIncluded: false`.
  Recovery stays text-DOM JSON; JPEGs remain on disk only.
- **L5-ADV-03.** `urlMatches` is glob-only. Empty / `*` / `**` /
  whitespace-only wildcards are rejected; substring `includes('')` is gone.
- **L5-ADV-04.** In-app `ReplayEngine.start` returns `{ ok: false, error, runId }`
  when `exitCode !== 0`, so the renderer cannot show a successful start for
  a failed run.

## Residuals

- Lot 6 generated Playwright script / corpus is out of scope.
- Lot 7 auto-apply / PR (F-62–F-65) is out of scope; `parseRecoverResponse`
  already rejects any `scope` other than `action.descriptor`.
- No live smart bake-off (no live keys in this environment).
- `claude-sonnet-4-6` is not adopted; I-05 remains
  `claude-sonnet-4-5-20250929`.
