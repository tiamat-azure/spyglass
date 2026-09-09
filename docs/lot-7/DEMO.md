# Lot 7 exit-criteria demo

## 1. Descriptor patch confirmed twice → assisted PR path

```bash
# From a clean target git repo that contains generated/scenario.json:
PATCH_ASSISTED_APPLY=true \
  pnpm --filter @spyglass/runner exec node --experimental-transform-types src/cli.ts \
  path/to/scenario.json --ai --repo /path/to/target-project
```

Run **twice** with the same recovered selector. After the second matching
`suggested-patch.json`, Spyglass:

1. Refuses if the worktree is dirty.
2. Creates `spyglass/patch-<session>-<hash>` (never commits `main`).
3. Updates only `action.descriptor` on that branch.
4. Prepares a **draft** PR. Does **not** merge.

Unit proof: `packages/runner/src/lot7-patch.test.ts`
(`creates a dedicated branch and prepares a PR without merging`).

`PATCH_ASSISTED_APPLY=false` (default) still writes `health.json`
candidates and leaves `suggested-patch.json` with `applied: false`.

## 2. Verification / structure stay proposal-only

`assertAssistedApplyAllowed` rejects `scope: verification` and
`scope: structure` even when `PATCH_ASSISTED_APPLY=true` and fictional
`PATCH_ALLOW_*` env vars are set (CA-14). Schema
`refined-step.illegal-patch-scope.json` still fails ajv.

## 3. Parameterized replay with distinct datasets

Finalize writes `generated/datasets/recorded.json` and `example.json`.

```bash
node --experimental-transform-types scenario.ts --no-ai --dataset datasets/recorded.json
node --experimental-transform-types scenario.ts --no-ai --dataset datasets/example.json
```

Unit proof: `packages/runner/src/lot7-parameters.test.ts`
(`replays the same scenario with distinct datasets`).

Evidence screenshots: `docs/lot-7/screenshots/` (health, dedicated branch,
datasets). Chrome controls: `pnpm test:e2e` (`lot7-finition.spec.ts`).

```bash
NODE_OPTIONS=--experimental-transform-types node scripts/capture-lot-7.mjs
```

## 4. In-app pas-à-pas (F-59)

After finalize, check **Pas à pas**, click **Rejouer**, then **Suivant**
for each step. Chat follows `replay.step`. **Arrêter** aborts.

## 5. Session export/import (F-47)

Buttons **Exporter la session** / **Importer une session** copy the
autonomous folder (`meta.json`, `raw.jsonl`, refined, generated, health,
runs).

## 6. STT upgrade (F-38 / F-39)

After `STT_UPGRADE_PROMPT_AFTER` (default 10) manual transcript edits, a
banner offers `large-v3-turbo`. **Refuser définitivement** never shows
again. `small` remains on disk. First-use latency above
`STT_MAX_LATENCY_MS` writes `large-fallback.json` and returns to `small`.
