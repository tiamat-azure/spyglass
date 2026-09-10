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
first-use latency exceeds `STT_MAX_LATENCY_MS` (F-39 / ADR-0017). The
`whisper-cli` process timeout is `STT_WHISPER_TIMEOUT_MS` (L27b).

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
| `pnpm lint` | pass (276 files) |
| `pnpm typecheck` | pass (6 packages) |
| `pnpm test` | **753 passed**, 1 skipped (62 files) |
| `pnpm test:schemas` | 2 passed |
| `pnpm test:e2e` | **17 passed** (includes `lot7-finition.spec.ts`) |

Lot 7-focused unit tests: `lot7-patch.test.ts` (99), `patch-redact.test.ts` (20), `lot7-parameters.test.ts` (76),
`upgrade.test.ts` (38), `stt-upgrade-store.test.ts` (6), `stt-upgrade-policy.test.ts` (8).

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
3. **STT download** uses `ggml-large-v3-turbo-q5_0.bin`. Unpackaged/test
   builds may set `SPYGLASS_STT_UPGRADE_FAKE=1` and never fetch ~575 Mo.
   Packaged production ignores FAKE and env `STT_LARGE_SHA256` (E18a).
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
macOS Electron e2e close hang (timeout + `SIGKILL`, popup `noWaitAfter`;
Windows `taskkill /T /F` process tree) is in `CHANGELOG.md`.
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
so L7-097 can still sample a later non-overlapping finalize. The skip
window is `FIRST_USE_BACKOFF_MS` (2s) so Windows stub spawn cannot leak a
third persist.
Pass-16 (L7-109 … L7-116) is in `CHANGELOG.md`.
Pass-17 (L7-117 … L7-125) is in `CHANGELOG.md`.
Captain lock **B16a** (checkout starting branch after assisted-apply
success; leave `spyglass/patch-*` for review) is in `CHANGELOG.md`.
Pass-18 (L7-126 … L7-127) is in `CHANGELOG.md`.
Captain lock **F16b** (corrupt `large-fallback.json` fail-loud only when
large is in play) is in `CHANGELOG.md`.
Pass-19 (L7-128 … L7-133) is in `CHANGELOG.md`.
Pass-20 (L7-134 … L7-141) is in `CHANGELOG.md`.
Pass-21 (L7-142 … L7-157) is in `CHANGELOG.md`.
Pass-22 (L7-158 … L7-164) is in `CHANGELOG.md`.
Captain lock **A17b** (sync `createEngineFromEnv` + named
`createEngineFromEnvAsync`) is in `CHANGELOG.md`.
Captain lock **E18a** (packaged production ignores FAKE / env
`STT_LARGE_SHA256`) is in `CHANGELOG.md`.
Captain lock **M18a** (`STT_MODEL_FILE` wins over large basename when
the configured file exists) is in `CHANGELOG.md`.
Captain lock **W18a** (`--large` ensures small F-39 fallback) is in
`CHANGELOG.md`.
Captain lock **R19a** (parameterized recovery blanks every
`snapshot.values` entry) is in `CHANGELOG.md`.
Captain lock **D20a** (`parameterRef` without a resolved dataset value
fails fast even without `--dataset`) is in `CHANGELOG.md`.

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
- **A17b:** `createEngineFromEnv` is sync. Whisper marker I/O uses
  `readLargeFallbackSync`. Callers that must not block (sidecar,
  `createInProcessSttFromEnv`) use `createEngineFromEnvAsync`.
- **E18a:** Packaged production ignores `SPYGLASS_STT_UPGRADE_FAKE` and
  env `STT_LARGE_SHA256`. Unpackaged or `NODE_ENV=test` may still use
  those escapes (no ~575 Mo fetch in tests).
- **M18a:** An existing `STT_MODEL_FILE` / `STT_MODEL` match is chosen
  before L7-125 large-basename discovery. Unset or missing configured
  files still prefer large. `STT_MODEL_PATH` stays first.
- **W18a:** `fetch-whisper.mjs --large` downloads `ggml-small-q5_1.bin`
  when missing so F-39 small fallback exists after a clean `--large` run.
- **R19a:** Parameterized recovery blanks every `snapshot.values` entry
  (not only the recorded selector key). Aligns with L7-161.
- **D20a:** `parameterRef` without a resolved dataset value fails fast
  even when `--dataset` is omitted (no silent empty fill/select). Same
  P2a error; empty string present in the dataset is still valid.
- **H21a:** On health load, pre-Lot-7 `patchCandidates` missing usable
  `runIds` get them from existing string items or `lastRunId`.
  `schemaVersion` stays 1. Schema still requires `runIds` (L7-128);
  load no longer fails solely for that omission.
- **R28a:** `validateHealth` migrates missing `runIds` (H21a) before Ajv
  so callers that skip `loadHealth` do not fail-closed on pre-Lot-7
  artifacts. Raw `validateUnknown('health', …)` still rejects missing
  `runIds` (L7-128). `schemaVersion` stays 1.
- **G28b:** `detectDefaultBranch` requires `origin/HEAD` or local/remote
  `main`/`master`. It does not use the currently checked-out branch as
  the PR base. Missing those refs fail with `unresolved-default`.
- **P28b:** `redactSuggestedPatchEntryForPersistence` scrubs known
  parameter/secret values by value (R19a), even when the recorded step
  has no `parameterRef`. L7-106 missing-step and P13a parameterized
  strips stay.
- **S28b:** `resolveScenarioPath` refuses a scenario/script path that
  resolves outside `policy.repo` (`scenario-outside-repo`). Relative
  paths still resolve against the repo (L7-036) then must stay inside.
- **X28a:** `withDestLock` stays a single-process in-memory Map. No
  cross-process lockfile this lot. Concurrent import/export is serialized
  only within one process.
- **F28b:** `onFirstUseLatency` attaches whenever the selected Whisper
  file is the large model (basename), including `STT_MODEL_PATH` copies
  outside `join(modelDir, STT_LARGE…)`.
- **W28b:** `fetch-whisper.mjs` `extractArchive` is zip-aware when
  `cliAsset()` yields `.zip` (Windows Expand-Archive; not always
  `tar -xf`). `.tar.gz` still uses `tar`.
- **L7-213:** Leftover recovery never `checkout -f` the default branch;
  re-check dirty first.
- **L7-214:** Health migration caps `consecutiveRuns` to the synthesized
  `runIds` window.
- **L7-215:** `whisperAvailable` is false when prefer-small leaves no
  model.
- **L7-216:** `processSuggestedPatch` failures after the report are
  structured, not thrown.
- **L7-217:** Configured large basename honours large-fallback skip.
- **L7-218:** Missing `STT_MODEL_PATH` large is not “large could be
  selected”.
- **L7-219:** Session bundle export/import refuses special files.
- **L7-220:** `consecutiveRuns` max 32.
- **L7-221:** Duplicate STT accept does not re-download large.
- **L7-222:** Nested descriptor objects hash with sorted keys.
- **L7-223:** Git child exec `maxBuffer` is 32 MiB (not 2MB).
- **L7-224:** Trailing fill/select args keep JSON-serializable
  non-strings.
- **L7-225:** Extracted whisper-cli must meet `CLI_MIN_BYTES` before
  success.
- **L7-226:** `recorded.json` is written via chmod `0o600` temp then
  rename (no in-place overwrite of a world-readable dest).
- **L7-227:** Non-ff remote delete re-checks `hasOpenPr` immediately
  before `origin --delete`.
- **L7-228:** Parameter secret candidacy requires min length 2 (no
  single-char OTP digit word-boundary redact).
- **L7-229:** `--large` skips re-download when a valid large file is
  already present.
- **N29a:** Vacant parameterized `[0]` is JSON `null` in
  `unappliedArguments` (indices preserved; not omitted, not `""`).
- **D29a:** Explicit `parameterRef` is not unique-ified against
  selector-derived names. Last-write-wins on `dataset.values` (R10a);
  `uniqueName` remains selector-derived only (R4a).
- **O29b:** Session export refuses a non-directory dest even with
  `overwrite=true` (no move/delete of a file at dest). IPC
  `dest-not-directory`. W26a empty-dir overwrite-false unchanged.
- **L7-230 / L36a-scrub:** Health/artifacts stay persistence-redacted
  (P13a / P28b). The patch-branch `scenario.json` write uses
  recorded/redacted fill/select args (`persisted.suggested`), not live
  dataset secrets. Lifecycle still passes the live suggested patch to
  `applyAssistedPatches` for F-63 matching.
- **L36b-bound:** `SECRET_NAME` matches identifier tokens (word/camelCase
  boundaries), not substrings. `#shipping_address` / `#spinner` are not
  `pin`.
- **L36c-cancelled:** User stop via stepGate is `cancelled` (exit 0), not
  `failed` + exit 1. Replay start returns `{ ok: true, status: 'cancelled' }`.
- **L37a-sync:** After `resolveSttModelDir()`, `STT_MODEL_DIR` is published
  (default `userData/whisper`) so accept/status/fallback and the STT
  engine share one model directory.
- **L7-231:** Replay next/stop IPC returns a structured error instead of
  an unhandled rejection.
- **A30a:** Assisted apply requires a resolved `sessionDir`. Missing dir
  with apply enabled is `missing-session-dir` (not a silent skip, not
  apply-without-sessionDir).
- **I30a:** `ensureWhisperCli` SHA-256-checks the extracted whisper-cli
  after size validation and before chmod/success. Fail closed on
  mismatch or missing pin. Pins documented next to
  `STT_WHISPER_CLI_SHA256` (S4a-style env override; unpackaged Node).
- **C31a:** `closeElectron` SIGKILL remains timeout-only (L7-191). Other
  `close()` rejections rethrow without force-kill.
- **W31a:** `pickPreferredWhisperModel` does not fall back to large when
  `skipLarge` / prefer-small and small is missing (only-large stays
  unavailable).
- **R32b:** Replay-start IPC accepts/forwards `datasetPath` (not
  silently dropped). Preload + `#replay-dataset` wire it into
  `ReplayEngine` / `runScenario`.
- **L7-232:** Fill/select secret scrub preserves trailing array shape
  (`null` vacant slots; JSON args kept).
- **L7-233:** Session bundle IPC codes come from `SessionBundleError.bundleCode`.
- **L7-234:** Suivant re-enable is gated on `replayStepwiseActive`, not halt enabled.
- **L7-235:** Git timeout/SIGKILL is `timedOut` (exit 124), not exit 1.
- **L7-236:** Missing recorded step does not persist live fill args as `original`.
- **L7-237:** Default small model download is atomic + min-size.
- **L7-238:** Large-fallback marker errors are structured (`LargeFallbackError`).
- **L7-239:** `chooseWhisperModel` does not return a non-existent `largePath`.
- **L7-240:** IPC contract documents `datasetPath` on replay-start.
- **L7-241:** Health load uses the migrated payload after validate ok.
- **L7-242:** Health migrate does not rewrite current-schema `runIds`.
- **L7-243:** `resolveScenarioPath` absolutizes `repo` before containment.
- **L7-244:** Existing whisper-cli / large skip requires SHA-256 match.
- **L7-245:** Model candidates must be regular files, not directories.
- **L7-246:** Missing recorded step still omits live fill args as `original`.
- **F23b:** `pickPreferredWhisperModel` / `resolveWhisperPaths` honour
  `large-fallback.json` so existence-only large preference cannot bypass
  F-39 fallback-to-small.
- **I26a:** Path pick treats non-corrupt marker I/O (`EACCES` / `EISDIR`)
  as no marker so `resolveWhisperPaths` can return paths/`undefined`
  instead of throwing. F16b factory fail-loud on unreadable/corrupt when
  large is selected is unchanged.
- **D27a:** Relative `--dataset` is resolved from `dirname(scenarioPath)`
  (generated script directory when the scenario path is absent), not
  `process.cwd()`. Breaking for cwd-relative `--dataset` when the
  scenario lives elsewhere; pass an absolute path or a scenario-relative
  one.
- **A27b:** Parameterize/apply keeps trailing fill/select `arguments`
  after `[0]`. Extract still strips the recorded dataset value (L7-070);
  apply replaces `[0]` only. D20a still fails for a vacant `[0]` without
  `--dataset`.
- **L27b:** `STT_WHISPER_TIMEOUT_MS` (default 8000) is the whisper-cli
  process timeout. `STT_MAX_LATENCY_MS` (default 2000) remains the
  first-use large→small budget. The two no longer share one env.

Pass-23 (L7-165 … L7-169) is in `CHANGELOG.md` (STT decide serialize +
refuse gate, distinct `runIds` membership, non-force restore, leftover
diff check, log failed publish restore). Pass-24 (L7-170 … L7-179):
inactive replay next/stop, leftover descriptor-only match, leftover
rev-parse restore, createPr/hasOpenPr catch, Windows symlink skip,
dataset dir from scenarioPath, F16b vs whisperAvailable, realpath
ENOENT-only, no large `existing[0]` under fallback, atomic small
fallback fetch. Pass-25 (L7-180 … L7-189): unique `runIds`, halt/status
IPC errors, restore starting ref on PR-prep refusal, unstage on restore,
sessionId match, in-process dest TOCTOU lock (X28a; no cross-process
lockfile), bundle manifest check, export
symlink refusal, no explicit large under fallback. Pass-26 (L7-190 …
L7-201): log STT bookkeeping failures, close timeout-only SIGKILL,
propagate replay stop, redact recovery `lastError`, EPERM not
already-exists, skip Content-Length with `content-encoding`, in-process
`createEngineFromEnv`, parameterized symlink errors, first-use persist
warn, reuse `largeOk`, trim `STT_MODEL_PATH`. **W26a:** overwrite-false
export vacates an empty dest before rename (Windows folder picker).
**C26a:** `--large` also ensures whisper-cli (same as a plain fetch).
**I26a:** unreadable marker I/O is no-marker on Whisper path pick;
corrupt still fail-louds; F16b factory fail-loud when large is selected.
Pass-27 (L7-202 … L7-209): narrow non-ff push detection, explicit
descriptor identity allow-list, halt keeps next disabled, STT decide
response type, `GH_PROMPT_DISABLED`, dest-lock same-promise cleanup,
export staging symlink re-check, aligned large-fallback marker dirs.
**D27a:** relative `--dataset` from `dirname(scenarioPath)`, not cwd
(breaking for cwd-relative paths). **A27b:** keep trailing fill/select
`arguments` through parameterize/apply. **L27b:** split
`STT_WHISPER_TIMEOUT_MS` (process) from `STT_MAX_LATENCY_MS` (first-use).
Pass-28 (L7-210 … L7-212): re-check dirty worktree before write/commit,
`consecutiveRuns` matches capped `runIds` window, looser hung-git
SIGKILL bound. **R28a:** `validateHealth` migrates missing `runIds`
before schema checks (H21a); raw schema still fail-closed (L7-128).
**G28b:** `detectDefaultBranch` is `origin/HEAD` or local/remote
`main`/`master` only (no checkout fallback). **P28b:** patch redaction
scrubs known secrets by value even without `parameterRef`. **S28b:**
`resolveScenarioPath` fails when the path resolves outside `--repo`.
**X28a:** `withDestLock` is single-process (in-memory Map); no
cross-process lockfile. **F28b:** first-use latency hook follows any
selected large model, not only `join(modelDir, STT_LARGE…)`. **W28b:**
whisper-cli extract is zip-aware for `cliAsset()` `.zip` (Windows
Expand-Archive, not always `tar -xf`). Pass-29 (L7-213 … L7-222): leftover
recovery without `checkout -f`, migrated consecutiveRuns window,
whisperAvailable vs prefer-small, soft health lifecycle, configured
large skip, existing explicit large only, refuse special files,
consecutiveRuns max 32, skip duplicate large download, nested descriptor
canonicalize. Pass-30 (L7-223 … L7-225): git exec maxBuffer 32 MiB,
JSON-serializable trailing args, whisper-cli size check after extract.
Pass-31 (L7-226 … L7-229): recorded.json chmod-then-rename, non-ff
open-PR re-check before remote delete, min-length secret candidacy,
skip `--large` when valid large exists. **N29a:** vacant parameterized
`[0]` is JSON `null`. **D29a:** explicit `parameterRef` is not
unique-ified against selector-derived names (R10a last-write-wins).
**O29b:** export refuses a file dest even with overwrite. Pass-32
(L7-230 … L7-231): health/artifacts redact live args; **L36a-scrub**
writes recorded/redacted args to patch-branch `scenario.json`; replay
next/stop IPC try/catch. **A30a:** assisted apply requires
sessionDir (structured `missing-session-dir` refusal). **I30a:**
whisper-cli download SHA-256 after extract, before chmod (fail closed).
**C31a:** closeElectron SIGKILL timeout-only. **W31a:** skipLarge does
not fall back to large when small is missing. **R32b:** replay-start
forwards `datasetPath` for parameterized in-app replay. Pass-33
(L7-232 … L7-239): preserve redact array shape; structured session-bundle
IPC codes; Suivant gated on stepwise-active; git timeout ≠ exit 1;
no live fill original on miss; atomic default small download;
structured large-fallback errors; `chooseWhisperModel` existence-checks
large. Pass-34 (L7-240 … L7-246): document replay-start `datasetPath`;
health validate returns migrated payload; migrate only missing-runIds
legacy; resolve repo absolute before containment; SHA-256 before skip
existing cli/large; model candidates must be regular files; L7-236
original still omits live fill args. Pass-36 (L7-247 … L7-262): reject
null replay-start; catch in-process STT init; single step-gate waiter;
restore cwd; fail-loud source markers; skip FIFO without mkfifo;
hung-git timeout above 15s; keep non-string scrub heads; vacant trailing
slots; per-run dataset-load artifacts; combined recovery secrets;
structured bundle errors; refuse existing dest unless overwrite; owned
backup recovery only; regular-file model paths; ensure CLI before large
download. **D34a** locked (Darwin skips Unix `whisper-cli` ensure).
**L36a-scrub** locked (patch-branch `scenario.json` is recorded/redacted,
not live secrets). **L36b-bound** locked (`SECRET_NAME` token boundaries;
`#shipping_address` / `#spinner` are not `pin`). **L36c-cancelled** locked
(user stop is `cancelled`, not `failed` + exit 1). Pass-37 (L7-263 …
L7-270): verified large skip before accept short-circuit; voice-edit
offer only on newly-proposed and not while decide in flight; no
`git branch -D` while restore failed; keep assisted-apply success when
post-apply `saveHealth` fails; win32 recorded.json restore tmp after dest
rm; regular-file model selection; v1.9.2 ubuntu/Windows CLI URLs;
before-vs-after recovery secret coverage. **L37a-sync** locked
(accept/status/fallback and the STT engine share one `STT_MODEL_DIR`
after `resolveSttModelDir`). D34a + L36a/b/c stay locked. Pass-38
(L7-271 … L7-278): hash-read inside download try/catch; leftover
descriptor-only compare clones before mutate; `git diff -z`;
detectDefaultBranch fail-closed on hard git; L7-177 slice ends at
`isMissingPathError`; L7-230 timeout ×2; forward healthWriteError
without flipping apply ok; ggml-small min 10MB. **L38a-cap** locked
(flush = parsed whisper timeout + 2s so flush ≥ whisper timeout;
`STT_WHISPER_TIMEOUT_MS=40000` stays 40s / flush 42s). D34a +
L36a/b/c + L37a-sync stay locked. Pass-39 (L7-279 … L7-283): chrome
wait + close/kill timeout budget; `realpathExisting` rethrows
non-missing errors; L7-064 symlink target is invalid meta; pre-apply
health I/O is `healthWriteError` not apply `internal-error`; atomic
download size-check before rename. Ask-user **CLEAR**. Held: none.
