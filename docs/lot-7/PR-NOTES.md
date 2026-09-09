# Lot 7 evidence and PR notes

Do **not** open the pull request from this lot unless a human asks. This file
is the hand-off for a later PR. Parent runs adversarial review, then opens the
PR.

Branch: `cursor/lot-7-finition-1b3a`  
Base: `3c528b4f31832b81efe3c1ee17d273ef873a1d23` (Lot 6 merged `main`)

## Suggested PR title

```
feat(lot-7): assisted descriptor patches, STT upgrade, export/import, stepwise replay, datasets
```

## Suggested PR body (paste)

Lot 7 (Finition v1.1) only. Lots 0–6 (Electron security, capture, observer,
voice, refine, runner, generated script) are unchanged. I-05 remains
`claude-sonnet-4-5-20250929`. Lot 6 locks (headed-default D35b, A19a
scenario-dir `--report`, S44b/S66b driver-less Chromium, generate-first
G56a/D61a/P65a, C68a, N52b, O57a, V59a, H29a F-58 help block) stay.

Assisted apply is gated by `PATCH_ASSISTED_APPLY` (default **false**, PRD
§7). `suggested-patch.json` remains `applied: false` (F-57). Only
`action.descriptor` may be assisted-applied (F-62 / CA-14); verification
and scenario structure stay proposal-only forever — no escape hatch, even
if `PATCH_ALLOW_*` is set.

F-63: `health.json` `patchCandidates[]` (`descriptorHash`,
`consecutiveRuns`, `lastRunId`). Promote after **2 consecutive** matching
descriptors (`PATCH_CONFIRM_RUNS`). A different descriptor resets the
count. Isolated success never promotes.

F-64: apply on a dedicated `spyglass/patch-…` branch in `--repo` /
`PATCH_TARGET_REPO`. Dirty worktree refused. Never commit `main`/`master`.
PR is prepared as **draft**; human review required (CI green ≠ merge).

F-65: cumulative `appliedPatches`; ≥ `PATCH_WARN_THRESHOLD` (3) →
`fragile`; ≥ `PATCH_STALE_THRESHOLD` (5) → `stale` (re-record). Stale
blocks further assisted apply.

Optional STT `large-v3-turbo` after `STT_UPGRADE_PROMPT_AFTER` (10) manual
corrections (F-38). Refusable permanently. `small` stays as fallback if
first-use latency exceeds `STT_MAX_LATENCY_MS` (F-39 / ADR-0017).

Session autonomous folder export/import (F-47). In-app Rejouer **pas à
pas** (F-59). Parameterized fill/select via `datasets/*.json` and
`--dataset` (F-48).

### Exit criteria (PRD §11 Lot 7)

- [x] Descriptor patch confirmed twice → assisted PR path (branch/PR tooling)
      under `PATCH_ASSISTED_APPLY`
- [x] Verification/structure patches remain proposal-only (asserted by tests)
- [x] Parameterized scenario replays with distinct datasets

### How the exit demos were proven

## Test counts (local, this lot)

| Command | Result |
|---|---|
| `pnpm lint` | pass (267 files) |
| `pnpm typecheck` | pass (6 packages) |
| `pnpm test` | **498 passed**, 1 skipped (59 files) |
| `pnpm test:schemas` | 2 passed |
| `pnpm test:e2e` | **17 passed** (includes `lot7-finition.spec.ts`) |

Lot 7-focused unit tests: `lot7-patch.test.ts` (29), `lot7-parameters.test.ts` (20),
`upgrade.test.ts` (11), `stt-upgrade-store.test.ts` (4).

Screenshots: `docs/lot-7/screenshots/` (`health-json.png`, `assisted-branch.png`,
`datasets.png`, plus `chrome-lot7-controls.png` from e2e when
`SPYGLASS_E2E_SCREENSHOT_DIR` is set).

Capture HTML evidence:

```bash
NODE_OPTIONS=--experimental-transform-types node scripts/capture-lot-7.mjs
```

## Product decisions (ask-user)

1. **Assisted apply mutates the target `--repo` copy**, not
   `suggested-patch.json` (`applied` stays `false`). Fragility counters
   increment when the branch commit lands, not when a human merges.
2. **In-app replay** writes `health.json` on the session. Git/PR only when
   `PATCH_ASSISTED_APPLY` is on **and** the scenario file is inside
   `--repo`.
3. **STT download** uses `ggml-large-v3-turbo-q5_0.bin`. Tests use
   `SPYGLASS_STT_UPGRADE_FAKE=1` and never fetch ~575 Mo.
4. **Export/import** copies the session folder (plus
   `spyglass-session.json` manifest). In-app F-47 picks the folder with
   a main-process directory dialog (E4a). Path-traversal session ids and
   `.` / `..` are refused (L7-007).

Pass-1 adversarial (L7-001 … L7-008) is recorded in `CHANGELOG.md`.
Pass-2 (L7-009 … L7-016) and Captain lock **P2a** (dataset missing
`parameterRef` fails fast, no silent descriptor fallback) are in
`CHANGELOG.md`.
Pass-3 (L7-017 … L7-020), **W3a** (`--large` atomic download), and
**F3a** (`readLargeFallback` honours `fallback: false`) are in
`CHANGELOG.md`.
Pass-4 (L7-021 … L7-031) is in `CHANGELOG.md`.
Pass-5 (L7-032 … L7-043) plus Captain locks **E4a / S4a / R4a / M4a /
U4a** are in `CHANGELOG.md`. Still pending: **A5** (`createInProcessStt`
sync vs Promise) and **H5** (keep L7-011 health-on-local-commit).

## Residuals

- Live `gh pr create` against GitHub is optional; tests stub `preparePr`.
- Live whisper `large-v3-turbo` first-use latency is not measured here (no
  575 Mo weights in CI).
