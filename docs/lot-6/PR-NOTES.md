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
`--report`, `--trace`) are forwarded. `--no-ai` / `CI=1` constructs no LLM
client (F-60).

Measurement protocol for PRD §2.2 non-contractual goals: corpus of 10
public sites + 10 local CI pages, J+1 replay, rates published under
`docs/lot-6/`. First numbers: local 10/10 and public J+0 10/10 `--no-ai`.
J+1 public is due 2026-09-09.

### Exit criteria (PRD §11 Lot 6)

- [x] Script executed outside Spyglass, headed (visible) and `--headless`
- [x] Replay rates measured on the corpus and published

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

### Screenshots

| File | What it shows |
| --- | --- |
| [`screenshots/generated-script-tree.png`](screenshots/generated-script-tree.png) | `generated/` tree (json/ts/README/package.json) |
| [`screenshots/headed-run.png`](screenshots/headed-run.png) | Visible fixture after generated-script click (`#done`) |
| [`screenshots/headless-run.png`](screenshots/headless-run.png) | `--headless --no-ai` exit 0, no keys, outside Electron |
| [`screenshots/corpus-protocol-snippet.png`](screenshots/corpus-protocol-snippet.png) | Protocol + first published rates |

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

## Adversarial pass 1 (auto-fix)

Applied on tip `7438b3ddefdeb82a3bc9cb04c2de5512c91aa525`. Product decisions
1–5 above are unchanged. L6-003 (J+1 exit checklist) is unchanged
(ask-user pending).

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

Unit tests after this pass: **353 passed, 1 skipped**, 49 files
(`pnpm lint`, `pnpm typecheck`, `pnpm test`). L6-003 J+1 public replay
remains pending.

## Residuals

- Lot 7 auto-apply / PR (F-62–F-65) is out of scope.
- `@spyglass/runner` is not published to npm yet; outside the monorepo the
  generated README uses `file:` / future registry.
- No live smart bake-off; I-05 remains `claude-sonnet-4-5-20250929`.
