# Lot 7 changelog (v1.1)

- Assisted patch apply (F-62–F-65, ADR-0008): `health.json` candidates,
  `PATCH_ASSISTED_APPLY` (default false), dedicated git branch + draft PR
  against `--repo`. Verification/structure stay proposal-only (CA-14).
- Optional STT precision upgrade (F-38, F-39, ADR-0017): contextual
  `large-v3-turbo` proposal after N transcript edits; `small` remains the
  fallback.
- Session export/import of an autonomous folder (F-47).
- In-app pas-à-pas replay with Suivant / Arrêter and chat follow (F-59).
- Scenario parameterization: fill/select values become `--dataset`
  variables; distinct datasets replay the same scenario (F-48).

## Pass-1 adversarial fixes (L7-001 … L7-008)

- **L7-001:** F-63 confirmation counts distinct ordered `runIds`; same
  `runId` is a no-op; an intervening run without a descriptor patch for
  that step invalidates the candidate.
- **L7-002:** `prPrepared` is true only when a PR was actually prepared
  (`preparePr` or successful `gh pr create`). Push/`gh` failure is
  local-only (`ok: true`, `prPrepared: false`), not a fake prepared PR.
- **L7-003:** Assisted apply replaces the action descriptor with the
  confirmed suggestion (plus required `type`); stale optional fields are
  not preserved.
- **L7-004:** In-app pas-à-pas queues `next()` / `stop()` issued before
  the step gate; stop wins.
- **L7-005:** Large STT model streams to a `.partial` file, size/digest
  checked, then atomic rename.
- **L7-006:** STT upgrade banner stays visible when download fails.
- **L7-007:** Import rejects `.` / `..` session ids and verifies dest is
  inside `sessionsRoot` before `rm`.
- **L7-008:** First-use latency persistence cannot fail transcription.

## Pass-2 adversarial fixes (L7-009 … L7-016) + P2a

- **P2a:** When a `--dataset` is provided, missing `parameterRef` keys fail
  fast. There is no silent fallback to the captured descriptor value
  (including secrets). An empty string that is present in the dataset
  remains valid.
- **L7-009:** Assisted apply follows symlinks for `--repo`, the scenario
  file, and its parent; a worktree-relative path that resolves outside
  the repo is refused.
- **L7-010:** Corrupt or unreadable `health.json` throws. Only a missing
  file (ENOENT) starts empty healthy counters. The corrupt file is not
  deleted or replaced.
- **L7-011:** `preparePr` throwing still returns `ok: true` with
  `prPrepared: false` after the branch commit. Health increment on that
  path is superseded by **H5b** (increment only when `prPrepared`).
- **L7-012:** If mutation/commit fails after `checkout -b`, HEAD is
  restored to the starting branch (`git checkout -f`).
- **L7-013:** Session import refuses when dest is the source (or either
  path contains the other) before `rm(dest)`.
- **L7-014:** Relative `--dataset` from a generated script resolves via
  `scriptDir` through `launchPlaywrightRun`.
- **L7-015:** STT model download rejects a non-2xx `Response` before
  streaming.
- **L7-016:** Large→small fallback requires a real `ggml-small-q5_1.bin`;
  large weights are never used as the small engine.

## Pass-3 adversarial fixes (L7-017 … L7-020) + W3a + F3a

- **L7-017:** `stt-upgrade.json` load treats ENOENT as empty defaults.
  Corrupt JSON, unreadable files, or missing `refusedPermanently` throw;
  a permanent refuse is not reset.
- **L7-018:** Large STT download uses a bounded `AbortSignal` timeout and
  surfaces `ok: false` (`error: timeout` when aborted) to the renderer.
- **L7-019:** Assisted apply persists the recorded scenario object, not
  the dataset-materialized copy (secrets stay out of `scenario.json` / PR).
- **L7-020:** Session export refuses dest-inside-source overlap and copies
  via a temp directory so re-export does not keep stale files.
- **W3a:** `scripts/fetch-whisper.mjs --large` downloads through
  `downloadResponseToFileAtomic` (size floor + atomic rename).
- **F3a:** Engine resolution uses `readLargeFallback` and honours
  `fallback: false` in `large-fallback.json`; marker file presence alone
  does not force small forever.

## Pass-4 adversarial fixes (L7-021 … L7-031)

- **L7-021:** Idle `ReplayEngine.stop()` / `next()` are no-ops when no
  run is in progress, so leftover `pendingStop` cannot abort the next
  pas-à-pas replay at step 0. `running` is set before the first await so
  L7-004 queued next/stop still works.
- **L7-022:** Voice-edit still records the transcript; STT upgrade
  `recordCorrection` is wrapped so store failures cannot fail the IPC.
- **L7-023:** `sttUpgradeStatus` returns a safe default object when the
  store cannot load (`fallback: false` unchanged).
- **L7-024:** `ensureSttUpgradeStore` caches the in-flight load promise
  so concurrent IPC cannot discard `correctionCount`.
- **L7-025:** Checkout / `checkout -b` failures (including branch already
  exists) return `code: 'git-error'` and restore `startingBranch`. Commit
  failures still throw (L7-012).
- **L7-026:** `gh pr create` uses a 120s `execFile` timeout and
  `SIGKILL` so a hung `gh` cannot block after commit.
- **L7-027:** The STT upgrade accept button is disabled and shows
  “Téléchargement en cours…” while the large download runs.
- **L7-028:** A successful run with no suggested patch still records
  through `processSuggestedPatch`, which invalidates F-63 candidates so
  two matching recoveries separated by a clean run cannot promote.
- **L7-029:** `loadHealth` used to return empty counters when `health.json`
  `sessionId` did not match. **L7-050** replaces that with a throw.
- **L7-030:** Session export and import replace dest by renaming it
  aside, then publishing the staging directory; dest is restored if
  publish fails.
- **L7-031:** `isDefaultBranchName` folds `DEFAULT_BRANCH_NAMES` (optional
  detected default included); assisted apply no longer casts the branch
  name.

## Pass-5 adversarial fixes (L7-032 … L7-043) + Captain locks

- **E4a:** F-47 session export/import uses main-process
  `dialog.showOpenDialog` (directory). The renderer no longer calls
  `window.prompt` and does not send a typed path string.
- **S4a:** `STT_LARGE_SHA256` is pinned next to `STT_LARGE_MODEL_URL`
  (`39422170…ffa7e2`). Default large download is integrity-checked; a
  non-empty `STT_LARGE_SHA256` env still overrides.
- **R4a:** Duplicate **explicit** `parameterRef` values stay shared
  dataset variables. Only selector-derived names are uniquified
  (`email` / `email_2`).
- **M4a:** An explicit `STT_MODEL_PATH` whose file exists is honoured
  even when the filename is not `ggml-small` / `ggml-large`. L7-016 still
  refuses to use large weights as the small fallback engine.
- **U4a:** `sttUpgradeStatus.fallback` is `readLargeFallback(modelDir)`,
  not hardcoded `false`.
- **L7-032:** `sttUpgradeDecide` wraps store load / `refusePermanently`
  and returns `{ ok: false, error: 'store-unavailable' }`.
- **L7-033 / L7-034:** Accept and refuse IPC rejections `.catch` so the
  banner does not stay on “Téléchargement en cours…”.
- **L7-035:** `parseReplayStartPayload` no longer reads unused
  `datasetPath` (renderer does not expose it).
- **L7-036:** Non-absolute assisted-apply `scenarioPath` resolves against
  `repoRoot` before realpath containment.
- **L7-037:** AI recovery context uses the recorded/redacted scenario,
  not the dataset-materialized copy (secrets stay out of the LLM
  payload).
- **L7-038:** `suggested-patch` originals come from the recorded
  scenario with parameterized `arguments` stripped.
- **L7-039:** Session import refuses bundles that contain symlinks.
- **L7-040:** Each replace uses a unique `.spyglass-prev-*` backup;
  an orphaned backup is restored if dest is missing.
- **L7-041:** STT downloads stream to a unique `dest.partial-*` file.
- **L7-042:** `readLargeFallback` treats ENOENT as `false`; corrupt or
  unreadable `large-fallback.json` throws.
- **L7-043:** `firstUseNoted` is set only after a successful
  fallback-marker hook; transcription still cannot fail (L7-008).

## Pass-6 adversarial fixes (L7-044 … L7-052) + Captain locks

- **A5b:** `createInProcessStt` is synchronous (`InProcessStt`, not
  `Promise<InProcessStt>`). Whisper without a provided engine throws and
  points at `createInProcessSttFromEnv`, which awaits `createEngineFromEnv`
  then wraps via the sync factory. VoiceBridge uses the async API.
- **H5b:** Fragility counters increment only when `prPrepared` is true.
  Local commit with a failed/missing PR still returns `ok: true`
  (`prPrepared: false`) and does **not** increment `appliedPatches`
  (overrides L7-011 health-on-local-commit).
- **P6a:** An existing `STT_MODEL_PATH` that is not the conventional
  small/large file inside `STT_MODEL_DIR` is honoured over directory
  discovery when not in large-model fallback (explicit large/custom in
  another directory still wins even if `MODEL_DIR` has small). F3a still
  prefers large when fallback is false and the explicit path is the
  conventional small. L7-016 still requires `ggml-small-q5_1.bin` when
  fallback is set and the explicit basename is large.
- **C6a:** `scripts/capture-lot-7.mjs` screenshots are labelled
  **illustrative fixtures** in PR-NOTES / DEMO (not live app/repo
  capture). The capture script is unchanged this lot.
- **L7-044:** IPC contract documents F-47 export/import as main-process
  `dialog.showOpenDialog` with `{}` invoke (E4a).
- **L7-045:** `parsePathPayload` is removed; renderer no longer sends a
  typed dest/bundle path.
- **L7-046:** Export directory picker allows `createDirectory`; import
  does not (existing directory only).
- **L7-047:** STT upgrade banner restores the default copy HTML on
  download failure/`catch` (banner stays visible, L7-006).
- **L7-048:** After checking out the default branch from a non-default
  start, assisted apply reloads `scenario.json` from disk and patches
  that object. Load failure restores `startingBranch` (`internal-error`).
- **L7-049:** `confirmedDescriptor` is clone-only (no `type` rewrite).
  A suggested type that does not match the scenario step is refused
  (`type-mismatch`) after `checkout -b`, restoring the start branch.
- **L7-050:** `loadHealth` throws on `health.json` `sessionId` mismatch
  (no silent `emptyHealth` / overwrite). L7-029 empty-reset is replaced.
- **L7-051:** `replaceDirectory` sets `published` after a successful
  staging rename; backup `rm` is `.catch`; rollback runs only when
  `backedUp && !published`.
- **L7-052:** `AssistedApplyRefusal.code` includes `internal-error` and
  `type-mismatch`. `processSuggestedPatch` maps thrown apply failures
  with `isGitApplyError` vs `internal-error`.

## Pass-7 adversarial fixes (L7-053 … L7-059) + Captain locks

- **O7a:** Export refuses a non-empty existing destination unless
  `overwrite: true` is passed. The in-app F-47 picker never sets that
  flag, so a user-picked folder is not silently replaced.
- **I7a:** Import refuses when `sessionsRoot/<sessionId>` already exists.
  The existing session is not replaced or destroyed.
- **L7-053:** `sttUpgradeDecide` wraps `mkdir` / fake-write / download in
  try/catch and returns `{ ok: false, error }` (never throws to IPC).
- **L7-054:** Shared `resolveSttModelDir()` for the three userData/whisper
  defaults in main.
- **L7-055:** Accept success restores `sttUpgradeCopy` default HTML before
  hiding; `onOffer` also restores so a later banner is not stuck on
  “Téléchargement en cours…”.
- **L7-056:** `resolveScenarioInRepo` / `realpathExisting` catch parent
  `realpath` failure and return a structured `scenario-outside-repo`
  refusal instead of an unhandled throw.
- **L7-057:** Non-2xx downloads `cancel()` the response body before
  throwing.
- **L7-058:** Orphaned `.spyglass-prev-*` recovery restores the newest
  backup by mtime, then removes the rest.
- **L7-059:** Whisper first-use latency hook is gated by an in-flight
  promise so concurrent finals cannot double-record.

## Pass-8 adversarial fixes (L7-060 … L7-064)

- **L7-060:** `stt-upgrade.json` persist is serialized and published via
  atomic temp+rename (`writeFileAtomic`) so concurrent voice-edits cannot
  lose writes or crash-corrupt JSON.
- **L7-061:** `sttUpgradeStatus` does not convert a `readLargeFallback`
  failure into a successful `fallback: false`. The snapshot is returned
  with `error: 'fallback-unreadable'`. Store-load failure still uses the
  L7-023 safe default.
- **L7-062:** Empty `--repo` / `--dataset` / `--session-dir` do not
  overwrite env fallbacks (e.g. `PATCH_TARGET_REPO`) after
  `resolveRunnerOptions`.
- **L7-063:** Orphan `.spyglass-prev-*` recovery runs **before** O7a/I7a
  dest checks, and no longer inside `replaceDirectory`. Recovered dest is
  preserved; export/import then refuse rather than destroy it.
- **L7-064:** Import scans for symlinks **before** reading `meta.json`,
  so a symlink meta cannot leak arbitrary local files.

AbortError / cancellation vs first-use latency remains unchanged
(ask-user).

## Pass-9 adversarial fixes (L7-066 … L7-073)

- **L7-066:** Restoring `startingBranch` with `checkout -f` no longer
  swallows failure. The error is logged and appended to the refusal
  reason (`also failed to restore …`).
- **L7-067:** After a refusal on a created `spyglass/patch-*` branch
  (type-mismatch / default-branch / apply catch), restore HEAD then
  best-effort `git branch -D` the dangling patch branch.
- **L7-068:** Drop dead post-`resolveRunnerOptions` re-assignments of
  `--repo` / `--dataset` / `--session-dir` (empty values already filtered).
- **L7-069:** `--repo` / `--dataset` / `--session-dir` reject a missing
  value when the next token is absent or starts with `-`.
- **L7-070:** `extractScenarioParameters` deletes `descriptor.arguments`
  when assigning `parameterRef` (secrets stay in the dataset only).
- **L7-071:** Example-dataset secret names also match otp / pin / cvv /
  apikey / api_key / ssn.
- **L7-072:** `lot7-*.test.ts` remove `mkdtemp` dirs in `afterEach`.
- **L7-073:** `chooseWhisperModel` final small fallback is
  `smallModelPath(modelDir)`, not the bare `ggml-small-q5_1.bin` filename.

Ask-user F8 (AbortError / first-use latency) remains unchanged.

## Pass-10 adversarial fixes (L7-074 … L7-075) + Captain locks F8a / B10b

- **L7-074:** Session export/import buttons are disabled for the duration of
  the IPC call (both buttons) so a double-click cannot start a second
  export or import.
- **L7-075:** `gitOk` / `gitOkOrThrow` throw tagged `GitApplyError`
  (`tag: spyglass.git-apply`). `processSuggestedPatch` classifies with
  `isGitApplyError` on that tag, not a stderr regex. Untagged throws
  stay `internal-error` (L7-052).
- **F8a:** Whisper `transcribe()` does not sample first-use latency and
  does not set `firstUseNoted` on AbortError or AbortSignal cancellation
  (F-39). Timeouts and other failures still sample.
- **B10b:** `ReplayEngine.start` loads the scenario first and calls
  `beginReplay()` only after a successful load. Invalid session / missing
  scenario does not begin+end a replay cycle. `running` is still set
  before the load await (L7-021 / L7-004).

## Pass-11 adversarial fixes (L7-076 … L7-082) + Captain lock R10a

- **L7-076:** `SttUpgradeStore` builds a disk candidate, writes it
  atomically, then assigns in-memory state. A failed write leaves
  `correctionCount` / `refusedPermanently` unchanged.
- **L7-077:** STT upgrade refuse hides the banner only when `result.ok`;
  otherwise the copy surfaces `result.error` (banner stays visible).
- **L7-078:** When `PATCH_ASSISTED_APPLY` is on and patches are present
  but `scenarioPath` is missing, `processSuggestedPatch` sets
  `assistedApply` to a `missing-scenario-path` refusal instead of a
  silent health-only return.
- **L7-079:** AI recovery redacts parameterized snapshot `text` as well
  as `values` (live field values and remaining descriptor arguments).
- **L7-080:** Missing or malformed `--dataset` (and P2a missing
  `parameterRef`) returns `exitCode: 1` with a structured
  `ExecutionReport` warning, not an unstructured throw.
- **L7-081:** Whisper `transcribe()` does not await `onFirstUseLatency`
  (fire-and-forget). A hanging hook cannot block finalize. F8a abort
  skip and L7-059 single-note still hold.
- **L7-082:** Flag values that start with `-` stay rejected (L7-069).
  Unusual paths need a relative prefix such as `./-secrets.json`.
- **R10a:** Shared explicit `parameterRef` last-write-wins on extract.
  Duplicate refs stay one dataset variable (R4a); a later step overwrites
  `dataset.values[name]`. There is no conflict warn/error.

Windows `lot7-patch` git tests use a 20s timeout and retry `rm` on
`EBUSY` (L7-012 restore after failed commit).

Ask-user still held: **S11** (screenshot skip/blur vs accept for
parameterRef recovery steps), **D11** (gitignore `recorded.json` vs
document plaintext-on-disk risk).

## Pass-12 adversarial fixes (L7-083 … L7-090)

- **L7-083:** STT upgrade accept surfaces `result.error` on `ok: false`,
  re-enables the button, and does not hide the banner (same as refuse).
- **L7-084:** If `spyglass/patch-*` already exists after a prior
  `ok: true` / `prPrepared: false` attempt, assisted apply checks out
  that branch and resumes PR preparation instead of failing
  `git checkout -b`. Invalid leftovers are deleted and recreated.
  H5b / P12 contract unchanged (`ok: true`, `prPrepared: false` on
  preparePr failure; health increments only when `prPrepared`).
- **L7-085:** Recovery redaction reads remaining / dataset arguments
  from the un-stripped executable scenario, not `scenarioForRecovery`
  (which had already deleted them).
- **L7-086:** `node scripts/fetch-whisper.mjs` no longer statically
  imports `.ts` modules. `--large` dynamically imports STT TypeScript.
- **L7-087:** `sttUpgradeDecide` foreign IPC is `forbidden`; invalid
  payload is `bad-request` (both `{ ok: false, error }`).
- **L7-088:** Session export/import IPC maps failures to stable codes
  (`dest-not-empty`, `session-exists`, `export-failed`, …) instead of
  raw `error.message` paths.
- **L7-089:** `extractScenarioParameters` dedupes `dataset.secrets`
  under shared R10a `parameterRef`.
- **L7-090:** Whisper `onFirstUseLatency` returns the
  `recordFirstUseLatency` promise so L7-008 isolation applies.

Ask-user still held: **S11**, **D11**, **P12** (whether PR-prep failure
should be `ok: false` vs `ok: true` + `prPrepared: false`).

## Captain lock S11a (parameterRef recovery screenshots)

- **S11a:** Fail and recover screenshot capture is skipped when the
  failing step or any scenario step has a `parameterRef`. Recovery
  context does not get `screenshotPath`; the step report has no
  `screenshotRef`. Non-parameterized steps still write screenshots.
  Blur is not used — skip is enough (no secret pixels on disk).

Ask-user still held: **D11** (gitignore `recorded.json` vs document
plaintext-on-disk risk), **P12** (PR-prep `ok: false` vs `ok: true` +
`prPrepared: false`).

## Pass-13 adversarial fixes (L7-091 … L7-098)

- **L7-091:** `closeElectron` clears and `unref`s the 12s `Promise.race`
  timer so a successful close does not keep the Playwright worker alive.
- **L7-092:** `sessionBundleIpcError` returns the fallback code when the
  rejection is null, undefined, or a non-object (does not throw inside
  the sanitizer).
- **L7-093:** `defaultGitExec` times out at 120s (same budget as
  `gh pr create`) so hung `git push` / credential prompts fail as
  `git-error` instead of hanging PATCH_ASSISTED_APPLY.
- **L7-094:** After a local `spyglass/patch-*` recreate, a non-fast-forward
  `git push -u` deletes the diverged remote branch and retries so PR prep
  can run. Product contract unchanged: push/`gh` failure stays `ok: true`
  + `prPrepared: false` (H5b / P12 held).
- **L7-095:** `parseDataset` rejects a missing, non-array, or non-string
  `secrets` field fail-closed (no silent filter).
- **L7-096:** Large→small fallback always loads `ggml-small-q5_1.bin`
  via `requireSmallModelFile`. Custom `STT_MODEL_PATH` is still honoured
  for the intended engine (M4a / P6a), not on the fallback branch.
- **L7-097:** Concurrent transcribe first-use: if the in-flight hook
  fails, the second call persists its own `latencyMs` instead of
  discarding the sample.
- **L7-098:** `STT_LARGE_SHA256` comment no longer claims an env
  override (S4a pinned constant).

Ask-user still held: **D11**, **P12**, **P13** (strip proposed-side
secret args in patches vs document residual).

## Captain lock D11a (recorded.json local-only secrets)

- **D11a:** `generated/datasets/recorded.json` (`GENERATED_DIR_NAME` /
  `datasets/recorded.json`) holds plaintext captured fill/select values,
  including secrets. The repo `.gitignore` lists
  `**/generated/datasets/recorded.json`. Each generated package also
  writes a `.gitignore` for `datasets/recorded.json`. Do not commit this
  file; `datasets/example.json` is the blanked template.

Ask-user still held: **P12** (PR-prep `ok: false` vs `ok: true` +
`prPrepared: false`), **P13** (strip proposed-side secret args in
patches vs document residual).

## Pass-14 adversarial fixes (L7-099 … L7-102)

- **L7-099:** If a leftover `spyglass/patch-*` branch does not already
  contain the confirmed patches and `git branch -D` fails after checkout
  of the default branch, restore `startingBranch` before returning
  `git-error` (do not leave HEAD on `main`/`master`).
- **L7-100:** Drop the dead `consecutiveRuns < confirmRuns` filter in
  `toApply` (already applied by `promotedCandidates()`).
- **L7-101:** Patch branch names hash the full `toApply` set
  (`patchSetHash`), not only `toApply[0].hash`.
- **L7-102:** Dataset `values` maps are null-prototype own properties so
  an explicit `parameterRef` of `__proto__` (or other prototype keys) is
  extracted, parsed, exemplified, and applied.

Ask-user still held: **P14** (remote force-delete vs gate on open PR).

## Captain lock P12a (PR-prep failure is ok:false)

- **P12a:** After a successful local patch commit, push / `gh pr create`
  / `preparePr` failure returns `{ ok: false, code: 'pr-prep-failed' }`
  (not `ok: true` + `prPrepared: false`). The `spyglass/patch-*` branch
  stays for L7-084 resume. Health is not incremented (H5b). Success
  still has `prPrepared: true`.

Ask-user still held: **P14** (remote force-delete vs gate on open PR).

## Captain lock P13a (strip proposed-side secret args)

- **P13a:** Fail-closed: parameterized fill/select `arguments` are
  stripped from proposed/`after` descriptors before `suggested-patch.json`
  and before F-63 health candidate hashes (same `parameterRef` condition
  as L7-038 originals). Dataset-materialized secrets never persist in
  patch artifacts. Recovery still overlays live dataset args to act.
  Non-parameterized fill args and navigate URLs are kept.

## Captain lock P14a (gate remote patch delete on no open PR)

- **P14a:** On non-fast-forward in `pushPatchBranch`, remote
  `spyglass/patch-*` delete+repush is allowed only when no open PR uses
  that head (`gh pr list --head --state open`, injectable `hasOpenPr`).
  An open PR (or `gh` unable to prove none) returns
  `{ ok: false, code: 'open-pr' }`, leaves the remote branch, keeps the
  local commit (P12a), and does not increment health (H5b). No open PR
  keeps L7-094 retry recoverability. The L7-094 unit test stubs `createPr`
  so Windows CI does not hang on live `gh pr create` after a mocked push.

Ask-user still held: none for P12–P14.

## Pass-15 adversarial fixes (L7-103 … L7-108)

- **L7-103:** After SIGKILL on the Electron close timeout, wait for process
  `exit` (2s grace) before returning so `rm(userData)` does not race a
  dying process (Windows EBUSY/EPERM).
- **L7-104:** `spyglass-run` resolves `--session-dir` to an absolute path
  after parse (same cwd-stable treatment as `--repo`).
- **L7-105:** Non-fast-forward remote delete failures surface git
  `--delete` stderr (or `git push origin --delete <branch> failed`).
- **L7-106:** P13a fail-closed: missing or ambiguous recorded-step lookup
  still strips fill/select `suggested.arguments` (and original args).
- **L7-107:** `runScenario` reuses the already-redacted `suggestedPatch`
  for `processSuggestedPatch` instead of rebuilding from raw patches.
- **L7-108:** First-use latency persist retries are capped (3) with
  backoff so a rejecting `onFirstUseLatency` does not rewrite on every
  finalize for the engine lifetime. Backoff starts after the **second**
  failed persist so a non-overlapping later finalize can still write its
  own sample (L7-097; Windows CI where the two finals often do not overlap).

## Pass-16 adversarial fixes (L7-109 … L7-116)

- **L7-109:** `pushPatchBranch` refusal reasons include trimmed git stderr
  for the initial `-u` push and the post-delete retry (same helper as
  `--delete`). Empty stderr falls back to `git <args> failed`.
- **L7-110:** `defaultHasOpenPr` / `tryGhPrCreate` log caught `gh` errors
  to stderr (`spyglass: gh pr list|create failed: …`) and stay fail-closed
  (treat as open PR / `{ ok: false }`).
- **L7-111:** `scenarioWithDataset` loads JSON through `loadDatasetFile`.
- **L7-112:** `skipParameterizedScreenshots` is
  `scenario.steps.some(hasParameterRef)` (the current step is always in
  `scenario.steps`).
- **L7-113:** Recovery DOM text redaction skips secrets shorter than 3
  characters so 1–2 char parameter values do not over-strip unrelated
  text. Selector values are still blanked.
- **L7-114:** `downloadResponseToFileAtomic` / `downloadUrlToFileAtomic`
  require callers to pass `minBytes`. Large-model sites pass
  `STT_LARGE_MIN_BYTES` (`fetch-whisper --large`, Electron upgrade IPC).
- **L7-115:** Duplicate identical L7-108 `it` block removed (already
  landed with the Windows L7-097 backoff lock).
- **L7-116:** Electron in-process STT uses `createInProcessSttFromEnv`;
  the sync `createInProcessStt` factory still refuses whisper without a
  provided engine (A5b). No runtime stragglers.

Ask-user still held: **B16** (stay on patch branch vs checkout back),
**F16** (fail-loud corrupt `large-fallback.json` always vs only when
large is in play).

## Pass-17 adversarial fixes (L7-117 … L7-125)

- **L7-117:** After SIGKILL, `waitForProcessExit` only short-circuits on
  a non-null `exitCode`. `ChildProcess.killed` is ignored (it means kill
  was *called*). Otherwise wait for `exit` or the 2s grace.
- **L7-118:** In-app replay `scenarioPath` is the file
  `loadFinalizedScenarioWithPath` actually loaded (generated scenario or
  finalized rev-N fallback), not always `generated/scenario.json`.
- **L7-119:** Assisted apply captures the starting commit SHA. Detached
  HEAD (`rev-parse --abbrev-ref` is `HEAD`) restores that SHA on failure
  instead of `git checkout -f HEAD` after switching to the default branch.
- **L7-120 … L7-122:** Lot 7 patch tests assert git timeout/stderr, `gh`
  fail-closed logging via a stderr sink, and the generated patch-branch
  name for a multi-step `toApply` set — no source greps of git-repo /
  assisted-apply.
- **L7-123:** Recovery / original descriptor / patch redaction look up
  the recorded step with `findStepByIndex` (`step.index` only).
- **L7-124:** Recovery DOM text redacts every materialized parameter
  value, including 1–2 character PIN/OTP, using token boundaries so
  `ab` does not strip `about`. Overrides L7-113 min-length skip.
- **L7-125:** Whisper model discovery prefers `ggml-large-v3-turbo-q5_0.bin`
  when small and large both exist under `SPYGLASS_STT_RESOURCES` / vendor.
  Explicit `STT_MODEL_PATH` still wins. F-39 small fallback stays in
  `createEngineFromEnv` / `chooseWhisperModel`.

Ask-user still held: **F16** (fail-loud corrupt `large-fallback.json` always vs only when
large is in play).

## Captain lock B16a (checkout back after assisted-apply success)

- **B16a:** After assisted-apply **success**, checkout the captured
  pre-apply starting ref (`StartingHead` name, or SHA when detached).
  Do not call `currentBranch()` after success (HEAD is the patch branch).
  Leave `spyglass/patch-*` locally (and pushed) for human review. P12a /
  P14a PR-prep failures still stay on the patch branch for resume
  (L7-084).

Ask-user still held: **F16**, **A17** (`createEngineFromEnv`
sync vs async API).

## Pass-18 adversarial fixes (L7-126 … L7-127)

- **L7-126:** `detectDefaultBranch` never returns literal `HEAD` or an
  empty name as the default. Origin/HEAD that resolves to `HEAD` is
  skipped; if local `main`/`master` are also missing, assisted apply
  refuses with `code: 'unresolved-default'` instead of using `HEAD` as
  `--base` or a checkout target.
- **L7-127:** While `onFirstUseLatency` is in-flight (including a hang),
  further `finalize`s keep at most one queued sample instead of
  accumulating a detached `noteFirstUse` awaiter per call. The in-flight
  persist drains that sample (L7-097 overlap retry). `FIRST_USE_RETRY_LIMIT`
  and L7-108 backoff stay.

Ask-user still held: **A17**, **E18** (FAKE/SHA256 packaged
guard), **M18** (`STT_MODEL_FILE` vs large preference), **W18** (`--large`
ensure small vs incremental).

## Captain lock F16b (corrupt large-fallback only when large selected)

- **F16b:** Fail-loud on corrupt/unreadable `large-fallback.json` only when
  large could actually be selected (large weights present, not
  `STT_LARGE_FALLBACK=1`, not a custom `STT_MODEL_PATH`). Small-only
  engine creation ignores a stray corrupt marker. `readLargeFallback`
  itself still throws (L7-042). `sttUpgradeStatus` still surfaces
  `fallback-unreadable` (L7-061).

Ask-user still held: **A17**, **E18**, **M18**, **W18**.

## Pass-19 adversarial fixes (L7-128 … L7-133)

- **L7-128:** `health.schema.json` `patchCandidates[]` items require `runIds`
  (F-63 / L7-001). Valid fixtures include it; a missing-`runIds` fixture is
  invalid.
- **L7-129:** After assisted-apply PR prep, a failed `restoreStartingBranch`
  is `ok: false` / `code: 'restore-failed'` (B16a). Health is not
  incremented. The patch branch stays checked out.
- **L7-130:** `gh pr list --json` that is not an array (object, string,
  null) is treated as unknown/open so P14a will not delete the remote.
- **L7-131:** Parameterized recovery fails closed when `findStepByIndex` is
  undefined (duplicate/missing index) instead of acting with empty
  redacted args. Unique live dataset args are still overlaid.
- **L7-132:** `createEngineFromEnv` compares `STT_MODEL_PATH` / selected
  model to conventional small/large via `path.resolve` so `dir/./file`
  still engages large-fallback and first-use latency.
- **L7-133:** `resolveSttModelDir` returns trimmed `STT_MODEL_DIR`.

Ask-user still held: **A17**, **E18**, **M18**, **W18**, **R19**
(values-map scrub strategy).

## Pass-20 adversarial fixes (L7-134 … L7-141)

- **L7-134:** After deleting a leftover `spyglass/patch-*` and force-checkout
  to `defaultBranch`, reload `scenario.json` from disk before type-mismatch /
  commit. Do not keep `input.scenario` from the leftover branch (even when
  apply started on the default branch).
- **L7-135:** `stt-upgrade-refuse` is disabled while `decide('refuse')` is in
  flight (same pattern as accept).
- **L7-136:** `incrementAppliedPatches` adds `applied.size` (deduped step
  indexes), not `appliedStepIndexes.length`.
- **L7-137:** `writeGeneratedDatasets` creates `datasets/` as `0o700` and
  `recorded.json` as `0o600` (D11a plaintext secrets).
- **L7-138:** `skipParameterizedScreenshots(executable)` is computed once
  above the per-step loop.
- **L7-140:** `writeLargeFallback` publishes via `writeFileAtomic` (temp +
  rename), not in-place truncate.
- **L7-141:** `scripts/capture-lot-7.mjs` calls `driver.screenshot({ path })`.

Ask-user still held: **A17**, **E18**, **M18**, **W18**, **R19**, **D20**
(fail-fast missing dataset vs silent empty).

## Pass-21 adversarial fixes (L7-142 … L7-157)

- **L7-142:** `closeElectron` attaches a no-op `.catch(() => {})` to
  `electronApp.close()` before `Promise.race`, so a late reject after
  timeout+SIGKILL is not an unhandled rejection.
- **L7-143:** `sttUpgradeStatus` returns `error: 'store-unavailable'` when
  `ensureSttUpgradeStore()` fails (same explicit style as
  `fallback-unreadable`).
- **L7-144:** Pre-mutation git probes in `applyAssistedPatches` map thrown
  failures to structured `ok:false` `git-error` / `internal-error` /
  `unresolved-default`.
- **L7-145:** `Suivant` / `replayNext` is disabled while a next request is
  in flight.
- **L7-146:** Session export/import promise chains catch errors into
  `replayStatus` (finally still re-enables).
- **L7-147:** Accept and refuse STT upgrade buttons are both disabled while
  either decision is pending.
- **L7-148:** Stored candidate `runIds` are capped at last 32;
  `consecutiveRuns` stays the uncapped streak.
- **L7-149:** `saveHealth` publishes via temp + rename.
- **L7-151:** `redactSnapshotForRecovery` also redacts parameterized secrets
  from `snapshot.url` and `snapshot.title`.
- **L7-152:** After writing `recorded.json`, `chmod` `datasets/` to `0o700`
  and the file to `0o600` even when they already existed with broader modes.
- **L7-153:** Empty patch sets reset F-63 candidates only on successful
  runs; failed/stopped empty runs leave existing candidates.
- **L7-154:** Export unlinks staged `spyglass-session.json` (no-follow)
  before write so a source symlink cannot redirect outside staging.
- **L7-155:** `fetch-whisper.mjs --large` checks `response.ok` before
  `downloadResponseToFileAtomic`.
- **L7-156:** `whisperCandidateModels` uses `STT_LARGE_MODEL_FILE` instead
  of hardcoding the large basename.
- **L7-157:** `readLargeFallback` returns `fallback` after the boolean
  guard.

Windows `verify`: skip POSIX `chmod` on `datasets/` (L7-152); give
generated `scenario.ts` exec tests a timeout above `execFile`; wait for
the second STT first-use persist before asserting L7-108 backoff; stub
`createPr` on L7-134 leftover-recreate.

Ask-user still held: **A17**, **E18**, **M18**, **W18**, **R19**, **D20**,
**H21**.

## Pass-22 adversarial fixes (L7-158 … L7-164)

- **L7-158:** `waitForProcessExit` still waits the SIGKILL grace timeout when
  `child.once` is missing (does not resolve immediately).
- **L7-159:** After restore, write/stage/commit failures in
  `applyAssistedPatches` return structured `git-error` / `internal-error`
  instead of rethrowing.
- **L7-160:** L7-093 exercises a controllably blocking child with the same
  timeout/`SIGKILL` spawn options and asserts it terminates.
- **L7-161:** `redactSnapshotForRecovery` redacts parameterized secrets from
  every `snapshot.values` entry, not only the recorded selector key.
- **L7-162:** `PATCH_*` thresholds parse as complete trimmed positive
  integers only (`1e9`, `2junk` fall back).
- **L7-163:** Session-bundle rollback does not `rm(dest)` after a failed
  publish rename (avoids deleting a concurrent dest).
- **L7-164:** First-use STT latency uses `performance.now()`.

Ask-user still held: **A17**, **E18**, **M18**, **W18**, **R19**, **D20**,
**H21**.

## Captain lock A17b (sync createEngineFromEnv + named async factory)

- **A17b:** `createEngineFromEnv` is synchronous (`SttEngine`, not
  `Promise<SttEngine>`). Whisper reads `large-fallback.json` with sync I/O
  so F16b / F3a / L7-016 stay on the sync path. Async engine creation is
  `createEngineFromEnvAsync` (awaits `readLargeFallback`). Sidecar and
  `createInProcessSttFromEnv` use the async factory. Sync mock/whisper
  callers keep `createEngineFromEnv`. Aligns with A5b (sync factory +
  separately named async API).

Ask-user still held: **E18**, **M18**, **W18**, **R19**, **D20**, **H21**.

## Captain lock E18a (no packaged FAKE / SHA256 env escapes)

- **E18a:** `SPYGLASS_STT_UPGRADE_FAKE` and env `STT_LARGE_SHA256` are
  honoured only when unpackaged or `NODE_ENV=test`. Packaged production
  builds always download the real large model and verify the pinned
  `STT_LARGE_SHA256` digest (S4a). Unpackaged/test still skip the ~575 Mo
  fetch via FAKE.

Ask-user still held: **M18**, **W18**, **R19**, **D20**, **H21**.

## Captain lock M18a (STT_MODEL_FILE before large basename)

- **M18a:** When `STT_MODEL_FILE` (or `STT_MODEL`) names a file that exists,
  that match is chosen before L7-125 large-basename discovery. A missing
  configured file still falls through to large. Explicit `STT_MODEL_PATH`
  remains first (M4a / P6a). Unset configured file keeps L7-125 large
  preference.

Ask-user still held: **W18**, **R19**, **D20**, **H21**.

## Captain lock W18a (--large ensures small F-39 fallback)

- **W18a:** `scripts/fetch-whisper.mjs --large` ensures `ggml-small-q5_1.bin`
  is on disk before returning (download if missing, skip if present). A
  clean `--large` run still leaves F-39 small fallback available. Large
  still uses `downloadResponseToFileAtomic` (W3a / L7-155).

Ask-user still held: **R19**, **D20**, **H21**.

## Captain lock R19a (fail-closed snapshot.values redaction)

- **R19a:** `redactSnapshotForRecovery` blanks every `snapshot.values` entry
  on parameterized runs (L7-161 aligned). Recovery does not keep live field
  values under a different selector key. Text/url/title still redact known
  parameter/secret tokens (L7-079 / L7-124 / L7-151).

Ask-user still held: **D20**, **H21**.

## Captain lock D20a (parameterRef without dataset fails fast)

- **D20a:** A step with `parameterRef` and no resolved fill/select value
  fails fast even without `--dataset` (same `dataset is missing
  parameterRef` as P2a). Recorded parameterized scenarios cannot silently
  replay empty args. An empty string that is present in the dataset remains
  valid (P2a).

Ask-user still held: **H21**.

## Captain lock H21a (migrate missing health runIds on load)

- **H21a:** `loadHealth` migrates pre-Lot-7 `patchCandidates` that omit
  usable `runIds`, defaulting from existing non-empty string items or
  `lastRunId`. `schemaVersion` stays **1** (no bump). Load does not
  rewrite `health.json`. `validateHealth` still requires `runIds`
  (L7-128); upgraded sessions no longer hard-fail solely for a missing
  array. `consecutiveRuns` is not used to invent extra IDs.

Ask-user still held: none for these captain locks.

## Pass-23 adversarial fixes (L7-165 … L7-169)

- **L7-165:** `sttUpgradeDecide` reject `accept` when `refusedPermanently`
  is set. Accept/refuse IPC is serialized so a concurrent accept cannot
  start a large download after refuse.
- **L7-166:** `recordSuggestedPatches` treats any `suggested.runId` already
  in `runIds` as a no-op (not only equality with last). A→B→A cannot
  inflate `consecutiveRuns`.
- **L7-167:** `restoreStartingBranch` uses non-force `git checkout` after
  restoring only this op’s dirty `scenario.json`. Tracked edits to other
  files (e.g. during a long push/PR wait) are not discarded with
  `checkout -f`.
- **L7-168:** Reuse of an existing patch branch (`skipMutate`) requires the
  branch to be a descendant of default and `default...HEAD` to contain
  only the scenario file; otherwise the leftover is deleted and recreated.
- **L7-169:** If restore-after-failed-publish itself fails, log the stuck
  orphan and still throw the original publish error.

Ask-user still held: **F23** (`pickPreferredWhisperModel` fallback-awareness).

## Captain lock F23b (Whisper path pick honours large-fallback.json)

- **F23b:** `pickPreferredWhisperModel` / `resolveWhisperPaths` skip
  L7-125 existence-only large preference when `large-fallback.json` is
  true (or `STT_LARGE_FALLBACK=1`). Permanent F-39 fallback-to-small
  cannot be bypassed by callers that only look at which weight files
  exist. `STT_MODEL_PATH` and an existing `STT_MODEL_FILE` match stay
  first (M4a / P6a / M18a).

Ask-user still held: none for these captain locks.

## Pass-24 adversarial fixes (L7-170 … L7-179)

- **L7-170:** `replayNext` / `replayStop` return `{ ok: false, error:
  'inactive' }` when no `ReplayEngine` is bound, not a silent `{ ok: true }`.
- **L7-171:** Leftover `skipMutate` reconstructs `scenario.json` from
  default and requires an action.descriptor-only diff (plus apply
  `patchHistory`). Extra verification/structure edits force recreate.
- **L7-172:** Resumed-branch `rev-parse HEAD` failures restore the
  starting ref and return `git-error` instead of throwing on the patch
  branch.
- **L7-173:** Injected `createPr` / `hasOpenPr` rejections are caught like
  `preparePr` and return `pr-prep-failed` with branch/commit metadata.
- **L7-174:** Symlink escape tests skip on Windows `EPERM`/`EACCES` instead
  of failing the suite.
- **L7-175:** Relative `--dataset` resolves from `dirname(scenarioPath)`
  when `scriptDir` is absent, then cwd.
- **L7-176:** `whisperAvailable` is existence-only so auto-select cannot
  swallow a corrupt `large-fallback.json` into mock. Engine factory still
  fail-loud when large is in play (F16b), including resources-only dirs.
- **L7-177:** Session-bundle `realpathExisting` only falls back to
  `resolve(path)` on ENOENT/ENOTDIR; permission errors still throw.
- **L7-178:** Permanent large-fallback with no small model returns
  undefined from `pickPreferredWhisperModel` (no `existing[0]` onto large).
- **L7-179:** `fetch-whisper.mjs` `ensureSmallFallback` validates size/file
  (not truncated files or dirs) and downloads through
  `downloadResponseToFileAtomic`.

Ask-user still held: none for these captain locks.

## Pass-25 adversarial fixes (L7-180 … L7-189)

- **L7-180:** `health.schema.json` `runIds` has `uniqueItems: true` so
  contract validation matches distinct-runIds (L7-001).
- **L7-181:** Renderer `replayStop` / halt handles `{ ok: false }` and
  invoke rejections in `replayStatus`, same as next.
- **L7-182:** Initial `sttUpgrade.status()` rejection hides the offer and
  shows the same failure copy as decide.
- **L7-183:** After a local patch commit, `pr-prep-failed` / `open-pr`
  restore the starting ref (B16a) while keeping the patch branch for resume.
- **L7-184:** `restoreStartingBranch` `git reset HEAD --` allowed paths
  before checkout so a failed commit after `git add` does not leave
  `scenario.json` staged.
- **L7-185:** `recordSuggestedPatches` rejects a suggested `sessionId` that
  does not match `health.json`.
- **L7-186:** Session dest publish is serialized per path **in-process**
  (in-memory Map); overwrite-false uses a no-replace rename so a dest
  that appears after the availability check cannot be stolen in the same
  process. Cross-process races are not locked (X28a).
- **L7-187:** Import validates `spyglass-session.json` kind/schemaVersion
  and `sessionId` agreement with `meta.json` before copying.
- **L7-188:** Export refuses a source session that contains symlinks
  (round-trip with import).
- **L7-189:** Permanent large-fallback does not honour an explicit
  `STT_MODEL_PATH` that resolves to the large model. Custom non-large
  paths still win (M4a / P6a).

Ask-user still held: none for these captain locks.

## Pass-26 adversarial fixes (L7-190 … L7-201)

- **L7-190:** Voice-edit stays non-blocking (L7-022); STT upgrade
  bookkeeping failures are logged instead of discarded.
- **L7-191:** `closeElectron` force-kills only on the close timeout;
  other `close()` errors are rethrown after timer cleanup.
- **L7-192:** Replay cancellation is passed into `runScenario`;
  `pendingStop` is honoured before a successful return. Non-stepwise
  stop is applied at the next step boundary.
- **L7-194:** AI recovery redacts `lastError` with the same
  parameter-derived secret set used for snapshot text.
- **L7-195:** Overwrite-false publish maps only `EEXIST` / `ENOTEMPTY`
  (after re-checking dest) to "already exists"; `EPERM` is not aliased.
- **L7-196:** Content-Length vs written-bytes is skipped when
  `content-encoding` is present.
- **L7-197:** In-process non-whisper construction delegates to sync
  `createEngineFromEnv`.
- **L7-198:** `assertNoSymlinks` names export vs import in the error.
- **L7-199:** First-use latency persist emits a one-shot warning on the
  final failed attempt.
- **L7-200:** Large-model first-use hook uses `selection.largeOk`
  instead of a second `existsSync`.
- **L7-201:** `resolveSttModelDir` trims `STT_MODEL_PATH` before
  `dirname`.

Ask-user still held: W26, C26, I26 (not assumed).

## W26a captain lock

- **W26a:** Overwrite-false session export vacates an existing empty dest
  (Windows folder picker) then `rename`s staging onto it. Non-empty dest
  is still refused (O7a). Import does not vacate an empty dest (I7a).

Ask-user still held: C26, I26.

## Captain lock C26a (--large ensures whisper-cli)

- **C26a:** `scripts/fetch-whisper.mjs --large` also ensures/downloads
  `whisper-cli` (same helper as a plain fetch), not only the large/small
  models. A clean `--large` run leaves a usable CLI + models.

Ask-user still held: I26.

## Captain lock I26a (unreadable marker is no-marker on path pick)

- **I26a:** `preferSmallAfterLargeFallback` / `resolveWhisperPaths` treat
  non-corrupt marker I/O (`EACCES` / `EISDIR` / …) as no
  `large-fallback.json`, so path pick can return paths or `undefined`
  instead of throwing. Corrupt JSON still fail-louds. F16b still
  fail-louds on unreadable/corrupt when the engine factory would select
  large.

Local: `pnpm lint` 274 files, `pnpm typecheck` 6 packages, `pnpm test`
**661 passed**, 1 skipped (62 files). `upgrade.test.ts` 28.

Ask-user still held: none.

## Pass-27 adversarial fixes (L7-202 … L7-209)

- **L7-202:** `isNonFastForwardPush` only matches real non-fast-forward /
  tip-behind / `[rejected] (fetch first)` cases. Protected-branch,
  pre-receive, and shallow `[rejected]` lines do not take the remote
  delete-and-repush path.
- **L7-203:** Descriptor hashes use an explicit `ReplayDescriptor`
  identity allow-list covering every current type field; extras cannot
  silently change the hash, and a new type field fails typecheck.
- **L7-204:** Replay halt immediately disables next (and halt) and sets
  `replayHalted` so `next()`'s `finally` cannot re-enable past a halt.
- **L7-205:** `SttUpgradeDecideResponse` (`ok` / `error`) matches
  renderer consumption of `sttUpgrade.decide()`.
- **L7-206:** `gh` exec env sets `GH_PROMPT_DISABLED=1` (not `GH_PROMPT`).
- **L7-207:** `withDestLock` cleanup compares/deletes the same queued
  promise that was stored in the map.
- **L7-208:** Export re-checks `assertNoSymlinks` on staging after copy
  (import TOCTOU parity), parameterized as export.
- **L7-209:** Engine factory large-fallback marker dirs match F23b
  (`STT_MODEL_DIR` and `STT_MODEL_PATH` dirname) so those two cannot
  disagree when large fallback applies.

Local: `pnpm lint` 274 files, `pnpm typecheck` 6 packages, `pnpm test`
**669 passed**, 1 skipped (62 files). `lot7-patch.test.ts` 79,
`lot7-parameters.test.ts` 57, `upgrade.test.ts` 30.

Ask-user still held: D27, A27, L27 (not assumed).

## Captain lock D27a (relative --dataset from scenario dir)

- **D27a:** Relative `--dataset` resolves from `dirname(scenarioPath)`
  (generated `scriptDir` only when the scenario file path is absent),
  **not** `process.cwd()`. Absolute `--dataset` is unchanged. This is a
  **breaking change** for callers that passed a cwd-relative dataset
  path while the scenario file lived in another directory. Use an
  absolute path or a path relative to the scenario / generated script.

Local: `pnpm lint` 274 files, `pnpm typecheck` 6 packages, `pnpm test`
**672 passed**, 1 skipped (62 files). `lot7-parameters.test.ts` 59.

Ask-user still held: A27, L27.

## Captain lock A27b (preserve trailing fill/select arguments)

- **A27b:** `extractScenarioParameters` / `applyDataset` keep the full
  `arguments` array. Slot `[0]` is the dataset value (cleared on extract
  so L7-070 secrets stay out of generated `scenario.json`); trailing
  slots after `[0]` survive extract, JSON round-trip, and apply. D20a
  still fails when `[0]` is vacant (`undefined` or JSON `null`) even if
  trailing args remain. Replay still consumes `arguments[0]` only.

Local: `pnpm lint` 274 files, `pnpm typecheck` 6 packages, `pnpm test`
**677 passed**, 1 skipped (62 files). `lot7-parameters.test.ts` 62,
`lot7-patch.test.ts` 79, `patch-redact.test.ts` 12.

Ask-user still held: L27.

## Captain lock L27b (split STT timeout vs first-use latency)

- **L27b:** Dual-use of `STT_MAX_LATENCY_MS` is split. `STT_WHISPER_TIMEOUT_MS`
  (default 8000, `WHISPER_TIMEOUT_MS_DEFAULT`) is the whisper-cli process
  timeout in `beginWhisperFromEnv`. `STT_MAX_LATENCY_MS` (default 2000)
  remains the first-use large→small fallback budget (`parseMaxLatencyMs`).
  Setting one does not change the other. Existing `STT_MAX_LATENCY_MS`
  first-use setups keep working; process timeout uses 8000 unless
  `STT_WHISPER_TIMEOUT_MS` is set.

Local: `pnpm lint` 274 files, `pnpm typecheck` 6 packages, `pnpm test`
**678 passed**, 1 skipped (62 files). `upgrade.test.ts` 31.

## Pass-28 adversarial fixes (L7-210 … L7-212)

- **L7-210:** Assisted apply re-checks worktree cleanliness immediately
  before `writeFile` / commit so concurrent edits during checkout cannot
  be overwritten or committed unnoticed.
- **L7-211:** Capping `runIds` at 32 also sets `consecutiveRuns` to the
  retained window length, so an evicted then recycled `runId` cannot
  inflate the counter. Schema documents `maxItems: 32`.
- **L7-212:** Hung-git SIGKILL test drops the brittle ≥300ms wall-clock
  floor; kill + 15s upper bound remain.

Local: `pnpm lint` 274 files, `pnpm typecheck` 6 packages, `pnpm test`
**679 passed**, 1 skipped (62 files). `lot7-patch.test.ts` 80.

Ask-user still held: R28, G28, P28, S28, X28, F28, W28.

## Captain lock R28a (migrate-before-validate health runIds)

- **R28a:** Aligns H21a so `validateHealth` runs `migrateHealthPatchCandidates`
  before Ajv. Pre-Lot-7 candidates missing `runIds` default from existing
  non-empty string items, else `lastRunId`, and are not fail-closed for
  that omission. Raw `validateUnknown('health', …)` still requires `runIds`
  (L7-128 corpus). `schemaVersion` stays **1**. Load still does not rewrite
  `health.json`. Duplicate `runIds` still fail (L7-180); migrate does not
  unique them.

Local: `pnpm lint` 275 files, `pnpm typecheck` 6 packages, `pnpm test`
**680 passed**, 1 skipped (62 files). `validate.test.ts` 10, `lot7-patch.test.ts` 80.

Ask-user still held: G28, P28, S28, X28, F28, W28.

## Captain lock G28b (no checkout fallback for PR base)

- **G28b:** `detectDefaultBranch` uses `origin/HEAD` or local/remote
  `main`/`master` only. It does not fall back to the currently checked-out
  branch as the PR `--base`. When those refs are missing, assisted apply
  refuses with `code: 'unresolved-default'`. L7-126 (no literal `HEAD`)
  still holds.

Local: `pnpm lint` 275 files, `pnpm typecheck` 6 packages, `pnpm test`
**684 passed**, 1 skipped (62 files). `lot7-patch.test.ts` 84.

Ask-user still held: P28, S28, X28, F28, W28.

## Captain lock P28b (scrub known secrets by value)

- **P28b:** `redactSuggestedPatchEntryForPersistence` always scrubs known
  parameter/secret fill/select values **by value** (R19a fail-closed), not
  only when the recorded step is missing (L7-106) or has a `parameterRef`
  (P13a). Secret-named fields and live dataset args are stripped even when
  that step looks non-parameterized. Non-secret fills and navigate URLs
  stay. A27b trailing args remain unless they equal a known secret.

Local: `pnpm lint` 275 files, `pnpm typecheck` 6 packages, `pnpm test`
**688 passed**, 1 skipped (62 files). `patch-redact.test.ts` 16.

Ask-user still held: S28, X28, F28, W28.

## Captain lock S28b (scenarioPath must stay inside --repo)

- **S28b:** `resolveScenarioPath` fails when the scenario/script path
  resolves outside `policy.repo`. It does not assume the file lives under
  the target repo. Relative paths still resolve against the repo (L7-036),
  then containment is checked. Outside paths return structured
  `code: 'scenario-outside-repo'` from `processSuggestedPatch` (L7-009
  realpath symlink escape in apply still holds).

Local: `pnpm lint` 275 files, `pnpm typecheck` 6 packages, `pnpm test`
**694 passed**, 1 skipped (62 files). `lot7-patch.test.ts` 90.

Ask-user still held: X28, F28, W28.

## Captain lock X28a (withDestLock is single-process only)

- **X28a:** `withDestLock` stays an in-memory `Map` in this process
  (L7-186 / L7-207). Same-process concurrent import/export cannot clobber
  the same dest. There is **no** cross-process lockfile this lot; separate
  processes can still race. Do not read L7-186 as a machine-wide lock.

Local: `pnpm lint` 275 files, `pnpm typecheck` 6 packages, `pnpm test`
**695 passed**, 1 skipped (62 files). `lot7-parameters.test.ts` 63.

Ask-user still held: F28, W28.

## Captain lock F28b (first-use latency on any selected large)

- **F28b:** `finishWhisperFromEnv` attaches `onFirstUseLatency` (F-39
  large→small safety net) whenever the selected model basename is
  `STT_LARGE_MODEL_FILE`, not only when the path equals
  `join(modelDir, STT_LARGE…)`. `STT_MODEL_PATH` and other alternate
  large locations that still select large get the same first-use hook.

Local: `pnpm lint` 275 files, `pnpm typecheck` 6 packages, `pnpm test`
**697 passed**, 1 skipped (62 files). `upgrade.test.ts` 33.

Ask-user still held: W28.

## Captain lock W28b (zip-aware whisper-cli extract)

- **W28b:** `scripts/fetch-whisper.mjs` `extractArchive` follows the
  downloaded archive format. When `cliAsset()` yields a `.zip` (Windows,
  darwin), extract uses `Expand-Archive` on win32 (not always
  `tar -xf`). Linux `.tar.gz` still uses `tar`.

Local: `pnpm lint` 275 files, `pnpm typecheck` 6 packages, `pnpm test`
**698 passed**, 1 skipped (62 files). `download-model.test.ts` 17.

Ask-user still held: none.

## Pass-29 adversarial fixes (L7-213 … L7-222)

- **L7-213:** Leftover patch-branch recovery re-checks dirty and uses
  non-force `git checkout defaultBranch`. `checkout -f` no longer discards
  tracked edits made after the initial dirty probe.
- **L7-214:** R28a/H21a migration recomputes `consecutiveRuns` to the
  migrated `runIds` window so a legacy counter cannot auto-qualify from a
  single synthesized id.
- **L7-215:** `whisperAvailable` matches `pickPreferredWhisperModel`
  (only-large + prefer-small is unavailable). Corrupt marker still
  returns true so F16b fail-loud is not skipped (L7-176).
- **L7-216:** `runScenario` wraps `processSuggestedPatch` so health
  load/write failures cannot crash after report/suggested-patch exist
  (structured `internal-error`).
- **L7-217:** Configured `STT_MODEL_FILE` / `STT_MODEL` large basename
  honours `skipLargePath` (F-39 / F23b / F28b).
- **L7-218:** `needsLargeFallbackMarker` requires the explicit large
  `STT_MODEL_PATH` to exist (`explicitOk`).
- **L7-219:** `assertNoSymlinks` also refuses FIFO/socket/device files.
- **L7-220:** `consecutiveRuns` schema `maximum` is 32 (runIds window).
- **L7-221:** STT upgrade accept skips the ~575MB download when large is
  already present (queued duplicate accepts).
- **L7-222:** Descriptor hashes canonicalize nested objects/arrays with
  stable key order.

Local: `pnpm lint` 276 files, `pnpm typecheck` 6 packages, `pnpm test`
**705 passed**, 1 skipped (62 files).

Ask-user still held: N29, D29, O29.

## Pass-30 adversarial fixes (L7-223 … L7-225)

- **L7-223:** `gitChildExecOptions` uses `GIT_EXEC_MAX_BUFFER_BYTES`
  (32 MiB), above the former 2MB cap, so assisted-apply status/diff/log
  on larger repos is not truncated.
- **L7-224:** `trailingArguments` keeps JSON-serializable trailing
  values (not only strings) through parameterize/restore (A27b).
- **L7-225:** After extract+copy, `ensureWhisperCli` requires
  `existingCliOk` / `CLI_MIN_BYTES` before chmod/success.

Local: `pnpm lint` 276 files, `pnpm typecheck` 6 packages, `pnpm test`
**707 passed**, 1 skipped (62 files).

Ask-user still held: N29, D29, O29, A30, I30.

## Captain lock N29a (vacant [0] is JSON null)

- **N29a:** `unappliedArguments` keeps a vacant fill/select `[0]` as JSON
  `null` (not omitted, not `""`) so trailing indices stay. D20a still
  fails for unresolved `[0]`.

Local: `pnpm lint` 276 files, `pnpm typecheck` 6 packages, `pnpm test`
**708 passed**, 1 skipped (62 files). `lot7-parameters.test.ts` 66.

Ask-user still held: D29, O29, A30, I30.

## Captain lock D29a (explicit parameterRef is not unique-ified)

- **D29a:** Keep last-write-wins **R10a**. An explicit `parameterRef` is
  **not** unique-ified / de-duplicated against a selector-derived name
  already in `used`. `parameterNameFromStep` returns the trimmed explicit
  string as-is; `uniqueName` stays on the selector-derived path only
  (R4a `email` / `email_2`). Mixed collision: derived `email` then
  explicit `email` stays `email` (not `email_2`); the later recorded
  value wins on `dataset.values`. No unique-ify logic, conflict
  warn/error, or second name for the explicit step.

Local: `pnpm lint` 276 files, `pnpm typecheck` 6 packages, `pnpm test`
**709 passed**, 1 skipped (62 files). `lot7-parameters.test.ts` 67.

Ask-user still held: O29, A30, I30.

## Pass-31 adversarial fixes (L7-226 … L7-229)

- **L7-226:** `writeGeneratedDatasets` writes `recorded.json` to a temp
  file, `chmod 0o600`, then `rename` onto the dest so an existing
  world-readable file is never overwritten in place with secrets.
- **L7-227:** Non-fast-forward remote delete/repush re-checks `hasOpenPr`
  immediately before `git push origin --delete` (TOCTOU). Fail closed
  if a PR appeared after the first probe.
- **L7-228:** `collectParameterSecrets` requires
  `PARAMETER_SECRET_MIN_LENGTH` (2) so a single-char OTP digit is not a
  word-boundary redact secret.
- **L7-229:** `fetch-whisper.mjs --large` skips re-download when
  `existingLargeOk` (size ≥ `STT_LARGE_MIN_BYTES`), same as
  `existingCliOk` / `existingSmallOk`.

Local: `pnpm lint` 276 files, `pnpm typecheck` 6 packages, `pnpm test`
**713 passed**, 1 skipped (62 files).

Ask-user still held: O29, A30, I30, C31, W31.

## Captain lock O29b (refuse file dest on export even with overwrite)

- **O29b:** Session export refuses a non-directory destination even when
  `overwrite=true`. A file (or other non-dir) at dest is not renamed,
  moved, or deleted. Error: `export refused: destination is not a
  directory` (IPC `dest-not-directory`). Directory overwrite is
  unchanged (L7-020); W26a still vacates an empty directory for
  overwrite-false.

Local: `pnpm lint` 276 files, `pnpm typecheck` 6 packages, `pnpm test`
**714 passed**, 1 skipped (62 files). `lot7-parameters.test.ts` 70.

Ask-user still held: A30, I30, C31, W31.

## Pass-32 adversarial fixes (L7-230 … L7-231)

- **L7-230:** `processSuggestedPatch` records health from a
  persistence-redacted copy (P13a / P28b) but passes the live suggested
  patch to `applyAssistedPatches`. Apply matches F-63 hashes on the
  redacted descriptor and writes live args. `run.ts` keeps recovered
  descriptors live until lifecycle; disk `suggested-patch.json` stays
  scrubbed.
- **L7-231:** `IPC.replayNext` / `IPC.replayStop` wrap
  `activeReplay.next()` / `stop()` in try/catch and return
  `{ ok: false, error }` instead of an unhandled rejection.

Local: `pnpm lint` 276 files, `pnpm typecheck` 6 packages, `pnpm test`
**715 passed**, 1 skipped (62 files).

Ask-user still held: A30, I30, C31, W31, R32.

## Captain lock A30a (assisted apply requires sessionDir)

- **A30a:** Keep require-`sessionDir` for assisted apply. When
  `resolveSessionDir` is undefined and `PATCH_ASSISTED_APPLY` is on,
  `processSuggestedPatch` returns a structured `missing-session-dir`
  refusal (`assisted apply requires sessionDir`). It does not silently
  return `{}` and does not apply without a session directory. Health
  recording still needs a resolved sessionDir. Off-path without
  sessionDir remains `{}`.

Local: `pnpm lint` 276 files, `pnpm typecheck` 6 packages, `pnpm test`
**716 passed**, 1 skipped (62 files).

Ask-user still held: I30, C31, W31, R32.

## CI — macOS Electron e2e close hang

- Shared `closeElectron()` (timeout then `SIGKILL`) for every Electron e2e
  spec. Playwright `close()` waits for `app.quit()`; after a guest
  `target=_blank` redirect or `example.com` navigation that can hang until
  the 60s worker teardown (macOS `verify` only; Ubuntu/Windows were green).
- Popup click uses `noWaitAfter` so Playwright does not wait for a window
  the app denies. Locator `actionTimeout` is 15s so a hung click cannot
  consume the whole test budget.
- Windows: after close timeout, `taskkill /T /F` the Electron pid so
  renderer/GPU children cannot block worker teardown. Empty-shell
  `start.html` URL poll is 20s (same as later `example.com` poll).
- Windows L7-108: first-use persist backoff after two failures is 2s
  (`FIRST_USE_BACKOFF_MS`), long enough that a sequential third
  whisper-cli stub finalize stays inside the skip window.

