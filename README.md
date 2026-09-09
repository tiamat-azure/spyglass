# Spyglass

AI-assisted web scenario recorder (Stagehand). This repository is a **pnpm
monorepo**. Lot **-1** froze the toolchain. Lot **0** shipped the two-zone
Electron shell and Stagehand CDP. Lot **1** adds **DOM capture**. Lot **2**
adds the **observer agent**. Lot **3** adds **local voice** (hold-to-talk,
VAD, streaming STT, whisper.cpp sidecar).

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
| Lint/format | **Biome 2.5.12** (single tool, all workspace packages) | `biome.json` |
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
| `@spyglass/app` | Two-zone Electron shell, capture session, observer chat, F-29 settings, Stagehand `observe`/`act` |
| `@spyglass/llm` | Two-profile LLM gateway, gabarits, expurgation filter, token budget (Lot 2) |
| `@spyglass/runner` | Deterministic replay library, thin generated script (`scenario.ts`), verification, bounded AI recovery, CLI `spyglass-run` / `spyglass-generate` (Lots 5–6, ADR-0006) |
| `@spyglass/probe` | Injected DOM probe (frames + open shadow, mask, denoise, local replay descriptor) |
| `@spyglass/contracts` | Types + ajv validation wired to `docs/contracts/schemas` |
| `@spyglass/stt` | Local STT sidecar — mock engine in CI, whisper.cpp for packaged/dev (ADR-0013) |

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
above is set. When CDP is on, `--remote-allow-origins` is the **empty string**
(not `*`). Chromium 111+ only rejects DevTools WebSockets that send an `Origin`
header missing from that allowlist; Playwright/Stagehand Node clients omit
`Origin`, so Observe still attaches. Browser-origin CDP is denied.

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

## Lot 1 — capture

Record / Stop in the chat composer writes an append-only `raw.jsonl` under
`SESSIONS_DIR` (default `userData/sessions`). The guest probe covers iframes and
open shadow DOM. Local descriptors replay with Stagehand `act()` and **no LLM**
(`selfHeal: false`; the act worker throws if a chat completion is requested).

Local fixture: `packages/app/resources/lot1-fixture.html` (set
`SPYGLASS_GUEST_PAGE=lot1-fixture.html`). E2E: `pnpm test:e2e`.

D-10 (`loginRedirect`) was **confirmed 2026-09-08**. Scout evidence:
`scout/lot-0bis-evidence-20260908` @ `840f187`. MFA hop was not completed;
residual federation risk remains. `pageId` stays additive.

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
Stagehand CDP attach + `observe` (ADR-0002 / I-01).

Implemented (Lot 1): DOM probe (frames + open shadow), Record/Stop (F-10),
masking (F-15), denoising (F-16), retraction (F-19), local replay descriptor
(F-22), append-only `raw.jsonl` (F-40), sliding screenshot retention (D-11),
Stagehand `act()` without LLM (I-07). D-10 `loginRedirect` confirmed 2026-09-08.

Implemented (Lot 2): gabarit-first observer chat (F-21), two-profile LLM
enrichment, expurgation, token ceilings, F-29 settings.

Implemented (Lot 3): hold-to-talk + VAD mic capture (F-30), streaming
partial→final STT (F-31), temporal correlation in `raw.jsonl` (F-32), local
whisper.cpp sidecar over **main-only** localhost WebSocket (ADR-0004/0005/0013),
`AUDIO_RETENTION=none` by default (F-49). CI uses the mock engine when
whisper binaries/models are absent (`SPYGLASS_STT_ENGINE=mock`). Fetch weights
with `node scripts/fetch-whisper.mjs` for the real packaged/dev path.

Implemented (Lot 4): refine sealed `raw.jsonl` into `refined/rev-N.json` (F-41,
F-46) without mutating the journal (F-42). Each step is intent → action →
verification with `sourceEvents`. Weak verifications block finalize (F-44);
routine weaks confirm in one gesture, doubtful one-by-one (F-44b). Smart
profile (`LLM_SMART_MODEL=claude-sonnet-4-5-20250929`, I-05) with per-operation
token estimate + confirm (F-71, F-74). `observe()` enrichment only when local
F-22 descriptors are insufficient (I-07), one smart-time call per scenario.

Implemented (Lot 5): `@spyglass/runner` deterministic replay without an LLM
on the happy path (F-50), post-step verification (F-51), bounded AI recovery
(F-52–F-55), suggested patch never applied (F-57), CLI flags (F-58 / F-60).

Implemented (Lot 6): finalize writes `generated/scenario.json` (source of
truth), thin `scenario.ts` importing `runScenario` from
`@spyglass/runner` (ADR-0006 / F-45), README mode d'emploi, F-58 flags with
**visible by default** and `--headless` (`createPlaywrightDriver` is headed
unless `headless === true`, D35b). `--base-url` rewrites the origin of
an absolute http(s) `startUrl` (optional base path prefix); relative URLs
still resolve with WHATWG. Relative `--report` is resolved from the
scenario file directory, not `process.cwd()` (A19a). The script runs
outside Electron; `--no-ai` needs no API key. Omitting `driver` in
`runScenario` launches a real standalone Playwright Chromium (generated
`scenario.ts` / CLI) and defaults `argv` / `env` to `process.argv.slice(2)`
/ `process.env` (S44b / S66b). In-app replay (`ReplayEngine`) always passes an
explicit driver bound to the guest window. In-app Rejouer loads
`generated/scenario.json` only when the latest `rev-N` is `finalized`
(G56a). Corpus `--out` must be a `.json` file under `docs/lot-6/` (O57a).
Measurement protocol for
PRD §2.2 non-contractual replay rates:
10 public sites + local CI corpus, published under
[`docs/lot-6/`](docs/lot-6/). **J+1 public is N/A / pending** (J1c). When
`--public --j1` runs, Lot 6 **rebuilds from static `PUBLIC_CORPUS`**, not a
persisted J+0 `scenario.json` (J8c).

**Not** implemented: Lot 7 assisted patch apply / PR to the target repo
(F-62–F-65). Closed shadow DOM remains out of scope (ADR-0009).
