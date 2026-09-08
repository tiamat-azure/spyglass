# Measured replay rates (PRD §2.2, Lot 6)

Targets **> 95 %** without AI at J+1 (unchanged site) and **> 80 %** with AI on
a modified site are **aspirational**, not contractual. This file publishes the
first in-repo numbers. Protocol: [`protocol.md`](protocol.md). Corpus:
[`corpus.json`](corpus.json).

| Wave | Date (UTC) | Corpus | `--no-ai` rate | Notes |
| --- | --- | --- | --- | --- |
| local-immutable | 2026-09-08T14:17:00Z | 10 fixture pages | **10/10 (100 %)** | CI, no keys, no egress |
| J+0 public | 2026-09-08T14:18:21Z | 10 public sites | **10/10 (100 %)** | `--headless --no-ai` |
| J+1 public | due 2026-09-09 | same `scenario.json` | *pending* | replay without regenerating selectors |
| modified + AI | Lot 5 | local broken selector | n/a here | recovery + `applied: false` (F-57) |

Raw JSON: [`measured-rates.local.json`](measured-rates.local.json),
[`measured-rates.j0.json`](measured-rates.j0.json). Canonical J+0 public copy:
[`measured-rates.json`](measured-rates.json).

`w3.org` homepage did not expose “W3C” in `body` innerText (title/meta only).
The corpus step for that host uses `elementVisible` on `body` plus exact
`urlMatches` (see `requireText: false`). Other hosts still assert `textPresent`.

Re-run:

```bash
pnpm measure-corpus
pnpm --filter @spyglass/runner exec node --experimental-transform-types src/corpus-cli.ts --public --j1
```
