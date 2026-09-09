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
  `prPrepared: false` after the branch commit, and still increments
  health.
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
- **L7-029:** `loadHealth` returns empty counters when `health.json`
  `sessionId` does not match the current session (no cross-session
  `appliedPatches` / candidates).
- **L7-030:** Session export and import replace dest by renaming it
  aside, then publishing the staging directory; dest is restored if
  publish fails.
- **L7-031:** `isDefaultBranchName` folds `DEFAULT_BRANCH_NAMES` (optional
  detected default included); assisted apply no longer casts the branch
  name.
