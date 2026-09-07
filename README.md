# Spyglass

AI-assisted web scenario recorder (Stagehand). This repository is a **pnpm
monorepo**. Lot **-1** froze the toolchain. Lot **0** ships the **two-zone
Electron shell**, a real `WebContentsView` for browsing, and **Stagehand
attached over CDP** to that displayed view.

French product specs stay in [`PRD.md`](PRD.md) and [`webdesign.md`](webdesign.md).
Implementation and CI comments are English.

## Stack freeze (Lot -1, 2026-09-07)

Versions are **locked for all of v1**. Bump only for a security fix (PRD §16.1).
Chromium in Electron is part of the capture/CDP contract: do not float majors
mid-v1.

| Pin | Version | Where |
| --- | --- | --- |
| Node.js | **24.20.0** (Active LTS “Krypton” at Lot -1 start) | `.nvmrc`, `.node-version`, `engines.node` |
| Electron | **44.2.0** (stable current at Lot -1 start; Chromium 152 / Node 24.20.0) | `packages/app` |
| pnpm | **10.33.3** | `packageManager`, `engines.pnpm` |
| TypeScript | **5.9.3**, `strict`, `noImplicitAny` | `tsconfig.base.json` |
| Lint/format | **Biome 2.5.12** (single tool, all five packages) | `biome.json` |
| Unit tests | **vitest 5** | workspace |
| E2E | **@playwright/test** on the Electron app | `packages/app/e2e` |
| Schemas | **ajv** 2020-12 over `docs/contracts/examples` | `@spyglass/contracts` |
| Dev build | **electron-vite 5** | `@spyglass/app` |
| Distribution | **electron-builder 26** | `packages/app/electron-builder.yml` |
| Stagehand | **@browserbasehq/stagehand 3.7.3** (LOCAL + CDP, no Browserbase) | `@spyglass/app` **dependency** (packaged Observe) |

## npm scope

Package names use **`@spyglass/*`**. Packages are `private` in this lot;
publishing to the public registry is not part of Lot 0. Register the
`@spyglass` org on npmjs before Lot 5 if the runner will be published.

## Packages

| Package | Role |
| --- | --- |
| `@spyglass/app` | Two-zone Electron shell, `WebContentsView`, typed nav IPC, CDP endpoint |
| `@spyglass/runner` | Library scaffold only — `runScenario` is Lot 5 |
| `@spyglass/probe` | Injected probe scaffold only — capture is Lot 1 |
| `@spyglass/contracts` | Types + ajv validation wired to `docs/contracts/schemas` |
| `@spyglass/stt` | Sidecar scaffold only — whisper.cpp binary is a later lot |

## Prerequisites

- Node **24.20.0** exactly (`nvm use` / `fnm use`; `engine-strict=true`)
- pnpm **10.33.3** (`corepack enable` then `corepack prepare pnpm@10.33.3 --activate`)

```bash
corepack enable
corepack prepare pnpm@10.33.3 --activate
pnpm install
```

## Commands

```bash
pnpm lint              # Biome check (lint + format)
pnpm format            # Biome --write
pnpm typecheck         # TypeScript per package
pnpm test              # vitest unit tests (all packages)
pnpm test:schemas      # ajv corpus; fails on valid-rejected / invalid-accepted
pnpm test:coverage     # contracts only — the only blocking coverage threshold
pnpm dev               # electron-vite dev (two-zone shell)
pnpm build             # production build of packages that compile
pnpm start             # preview the built Electron app
pnpm test:e2e          # Playwright smoke against the built Electron app
pnpm package           # electron-builder for the current OS (unsigned)
pnpm observe           # Stagehand observe() against the running app's CDP port
```

Platform-specific packagers:

```bash
pnpm --filter @spyglass/app package:linux   # AppImage + deb (+ unpacked dir)
pnpm --filter @spyglass/app package:mac     # dmg arm64 + x64
pnpm --filter @spyglass/app package:win     # NSIS
```

Installers are **unsigned** and **not notarized** for internal v1. See
[`docs/UNSIGNED-DISTRIBUTION.md`](docs/UNSIGNED-DISTRIBUTION.md).

## Lot 0 — verify Stagehand `observe`

Chromium **remote debugging (CDP)** is **opt-in when packaged**. It is enabled
when any of these is true:

- `SPYGLASS_CDP=1`
- Observe-on-start: `SPYGLASS_OBSERVE_ON_START=1`
- Dev / unpackaged: `pnpm dev` (`ELECTRON_RENDERER_URL`), `pnpm start`, and e2e
  (not an electron-builder artifact)

`SPYGLASS_CDP=0` forces it off even in unpackaged runs. Packaged installers do
**not** pass `remote-debugging-port` / `remote-allow-origins` unless a flag
above is set. `remote-allow-origins=*` is applied only together with the debug
port.

In-app Observe is bundled in the installer (`scripts/stagehand-observe.mjs` plus
`@browserbasehq/stagehand`, `playwright-core`, and `zod`, with production
`node_modules` asarUnpacked). A packaged build still needs CDP on:

```bash
SPYGLASS_CDP=1 /path/to/Spyglass
```

Linux: `pnpm test:packaged-observe` smokes `release/linux-unpacked`.

From a source checkout:

1. `pnpm start` (or `pnpm dev`)
2. Type a URL in the address bar (for example `https://example.com`) and press Enter
3. Confirm back / forward / reload
4. In the right pane, click **Observe page**, **or** from another terminal:

```bash
pnpm observe
# equivalent:
# node packages/app/scripts/stagehand-observe.mjs --cdp-url http://127.0.0.1:<port>
```

The CDP URL and guest target are written to `userData/cdp.json` (also
`SPYGLASS_CDP_INFO` when set). The chat pane prints the endpoint.

- With `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`, observe uses that model.
- Without a key, a **local stub LLM** still runs `stagehand.observe()` over CDP
  so Lot 0 can be proven offline / in CI.

`keepAlive` is set so Stagehand must **not** close the Electron browser.

## Schema fixtures

- Schemas: [`docs/contracts/schemas/`](docs/contracts/schemas/)
- Corpus: [`docs/contracts/examples/`](docs/contracts/examples/)
- IPC / state machine / prompts stay documentation (no conflicting schemas)

## Coverage policy (PRD §16.2)

A **blocking** coverage threshold applies to **`@spyglass/contracts` only**.
There is no global repo threshold. A future expurgation filter (PRD §6.9) will
share that same blocking policy when it exists (Lot 2) — it is not implemented
here.

## whisper.cpp licences

Verified at Lot -1 before any installer that could ship weights:
[`docs/LICENSES-whisper.md`](docs/LICENSES-whisper.md).

## Design assets

Path contracts from `webdesign.md`:

- `assets/brand/logo-diaphragm.svg` (6 blades)
- `assets/brand/logo-diaphragm-16.svg` (3 blades, under 20 px)
- `assets/brand/logo-diaphragm-rec.svg` (recording state)
- `assets/icons/16/*` and `assets/icons/24/*` (already in repo)
- Renderer tokens: `packages/app/src/renderer/styles/tokens.css`

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on **ubuntu-latest**,
**macos-latest**, and **windows-latest**: lint, typecheck, unit tests, schema
validation, contracts coverage, Electron smoke, and unsigned installer
artifacts for the OS that can produce them.

Playwright launches **bundled Electron** against the **electron-vite `out/`
build** (`packages/app`, `"main": "./out/main/index.js"`). It does not use
`release/` leftovers. Launching the final AppImage/dmg/NSIS inside CI is
deferred: GitHub-hosted runners often lack FUSE / Gatekeeper / installer GUI.
Installer files are still built and uploaded as artifacts.

## Lot boundary

Implemented (Lot 0): two-zone shell (F-01), URL bar + History API updates (F-02),
nav controls (F-03), popup redirect into the current view (F-04), loading
indicator (F-05), persisted `persist:spyglass-browser` partition (F-06),
disabled REC pill stub (F-07), Stagehand CDP attach + `observe` (ADR-0002 / I-01).

**Not** implemented: Lot 0 bis EntraID confirmation, Lot 1+ capture probe,
Record/Stop, agent narration, voice, refinement, runner execution.
