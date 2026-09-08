# Measured replay rates (PRD §2.2, Lot 6)

Targets **> 95 %** without AI at J+1 (unchanged site) and **> 80 %** with AI on
a modified site are **aspirational**, not contractual. This file publishes the
first in-repo numbers. Protocol: [`protocol.md`](protocol.md). Corpus:
[`corpus.json`](corpus.json).

| Wave | Date (UTC) | Corpus | `--no-ai` rate | Notes |
| --- | --- | --- | --- | --- |
| local-immutable | 2026-09-08T14:17:00Z | 10 fixture pages | **10/10 (100 %)** | CI, no keys, no egress |
| J+0 public | 2026-09-08T14:18:21Z | 10 public sites | **10/10 (100 %)** | `--headless --no-ai` |
| J+1 public | **N/A / pending** (due 2026-09-09) | static `PUBLIC_CORPUS` (rebuilt, not the J+0 on-disk `scenario.json`) | **N/A / pending** | ≥24 h after J+0; **not measured** in this lot. Do not copy J+0 10/10. Run `--public --j1` (below). Same-artifact replay is a residual. |
| modified + AI | Lot 5 | local broken selector | n/a here | recovery + `applied: false` (F-57) |

Raw JSON: [`measured-rates.local.json`](measured-rates.local.json),
[`measured-rates.j0.json`](measured-rates.j0.json). Canonical J+0 public copy:
[`measured-rates.json`](measured-rates.json). There is **no** `measured-rates.j1.json`
yet — J+1 public is **N/A / pending**, not a claimed percentage.

## J+1 public — N/A / pending

This lot’s wall-clock did **not** wait ≥24 h after J+0 (2026-09-08T14:18:21Z).
The J+1 public row is **N/A / pending** (due **2026-09-09**). It is **not**
a measured rate. Lot 6 `--public --j1` **rebuilds** scenarios from static
`PUBLIC_CORPUS` (same hosts/steps as J+0). It does **not** persist or reload
the J+0 on-disk `scenario.json`. Same-artifact replay is a residual for later.

```bash
pnpm --filter @spyglass/runner exec node --experimental-transform-types src/corpus-cli.ts --public --j1 --out docs/lot-6/measured-rates.j1.json
```

Write that output into the table when the wave actually runs. Until then, do
not invent a J+1 percentage.

`w3.org` homepage did not expose “W3C” in `body` innerText (title/meta only).
The corpus step for that host uses `elementVisible` on `body` plus exact
`urlMatches` (see `requireText: false`). Other hosts still assert `textPresent`.

Re-run local / J+0:

```bash
pnpm measure-corpus
```

`pnpm measure-corpus` (local-immutable) writes [`measured-rates.local.json`](measured-rates.local.json)
and does **not** clobber canonical J+0 [`measured-rates.json`](measured-rates.json).
J+0 public: `--public` (default `--out` `measured-rates.json`). J+1:
`--public --j1` (default `--out` `measured-rates.j1.json`).

J+1 public (`--public --j1`) is **N/A / pending** until the due date; use the
command in the section above (`--out docs/lot-6/measured-rates.j1.json`).
Do not invent a J+1 percentage.
