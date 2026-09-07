# Spyglass

AI-assisted web scenario recorder (Stagehand). This repository is a **pnpm
monorepo**. Lot **-1** freezes the toolchain and ships an **empty Electron
shell** so build, test, and packaging work before any product UI.

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

## npm scope

Package names use **`@spyglass/*`** now so `@spyglass/runner` can be a
dependency of generated scripts later (ADR-0006). Packages are `private` in
this lot; publishing to the public registry is not part of Lot -1. Register the
`@spyglass` org on npmjs before Lot 5 if the runner will be published.

## Packages

| Package | Role in Lot -1 |
| --- | --- |
| `@spyglass/app` | Empty Electron window (no WebContentsView product chrome) |
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
pnpm dev               # electron-vite dev (empty shell)
pnpm build             # production build of packages that compile
pnpm start             # preview the built Electron app
pnpm test:e2e          # Playwright smoke against the built Electron app
pnpm package           # electron-builder for the current OS (unsigned)
```

Platform-specific packagers:

```bash
pnpm --filter @spyglass/app package:linux   # AppImage + deb (+ unpacked dir)
pnpm --filter @spyglass/app package:mac     # dmg arm64 + x64
pnpm --filter @spyglass/app package:win     # NSIS
```

Installers are **unsigned** and **not notarized** for internal v1. See
[`docs/UNSIGNED-DISTRIBUTION.md`](docs/UNSIGNED-DISTRIBUTION.md).

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

Lot -1 does **not** implement the two-pane product shell.

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

Implemented: toolchain, empty window, tests, schemas, packaging config, CI.

**Not** implemented (Lot 0+): WebContentsView split UI, URL bar, Stagehand/CDP,
DOM probe behaviour, recording, chat, voice, refinement, runner execution.
