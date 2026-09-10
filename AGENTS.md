# AGENTS.md

## What this project does

Spyglass is a desktop app (Electron) that records a web scenario the user performs by hand
\- DOM events, voice narration - and turns it into a deterministic, replayable TypeScript
script, with bounded AI recovery when a step drifts. Everything runs locally: capture, STT
(whisper.cpp), replay. LLM calls are opt-in and expurgated (ADR-0015).

Scope is driven by `PRD.md` (French, normative) and `webdesign.md` (French, UI). Work is
organised in **lots** (-1 to 6); the current boundary is documented at the end of
`README.md`. Do not implement features of a future lot without asking.

**Out of scope:** Browserbase cloud (Stagehand runs LOCAL + CDP only), signed/notarized
installers, publishing packages to npm.

## Commands

```bash
make install    # corepack + pnpm install + doctor preflight
make check      # Biome (lint + format) + TypeScript per package
make test-unit  # vitest + ajv schema corpus + contracts coverage gate
make test-e2e   # Playwright against the built Electron app
make test       # check + test-unit + test-e2e (the gate before any PR)
make start      # build + launch the dev app detached, waits until really up
make status     # process, CDP endpoint, current log, build artefacts
make log        # follow the run log (make log N=200 for a plain tail)
make stop       # stop the app started by make start / make run
make package    # unsigned installer for the current OS
```

`make` targets are thin wrappers over `package.json` scripts (the single source of truth)
and add process supervision. Prefer them. `pnpm format` writes Biome fixes. There is
deliberately **no `make build`**: `pnpm start` and `pnpm package` build first.

On Linux, `pnpm fix:sandbox` (one-time `sudo`) is required after any `pnpm install` that
replaces the Electron binary. Never weaken the app sandbox to work around it.

## Architecture

pnpm monorepo, `packages/*`, all `private`, all ESM + TypeScript strict.

| Package               | Role                                                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@spyglass/app`       | Electron shell (two zones), capture session, observer chat, settings, Stagehand `observe`/`act`. `src/main`, `src/preload`, `src/renderer`, `src/shared`. |
| `@spyglass/contracts` | Types + ajv validation wired to `docs/contracts/schemas`                                                                                                  |
| `@spyglass/probe`     | Injected DOM probe: frames + open shadow, mask, denoise, replay descriptor                                                                                |
| `@spyglass/llm`       | Two-profile LLM gateway, gabarits, expurgation, token budget                                                                                              |
| `@spyglass/runner`    | Deterministic replay, generated `scenario.ts`, verification, bounded AI recovery, CLIs                                                                    |
| `@spyglass/stt`       | Local whisper.cpp STT sidecar (mock engine in CI)                                                                                                         |

Reference documents, in order of authority:

- `docs/contracts/` - **normative** JSON schemas, IPC channels, state machine, prompts.
- `docs/adr/` - 18 accepted ADRs; each one is binding until superseded.
- `README.md` - stack freeze, prerequisites, troubleshooting, lot boundary.
- `PRD.md`, `webdesign.md` - product and UI specs (French).

## Code conventions

- Biome 2 is the only formatter/linter: single quotes, semicolons, no trailing comma, 100
  columns, 2 spaces. Never hand-format; run `pnpm format`.
- Code, comments, commit messages and CI are **English**. Product specs stay French.
- Versions are **frozen for all of v1** (see the stack freeze table in `README.md`). Bump
  a dependency only for a security fix, and say so explicitly.
- Cross-package imports go through the package entry point (`@spyglass/x`), never a deep
  relative path into another package.
- The main process is the only trust boundary: renderer talks to it through the IPC
  channels declared in `packages/app/src/shared/ipc.ts` and `docs/contracts/ipc.md`.

## Tests

- Unit tests sit next to the code as `*.test.ts` and run under vitest (`vitest.config.ts`
  aggregates one project per package).
- E2E: `packages/app/e2e/*.spec.ts`, one spec per lot, Playwright driving the
  electron-vite `out/` build (never a `release/` artefact). Headless needs xvfb.
- Schema corpus: `docs/contracts/examples/` - a change to a schema must come with valid
  **and** invalid fixtures. `pnpm test:schemas` fails on valid-rejected/invalid-accepted.
- Coverage is blocking for `@spyglass/contracts` (and `@spyglass/llm`) only; there is no
  global repo threshold.

## Known pitfalls

- **CDP is opt-in when packaged**: enabled by `SPYGLASS_CDP=1`,
  `SPYGLASS_OBSERVE_ON_START=1`, or any unpackaged run. `--remote-allow-origins` must stay
  the **empty string**, never `*`.
- **`userData` differs by run mode**: `~/.config/@spyglass/app/` from a source checkout,
  `~/.config/Spyglass/` when packaged. `pnpm observe`/`act` only auto-discover the
  packaged path - pass `SPYGLASS_CDP_INFO` or `--cdp-url` from a checkout.
- `Rollup failed to resolve import "@spyglass/..."` means the workspace symlinks are
  stale: re-run `pnpm install` then `pnpm doctor`.
- The element descriptor format (ADR-0009) is the most expensive contract to evolve and is
  frozen since lot 1. Any breaking schema change bumps `schemaVersion` and ships a session
  converter.
- Replay of local descriptors must run **without** an LLM (`selfHeal: false`).
- The STT **mock engine emits canned transcripts**: it is only selected under
  CI/tests or an explicit `SPYGLASS_STT_ENGINE=mock`. Dictation needs
  `node scripts/fetch-whisper.mjs` (`vendor/whisper/`), otherwise it refuses to start.
- Stagehand runs with `keepAlive`: it must never close the Electron browser.

## Configuration

- `SPYGLASS_STT_ENGINE` (`whisper` | `mock`), `STT_BIN`, `STT_MODEL_PATH`, `STT_LANGUAGE`.
- `SPYGLASS_CDP`, `SPYGLASS_CDP_INFO`, `SPYGLASS_OBSERVE_ON_START`, `SPYGLASS_BIN`,
  `SPYGLASS_GUEST_PAGE`, `SPYGLASS_NO_SANDBOX` (dev-only), `SPYGLASS_DISABLE_GPU`,
  `SESSIONS_DIR`.
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` are optional: without a key, a local stub LLM
  keeps `observe` working offline and in CI.
- Runtime state lives in the git-ignored `.spyglass/` (pidfile, per-run logs); wiped by
  `make clean`.
