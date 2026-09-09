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
| `pnpm lint` | pass (272 files) |
| `pnpm typecheck` | pass (6 packages) |
| `pnpm test` | **587 passed**, 1 skipped (61 files) |
| `pnpm test:schemas` | 2 passed |
| `pnpm test:e2e` | **17 passed** (includes `lot7-finition.spec.ts`) |

Lot 7-focused unit tests: `lot7-patch.test.ts` (53), `patch-redact.test.ts` (10), `lot7-parameters.test.ts` (38),
`upgrade.test.ts` (18), `stt-upgrade-store.test.ts` (6).

### Screenshots (illustrative fixtures)

PNGs from `scripts/capture-lot-7.mjs` under `docs/lot-7/screenshots/` are
**illustrative fixtures** (scripted HTML pages). They are **not** live
Spyglass app or target-repo captures.

| File | Caption |
|---|---|
| [`screenshots/health-json.png`](screenshots/health-json.png) | Illustrative fixture: F-63 / F-65 `health.json` after two matching recoveries |
| [`screenshots/assisted-branch.png`](screenshots/assisted-branch.png) | Illustrative fixture: dedicated `spyglass/patch-…` branch; `main` SHA unchanged |
| [`screenshots/datasets.png`](screenshots/datasets.png) | Illustrative fixture: distinct `--dataset` fill values (F-48) |

Live chrome controls: `pnpm test:e2e` (`lot7-finition.spec.ts`) writes
`chrome-lot7-controls.png` when `SPYGLASS_E2E_SCREENSHOT_DIR` is set.

Capture HTML evidence (still fixture HTML, not the running app):

```bash
NODE_OPTIONS=--experimental-transform-types node scripts/capture-lot-7.mjs
```

## Product decisions (ask-user)

1. **Assisted apply mutates the target `--repo` copy**, not
   `suggested-patch.json` (`applied` stays `false`). Fragility counters
   increment when a PR is prepared (`prPrepared: true`), not merely when
   the local branch commit lands (H5b).
2. **In-app replay** writes `health.json` on the session. Git/PR only when
   `PATCH_ASSISTED_APPLY` is on **and** the scenario file is inside
   `--repo`.
3. **STT download** uses `ggml-large-v3-turbo-q5_0.bin`. Tests use
   `SPYGLASS_STT_UPGRADE_FAKE=1` and never fetch ~575 Mo.
4. **Export/import** copies the session folder (plus
   `spyglass-session.json` manifest). In-app F-47 picks the folder with
   a main-process directory dialog (E4a). Path-traversal session ids and
   `.` / `..` are refused (L7-007). Export refuses a non-empty dest
   unless an explicit overwrite flag is set (O7a). Import refuses when
   the same `sessionId` already exists (I7a).

Pass-1 adversarial (L7-001 … L7-008) is recorded in `CHANGELOG.md`.
Pass-2 (L7-009 … L7-016) and Captain lock **P2a** (dataset missing
`parameterRef` fails fast, no silent descriptor fallback) are in
`CHANGELOG.md`.
Pass-3 (L7-017 … L7-020), **W3a** (`--large` atomic download), and
**F3a** (`readLargeFallback` honours `fallback: false`) are in
`CHANGELOG.md`.
Pass-4 (L7-021 … L7-031) is in `CHANGELOG.md`.
Pass-5 (L7-032 … L7-043) plus Captain locks **E4a / S4a / R4a / M4a /
U4a** are in `CHANGELOG.md`.
Pass-6 (L7-044 … L7-052) plus Captain locks **A5b** (sync
`createInProcessStt` + `createInProcessSttFromEnv`), **H5b** (health
increment only when `prPrepared`), **P6a** (`STT_MODEL_PATH` over
`STT_MODEL_DIR` conventional discovery), and **C6a** (capture screenshots
are illustrative fixtures) are in `CHANGELOG.md`.
Pass-7 (L7-053 … L7-059) plus Captain locks **O7a** (export refuses
non-empty dest) and **I7a** (import refuses existing same `sessionId`)
are in `CHANGELOG.md`.
Pass-8 (L7-060 … L7-064) is in `CHANGELOG.md`.
macOS Electron e2e close hang (timeout + `SIGKILL`, popup `noWaitAfter`)
is in `CHANGELOG.md`.
Pass-9 (L7-066 … L7-073) is in `CHANGELOG.md`.
Pass-10 (L7-074 … L7-075) plus Captain locks **F8a** (AbortError /
cancellation excluded from first-use latency) and **B10b** (load scenario
before `beginReplay`) are in `CHANGELOG.md`.
Pass-11 (L7-076 … L7-082) plus Captain lock **R10a** (shared explicit
`parameterRef` last-write-wins on extract; no conflict warn/error) are
in `CHANGELOG.md`.
Pass-12 (L7-083 … L7-090) is in `CHANGELOG.md`.
Captain lock **S11a** (skip fail/recover screenshots for `parameterRef`
steps) is in `CHANGELOG.md`.
Pass-13 (L7-091 … L7-098) is in `CHANGELOG.md`.
Captain lock **D11a** (`generated/datasets/recorded.json` is local-only
plaintext secrets; gitignored) is in `CHANGELOG.md`.
Pass-14 (L7-099 … L7-102) is in `CHANGELOG.md`.
Captain lock **P12a** (PR-prep failure is `ok: false` / `pr-prep-failed`)
is in `CHANGELOG.md`.
Captain lock **P13a** (strip proposed-side secret args before patch
persistence) is in `CHANGELOG.md`.
Captain lock **P14a** (non-ff remote delete gated on no open PR) is in
`CHANGELOG.md`.
Pass-15 (L7-103 … L7-108) is in `CHANGELOG.md`.
Windows CI: L7-108 backoff starts after the second failed first-use persist
so L7-097 can still sample a later non-overlapping finalize.
Pass-16 (L7-109 … L7-116) is in `CHANGELOG.md`.
Pass-17 (L7-117 … L7-125) is in `CHANGELOG.md`.
Captain lock **B16a** (checkout starting branch after assisted-apply
success; leave `spyglass/patch-*` for review) is in `CHANGELOG.md`.
Pass-18 (L7-126 … L7-127) is in `CHANGELOG.md`.
Captain lock **F16b** (corrupt `large-fallback.json` fail-loud only when
large is in play) is in `CHANGELOG.md`.
Pass-19 (L7-128 … L7-133) is in `CHANGELOG.md`.

## Residuals

- Live `gh pr create` against GitHub is optional; tests stub `preparePr`.
- Live whisper `large-v3-turbo` first-use latency is not measured here (no
  575 Mo weights in CI).
- **R10a:** Shared explicit `parameterRef` last-write-wins on extract.
  Duplicate refs stay one dataset variable (R4a). A later step overwrites
  `dataset.values[name]`. No conflict warn/error (Captain lock).
- **S11a:** Recovery/fail screenshots are skipped for parameterized
  scenarios so filled secrets are not written to screenshot artifacts.
- **D11a:** `generated/datasets/recorded.json` is plaintext captured
  values (including secrets). Gitignored; do not commit. Use
  `datasets/example.json` as the template.
- **P12a:** Push / `gh pr create` / `preparePr` failure after a local
  commit is `ok: false` + `code: 'pr-prep-failed'`. Patch branch remains
  for resume (L7-084). Health increments only when `prPrepared: true`
  (H5b).
- **P13a:** Proposed/`after` descriptors in `suggested-patch.json` and
  health candidate hashes have parameterized fill/select `arguments`
  stripped (same condition as L7-038 originals). Dataset-materialized
  secrets never land on disk in patch artifacts. Recovery still fills
  the live value.
- **P14a:** Non-fast-forward `git push` of `spyglass/patch-*` deletes and
  recreates the remote branch only when no open PR uses that head. An
  open PR is `ok: false` / `code: 'open-pr'`; remote is left alone.
  Local branch stays for resume. Health is not incremented (H5b / P12a).
  L7-094 stubs `createPr` so Windows does not hang on live `gh pr create`.
- **B16a:** After apply **success**, checkout the captured pre-apply
  starting ref (`StartingHead` name, or SHA when detached). Do not read
  `currentBranch()` after success (HEAD is the patch branch).
  `spyglass/patch-*` stays local and pushed for review. P12a/P14a
  **failures** stay on the patch branch for L7-084 resume.
- **F16b:** Corrupt/unreadable `large-fallback.json` fails engine creation
  only when large could be selected. Small-only setups ignore the marker.
  Direct `readLargeFallback` still throws (L7-042). Status IPC still
  reports `fallback-unreadable` (L7-061).
