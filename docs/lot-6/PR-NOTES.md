# Lot 6 evidence and PR notes

Do **not** open the pull request from this lot unless a human asks. This file
is the hand-off for a later PR. Parent runs adversarial review, then opens the
PR.

Branch: `cursor/lot-6-script-16c5`  
Base: `40824a1707e71525164fc201ec4285e2d7fbcd6c` (Lot 5 merged `main`)  
Task: `FM-spyglass-lot-6-20260909`

## Suggested PR title

```
feat(lot-6): generated thin script, --headless flags, replay-rate protocol
```

## Suggested PR body (paste)

Lot 6 (Script généré) only. Lots 0–5 (Electron security, capture, observer,
voice, refine, runner recovery) are unchanged. I-05 remains
`claude-sonnet-4-5-20250929`. No Lot 7 patch auto-apply / PR (F-62–F-65).

Finalize writes PRD §6.14 `generated/`: `scenario.json` (source of truth),
thin `scenario.ts` importing `@spyglass/runner` `runScenario`
(ADR-0006 / F-45), `README.md` mode d'emploi, `package.json` with a
**declared** `@spyglass/runner` dependency. The script runs **outside**
Electron. Visible by default; `--headless` and the rest of F-58
(`--base-url`, `--timeout`, `--max-ai-retries`, `--no-ai`, `--ai`,
`--report`, `--trace`) are forwarded. Relative `--report` is resolved
from the scenario file directory, not cwd (A19a). `--no-ai` / `CI=1`
constructs no LLM client (F-60).

Measurement protocol for PRD §2.2 non-contractual goals: corpus of 10
public sites + 10 local CI pages, J+1 replay, rates published under
`docs/lot-6/`. First numbers: local 10/10 and public J+0 10/10 `--no-ai`.
**J+1 public is N/A / pending** (due 2026-09-09; `--public --j1`). Not
claimed measured — do not invent a J+1 percentage. When `--j1` runs, Lot 6
**rebuilds from static `PUBLIC_CORPUS`**; it does not replay a persisted J+0
`scenario.json` (same-artifact replay is a residual).

### Exit criteria (PRD §11 Lot 6)

- [x] Script executed outside Spyglass, headed (visible) and `--headless`
- [x] Replay rates measured on the corpus and published
      **Caveat (J1c):** published rates are local 10/10 and public **J+0**
      10/10 `--no-ai`. **J+1 public is N/A / pending** (due 2026-09-09).
      Wall-clock ≥24 h numbers are deferred, **not claimed measured**.
      **Caveat (J8c):** Lot 6 `--j1` rebuilds from static `PUBLIC_CORPUS`;
      it does **not** replay a persisted J+0 `scenario.json`. Same-artifact
      replay is a residual.
      Run: `pnpm --filter @spyglass/runner exec node --experimental-transform-types src/corpus-cli.ts --public --j1 --out docs/lot-6/measured-rates.j1.json`

### How the exit demos were proven

`pnpm lint`, `pnpm typecheck`, `pnpm test` (**346 passed, 1 skipped**, 48
files), `pnpm test:schemas` (2 passed), and `pnpm test:e2e` (**16 passed**,
Lots 0–6) on this branch. CI uses the mock LLM transport (no live keys) for
`--no-ai`.

1. **Thin hybrid script.** Unit `writeGeneratedPackage` asserts
   `scenario.json` + `scenario.ts` importing `runScenario` + README
   flags + `package.json` dependency. Finalize (`RefineEngine`) writes
   `generated/`. In-app replay prefers `generated/scenario.json`.
2. **Headed + headless outside Electron.**
   `packages/runner/src/generated-run.test.ts` and
   `packages/app/e2e/lot6-script.spec.ts` run the same fixture scenario
   with `--no-ai` (no API keys). Subprocess:
   `node --experimental-transform-types scenario.ts --headless --no-ai`
   (Node 24 strip-only cannot emit TypeScript parameter properties).
3. **Corpus / protocol.** `docs/lot-6/protocol.md`, `corpus.json`,
   `MEASURED-RATES.md`. Local fixture 10/10; public J+0 10/10.
   **J+1 public: N/A / pending** (deferred wall-clock, not a measured rate).
   `--j1` rebuilds from static `PUBLIC_CORPUS`; it does not replay the J+0
   on-disk `scenario.json`.

### Screenshots

| File | What it shows |
| --- | --- |
| [`screenshots/generated-script-tree.png`](screenshots/generated-script-tree.png) | `generated/` tree (json/ts importing `runScenario`) |
| [`screenshots/headed-run.png`](screenshots/headed-run.png) | Visible fixture after generated-script click (`#done`) |
| [`screenshots/headless-run.png`](screenshots/headless-run.png) | `--headless --no-ai` exit 0, no keys, outside Electron |
| [`screenshots/corpus-protocol-snippet.png`](screenshots/corpus-protocol-snippet.png) | Protocol excerpt + J+0 published rates (`10/10`, JSON visible) |

## Product decisions (ask-user)

1. **F-45 vs CLI CI headless.** Generated `scenario.ts` is **headed unless
   `--headless`**, even when `CI=1`. `spyglass-run` still defaults headless
   in CI (Lot 5). AI recovery still defaults off in CI (F-60).
2. **Node transform-types.** v1 runner exports TypeScript source. Generated
   `package.json` scripts pass `--experimental-transform-types` so
   parameter properties in `@spyglass/runner` load. Ask: emit JS from the
   runner in a later lot vs keep the Node 24 flag.
3. **Replay source of truth.** After finalize, in-app Rejouer loads
   `generated/scenario.json` first, then `refined/rev-N.json` for older
   sessions. Lot 5 e2e mutates both when breaking a selector.
4. **w3.org marker.** Homepage `body` innerText did not contain “W3C”.
   That host uses `elementVisible` + exact `urlMatches` (`requireText:
   false`). Other corpus hosts still use `textPresent`.
5. **J+1.** First published wave is J+0 on 2026-09-08. True J+1 (≥24 h)
   is not in this lot’s wall-clock. Command is documented; parent can run
   `--public --j1` on 2026-09-09.
6. **A19a / L6-019.** Relative `--report` for `spyglass-run` (and the
   generated script via `scriptDir`) is **scenario-dir-relative**:
   `resolve(dirname(scenario.json), dir)`, not `process.cwd()`. Absolute
   `--report` is used as-is. Default remains `../runs/<runId>/` from that
   directory. Do **not** restore cwd-relative resolve.
7. **H29a / L6-029.** F-58 flag/help text lives in
   `packages/runner/src/help-text.ts`. `cli.ts`, `generated-run.ts`, and
   `run.ts` import it (no cycles). Do not duplicate the flag block. Relative
   `--report` wording stays scenario-dir (A19a).
8. **D35b / L6-035.** `createPlaywrightDriver` is **headed unless
   `headless === true`**. Visible first (F-45); `--headless` to hide.
   `spyglass-run` CI default headless (product note 1) is unchanged.
9. **R42a / L6-042.** Finalize `persistRevision` failure still calls
   `abortFinalizeAfterGenerate(..., persistReviewing: true)` with aggregated
   errors (R33a). Do not leave disk `finalized` vs memory `reviewing`
   without attempting the reviewing rollback persist.
10. **E43a / L6-043.** `packages/app/e2e/lot6-script.spec.ts` is CI-safe:
    headed only when a display is present and `CI` is unset; screenshot dir
    defaults to a temp path, not tracked `docs/lot-6/screenshots/`
    (`SPYGLASS_E2E_SCREENSHOT_DIR` override for capture).
11. **S44b / L6-044.** Omitting `driver` in `runScenario` launches a real
    standalone Playwright Chromium (generated script / CLI). In-app callers
    (`ReplayEngine`) must pass an explicit driver. Do not invert this.

## Adversarial pass 1 (auto-fix)

L6-001 and L6-002 landed on `6f3228bcb3842c750543f3107994a4cc250f7ec3`
(from `7438b3ddefdeb82a3bc9cb04c2de5512c91aa525`). **L6-003 J1c** is this
docs pass. Product decisions 1–5 above are unchanged.

- **L6-001** Finalize writes `generated/` while the revision is still
  `reviewing`, then persists `status: 'finalized'` and calls
  `finalizeScenario()`. A generate failure leaves disk + memory
  `reviewing`, orchestrator `reviewing`, and `canFinalize` true so
  re-finalize stays open. Persist / `finalizeScenario` failures after a
  successful generate roll the revision status back to `reviewing`.
- **L6-002** `--base-url` rewrites the origin of an absolute http(s)
  `startUrl` (optional non-root base path prefix, query/hash preserved).
  Relative `startUrl` still uses WHATWG resolution. `file:` start URLs are
  left unchanged. Generated README matches this behavior.
- **L6-003 J1c** `MEASURED-RATES.md` and this file publish J+1 public as
  **N/A / pending** (due 2026-09-09, `--public --j1`). The Lot 6 exit
  checklist item stays checked with the caveat that J+1 wall-clock numbers
  are deferred, not claimed measured. No invented J+1 percentage.

Unit tests after L6-001/002: **353 passed, 1 skipped**, 49 files
(`pnpm lint`, `pnpm typecheck`, `pnpm test`).

## Adversarial pass 2 (auto-fix)

Applied on tip `a79060d40f1f5b0bf71fa569e0aa806aecf3da92`. Product decisions
1–5 and J1c (J+1 public **N/A / pending**) are unchanged.

- **L6-004** Generate-first still writes `generated/` before persisting
  `finalized` (L6-001). If persist / `finalizeScenario` / raw-mutation fails
  after that write, `generated/` is deleted. `spyglass-generate` /
  `loadFinalizedScenarioForGenerate` no longer fall back to leftover
  `generated/scenario.json` when no finalized `rev-N.json` exists.

Unit tests after this pass: **356 passed, 1 skipped**, 49 files
(`pnpm lint`, `pnpm typecheck`, `pnpm test`).

## Adversarial pass 3 (auto-fix)

Applied on tip `2cb17b632aaf03378dc53971890c7c121f1f840f`. Product decisions
1–5 and J1c (J+1 public **N/A / pending**) are unchanged. L6-008 J+1
persist/replay semantics are unchanged (ask-user pending).

- **L6-005** `writeGeneratedPackage` and finalize `!generated.ok` always
  `discardGeneratedPackage` so a mid-write throw cannot leave a partial
  `generated/`.
- **L6-006** `corpus-cli --j1` defaults `--out` to
  `docs/lot-6/measured-rates.j1.json` and does not clobber canonical J+0
  `measured-rates.json`. J+0 / local-immutable default is unchanged.
- **L6-007** `measure-corpus` and `docs/lot-6/protocol.md` use
  `node --experimental-transform-types` (same form as PR-NOTES / MEASURED-RATES).
- **L6-009** `.gitignore` again lists `packages/app/playwright-report/` in
  addition to `docs/lot-6/corpus-runs/`.

Unit tests after this pass: **360 passed, 1 skipped**, 49 files
(`pnpm lint`, `pnpm typecheck`, `pnpm test`).

## Adversarial pass 3 follow-up (J8c)

Applied on tip `0fca1ff2358a9bd51e9afda1b22c7c936382196f`. Product decisions
1–5 and J1c (J+1 public **N/A / pending**) are unchanged. L6-005, L6-006,
L6-007, and L6-009 were already on that tip.

- **L6-008 J8c** Defer persist/reload of J+0 `scenario.json` for J+1.
  `protocol.md` / `MEASURED-RATES.md` / this file no longer claim that J+1
  replays the same on-disk artifact. Lot 6 `--j1` (when run) rebuilds from
  static `PUBLIC_CORPUS`. Same-artifact replay is a residual for later. No
  invented J+1 percentage.

## Adversarial pass 4 (auto-fix)

Applied on tip `6bb40bddd59285a5479ad7071364e6d6c45b2d0f`. Product decisions
1–5, J1c, and J8c are unchanged.

- **L6-010** `spyglass-generate` wraps `generateFromSessionDir` in try/catch
  (same pattern as `spyglass-run`): expected failures (e.g. no finalized
  revision) write stderr and exit 1; no unhandled rejection.
- **L6-011** Root README Lot 6 blurb records J1c (J+1 **N/A / pending**) and
  J8c (`--j1` rebuilds from `PUBLIC_CORPUS`, not a persisted J+0
  `scenario.json`).
- **L6-012** `--j1` without `--public` fails closed (exit 2, stderr:
  `--j1 requires --public`).

Unit tests after this pass: **362 passed, 1 skipped**, 49 files
(`pnpm lint`, `pnpm typecheck`, `pnpm test`).

## Adversarial pass 5 (auto-fix)

Applied on tip `aad8027192f4cd234aff9609fb2d9978e14c5511`. Product decisions
1–5, J1c, and J8c are unchanged.

- **L6-013** Local-immutable default `--out` is
  `docs/lot-6/measured-rates.local.json` and does not clobber canonical J+0
  `measured-rates.json`. J+0 public still defaults to `measured-rates.json`;
  J+1 still defaults to `measured-rates.j1.json`.
- **L6-014** `runCorpusCli` try/catch (fixture bind + `writeFile` + measure)
  writes stderr and exits 1. `isMain` `.catch` prevents an unhandled
  rejection.

Unit tests after this pass: **363 passed, 1 skipped**, 50 files
(`pnpm lint`, `pnpm typecheck`, `pnpm test`).

## Adversarial pass 6 (auto-fix)

Applied on tip `9be988d9ed1ad536ccf91a3cf5b63cdde5e650e4`. Product decisions
1–5, J1c, and J8c are unchanged.

- **L6-015** `scripts/capture-lot-6.mjs` tree HTML and headless footer label
  `runScenario` (ADR-0006). Regenerated
  `docs/lot-6/screenshots/generated-script-tree.png` and `headless-run.png`.

Unit tests after this pass: **364 passed, 1 skipped**, 50 files
(`pnpm lint`, `pnpm typecheck`, `pnpm test`).

## Adversarial pass 7 (auto-fix)

Applied on tip `0b482c9446e862df94f4a546d75463ed9c09fdff`. Product decisions
1–5, J1c, and J8c are unchanged.

- **L6-016** `corpus-protocol-snippet.png` is a **fullPage** capture with
  compact J+0 published rates JSON first (`replayWithoutAiRate` / 10/10
  site rows), not a viewport crop ending on a lone `{`.
- **L6-017** Capture unlinks `docs/lot-6/screenshots/{tree,headless,protocol}.html`
  after PNGs; `.gitignore` also ignores `docs/lot-6/screenshots/*.html`.

Unit tests after this pass: **365 passed, 1 skipped**, 50 files
(`pnpm lint`, `pnpm typecheck`, `pnpm test`).

## Adversarial pass 8 (auto-fix)

Applied on tip `3af1695cf6fedcb8bc049fab2f54a609f7e8e235`. Product decisions
1–5, J1c, and J8c are unchanged.

- **L6-018** `PlaywrightPageDriver.screenshot` uses Playwright `type: 'png'`
  when the output path ends in `.png` (JPEG + quality 80 remains for `.jpg`
  failure shots). Regenerated `docs/lot-6/screenshots/*.png` so magic bytes
  match the extension (was JFIF written as `.png`).

Unit tests after this pass: **368 passed, 1 skipped**, 50 files
(`pnpm lint`, `pnpm typecheck`, `pnpm test`).

## Adversarial pass 9 (auto-fix)

Applied on tip `674f6a2bed1a6bdb0b4582d6a35b87ebeffe7658`. Product decisions
1–5, J1c, and J8c are unchanged.

- **L6-020** `loadFinalizedScenario` only falls back to `refined/rev-N.json`
  when `generated/scenario.json` is missing (`ENOENT`). JSON / schema /
  other errors are rethrown so Rejouer fails closed on a corrupt generated
  artifact.
- **L6-021** `scripts/capture-lot-6.mjs` goto targets use
  `pathToFileURL(...).href` (Windows-safe) instead of `` file://${join(...)} ``.
- **L6-022** no-op (duplicate measured-rates files left as-is).
- **L6-019** not applied (`resolveReportDir` / relative `--report` remains
  ask-user pending).

Unit tests after this pass: **370 passed, 1 skipped**, 50 files
(`pnpm lint`, `pnpm typecheck`, `pnpm test`).

## Adversarial pass 10 (A19a docs)

Applied on tip `1dc825ace4879cf532a6a31adade12a66d735111`. Product decisions
1–5, J1c, J8c, and **A19a** are locked. `resolveReportDir` is unchanged
(scenario-dir-relative; not cwd-relative).

- **L6-019 / A19a** Documented relative `--report` as resolved from
  `dirname(<scenario.json>)` / generated `scriptDir` (CLI help, generated
  README, root README, this file). Do not restore cwd-relative resolve.

Unit tests after this pass: **371 passed, 1 skipped**, 50 files
(`pnpm lint`, `pnpm typecheck`, `pnpm test`).

## Adversarial pass 10 (L6-022)

Applied on tip `eee887c1d8c62f469a87ad795b3b83d442ec2519`. Product decisions
1–5, J1c, J8c, and A19a are unchanged.

- **L6-022** `loadFinalizedScenario` fallback sorts `rev-N.json` with
  `Number.parseInt(name.slice(4), 10)` (same as
  `loadFinalizedScenarioForGenerate`). `Number("1.json")` is `NaN`;
  `parseInt` yields `1`, so `rev-10` sorts after `rev-2`.

Unit tests after this pass: **372 passed, 1 skipped**, 50 files
(`pnpm lint`, `pnpm typecheck`, `pnpm test`).

## Adversarial pass 11 (auto-fix)

Applied on tip `4d07de3ffd83e08d4b6181211b261a1d7292e8e0`. Product decisions
1–5, J1c, J8c, and A19a are unchanged.

- **L6-023** Generated `scenario.ts` shebang is
  `#!/usr/bin/env -S node --experimental-transform-types` so `./scenario.ts`
  matches package scripts / README.
- **L6-024** `readSessionStartUrl` / `writeGeneratedFromRevision` rethrow
  non-ENOENT IO and JSON errors and throw if `startUrl` is missing. No
  `https://exemple.test/start` fallback in generated artifacts.
- **L6-025** Fixture `*.html` files are resolved under
  `resolve(RUNNER_FIXTURES_DIR)`; `..` traversal and escaped paths 404.

Unit tests after this pass: **376 passed, 1 skipped**, 51 files
(`pnpm lint`, `pnpm typecheck`, `pnpm test`).

## Adversarial pass 12 (auto-fix)

Applied on tip `921cc099874d27980b737925f4a9e85c28fdddf3`. Product decisions
1–5, J1c, J8c, and A19a are unchanged.

- **L6-026** Generated `scenario.ts` wraps `runScenario` in try/catch: stderr
  on throw, no exit JSON, `process.exit(1)` (no unhandled rejection).
- **L6-027** `scenario.ts` is written mode `0o755` (chmod after write) so
  `./scenario.ts` is executable on Unix.
- **L6-028** `spyglass-run` / `runGeneratedScript` no longer pass `--base-url`
  as `fallbackStartUrl`. Missing `startUrl` fails closed; staging rewrites
  stay in `applyBaseUrl` only.

Unit tests after this pass: **379 passed, 1 skipped**, 51 files
(`pnpm lint`, `pnpm typecheck`, `pnpm test`).

## Adversarial pass 13 (H29a)

Applied on tip `3fc72f440a90f5d48ad4d02665de919d2345d0d6`. Product decisions
1–5, J1c, J8c, A19a, and **H29a** are locked.

- **L6-029 / H29a** Shared `help-text.ts` for F-58 `--help` (`spyglass-run`,
  `generatedHelpText`, `runScenario --help`). Behavior unchanged.
- **L6-030** no-op (JPEG quality left as-is).

Unit tests after this pass: **381 passed, 1 skipped**, 52 files
(`pnpm lint`, `pnpm typecheck`, `pnpm test`).

## Adversarial pass 14 (auto-fix)

Applied on tip `07d6c51174727d3bbcab338b612f3268f1aa1aff`. Product decisions
1–5, J1c, J8c, A19a, and H29a are unchanged.

- **L6-031** Generated `scenario.ts` short-circuits `--help` / `-h` like
  `runGeneratedScript`: prints help and `process.exit(0)` before writing
  `{exitCode,runDir}` JSON.
- **L6-032** `applyBaseUrl` ensures a trailing slash on the URL **pathname**,
  not by concatenating `/` onto a raw string that may include query/hash.

Unit tests after this pass: **383 passed, 1 skipped**, 52 files
(`pnpm lint`, `pnpm typecheck`, `pnpm test`).

## Adversarial pass 15 (ask-user locks)

Applied on tip `61af7e5e376c7d57fc6a4789d2cc00f79d606ef2`. Product decisions
1–5, J1c, J8c, A19a, H29a, and **D35b** are locked.

- **L6-033 / R33a** `abortFinalizeAfterGenerate` aggregates
  `persistRevision` rollback failures with the original finalize error
  (no empty catch).
- **L6-034 / O34a** corpus `--out` must resolve under `repoRoot()`; paths
  that escape throw (no `/tmp` overwrite).
- **L6-035 / D35b** `createPlaywrightDriver` headed unless `headless === true`.
- **L6-036 / C36a** Explicit `executablePath` / `channel` /
  `SPYGLASS_CHROME_PATH` / `SPYGLASS_CHROME_CHANNEL` fail-fast; failed
  attempts are written to stderr.
- **L6-037 / F37a** `@spyglass/runner` keeps public `startFixtureServer` /
  `FixtureServer` re-exports.

Unit tests after this pass: **388 passed, 1 skipped**, 52 files
(`pnpm lint`, `pnpm typecheck`, `pnpm test`).

## Adversarial pass 15 (Copilot auto-fix)

Applied on tip `ddffb3cd462ea03854da8ff65af0f61b9c765829`. Product decisions
1–5, J1c, J8c, A19a, H29a, D35b, and O34a are unchanged.

- **L6-038** `measureCorpus` aggregates step `mode` across **all** steps
  (`corpusWaveMode`): `script` only when every step is `script`; otherwise
  `AI` (or `none` if there are no steps). `ok` / `replayWithoutAiRate` count
  a site only when exit 0 **and** all steps are `script`.
- **L6-039** `generate-cli` main entry `.catch` writes stderr and `process.exit(1)`
  on unhandled rejection (same as `corpus-cli` / L6-014).
- **L6-040** `corpus-cli` `mkdir(dirname(out), { recursive: true })` before
  `writeFile` so nested `--out` under the repo jail does not ENOENT.
- **L6-041** Generated `scenario.ts` uses the local `argv` constant for
  `--headless` (same as `--help`), not a fresh `process.argv.includes`.

Unit tests after this pass: **392 passed, 1 skipped**, 53 files
(`pnpm lint`, `pnpm typecheck`, `pnpm test`).

## Adversarial pass 15 (Captain locks)

Applied on tip `0e9063d9116e9e8f9a3f2428c2ebe16b9c5d5559`. Product decisions
1–8, J1c, J8c, A19a, H29a, D35b, O34a, C36a, F37a, and R33a are unchanged.
Locks **R42a**, **E43a**, and **S44b** (product notes 9–11).

- **L6-042 / R42a** Finalize: if persisting `status: 'finalized'` throws,
  still `abortFinalizeAfterGenerate` with `persistReviewing: true` and
  aggregated persist errors (same R33a combine). Memory + attempted disk
  rollback stay `reviewing`.
- **L6-043 / E43a** Lot 6 e2e: headed only with `DISPLAY` and not `CI`;
  proof screenshots go to temp (or `SPYGLASS_E2E_SCREENSHOT_DIR`), not
  tracked `docs/lot-6/screenshots/` by default.
- **L6-044 / S44b** Keep optional-driver → standalone Chromium in
  `runScenario`. Documented in JSDoc, root README, generated README, and
  this file. In-app `ReplayEngine` still passes `driver: this.deps.driver()`.

Unit tests after this pass: **395 passed, 1 skipped**, 53 files
(`pnpm lint`, `pnpm typecheck`, `pnpm test`). Lot 6 e2e spec passed
(headed+headless with `DISPLAY=:1`; shots in temp, not tracked evidence).

## Adversarial pass 16 (Copilot auto-fix)

Applied on tip `b50083d15eed9fafd81a095c2b7c889b34eae63d`. Product decisions
1–11, J1c, J8c, A19a, H29a, D35b, O34a, C36a, F37a, R33a, R42a, E43a, and
S44b are unchanged. Chromium `--no-sandbox` / CI coupling is unchanged
(ask-user pending).

- **L6-045** `resolveCorpusOutPath` runs inside `runCorpusCli`'s try so O34a
  jail errors are stderr + exit 1 (L6-014), not a raw throw.
- **L6-046** Unparsable `--base-url` throws (`invalid --base-url`); do not
  silently keep production `startUrl`.
- **L6-047** O34a jail `realpath`s the deepest existing ancestor so a
  symlink inside the repo that points outside cannot bypass `isInsideDir`.
- **L6-048** `corpusWaveMode`: undefined/absent step modes are `'none'`, not
  `'AI'`.
- **L6-049** `--out` as last token or missing value exits 2 (`--out requires a
  path`); does not fall back to the default measured-rates file.
- **L6-050** Lot 6 e2e `rm`s mkdtemp session/screenshot dirs in `finally`;
  `headedSafe` treats any non-empty `CI` as CI.
- **L6-051** `spyglass-generate` missing-arg usage writes stderr (not stdout)
  on exit 2. `--help` still uses stdout.

Unit tests after this pass: **400 passed, 1 skipped**, 53 files
(`pnpm lint`, `pnpm typecheck`, `pnpm test`). Lot 6 e2e spec passed;
mkdtemp session/screenshot dirs are removed in `finally`.

## Residuals

- Lot 7 auto-apply / PR (F-62–F-65) is out of scope.
- `@spyglass/runner` is not published to npm yet; outside the monorepo the
  generated README uses `file:` / future registry.
- No live smart bake-off; I-05 remains `claude-sonnet-4-5-20250929`.
- J+1 same-artifact persist/reload of the J+0 on-disk `scenario.json` (J8c
  residual; Lot 6 `--j1` rebuilds from static `PUBLIC_CORPUS`).
