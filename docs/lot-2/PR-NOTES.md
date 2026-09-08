# Lot 2 evidence and PR notes

Do **not** open the pull request from this lot unless a human asks. This file
is the hand-off for a later PR. Parent runs adversarial review, then opens the
PR.

Branch: `cursor/lot-2-observer-2c69`  
Base: `4a2ed896de00e607555a0ab80ad08d213535297c` (Lot 1 merged `main`)

## Suggested PR title

```
feat(lot-2): observer gabarits, two-profile LLM enrichment, token ceilings
```

## Suggested PR body (paste)

Lot 2 (Agent observateur) only. Lot 1 capture, Electron security, CDP gating,
sealed-failed, and `setChecked` are unchanged.

The chrome chat paints each captured step from a **local deterministic gabarit**
(F-21, I-04) with a collapsible technical block. That first paint does not wait
on the network. A two-profile LLM gateway (`fast` / `smart`, ADR-0003) then
**batches** events (`LLM_FAST_BATCH_MS`, default 500 ms) and **replaces the
gabarit in place** when narration arrives. Every remote call is forced through
a single expurgation filter (6.9): no field values, secret refs, cookies,
tokens, or DOM snapshots.

**I-03 closed:** default `fast` model is pinned to the dated Anthropic snapshot
`claude-haiku-4-5-20251001` (Haiku 4.5). Live latency / French-quality
measurement against the paid API was not run in this environment (no live
keys); CI uses a mock transport. Residual: confirm p95 < 2 s on a real
recording with a live key.

**I-04 closed for coverage:** gabarits exist for every `raw-event` kind
(interaction, navigation, selection, voice stubs, agent, session control).
French, second person, passé composé, never a field value or URL. Residual:
copy-edit of a few control phrases after a native-speaker pass.

Offline / `SPYGLASS_LLM_OFFLINE=1` / missing provider: enrichment suspends,
gabarits remain, `raw.jsonl` is complete, recording never stops (F-23).

Token counters (F-28 / F-70) are per-profile, in tokens, with an indicative USD
line only when the pinned Haiku model is in the tiny tariff table. Double
threshold (F-72): warn at 50 %, suspend enrichment at 100 % with “Relever le
plafond”. Rate limit (F-73): 60 calls / min. Recording continues in every halt.

F-29 settings live in the **Browser / Settings** tabs (W-08). The guest
`WebContentsView` is hidden with `setVisible(false)` (never zero bounds). API
keys are encrypted with Electron `safeStorage` and never written as plaintext
in `settings.json`. When encryption is unavailable (headless Linux without a
keyring), the key stays in memory / env only.

CI never needs a live key: `SPYGLASS_LLM_TRANSPORT=mock` (default without a
key) plus an explicit offline transport.

**No Lot 3+** (no voice sidecar, refinement, runner, or generated script).
Stagehand `act()` replay remains LLM-free (I-07).

### Exit criteria (PRD §11 Lot 2)

- [x] Each step shows in chat **< 200 ms** as a gabarit, then enriches
- [x] Network cut / enrichment disabled: complete gabarit chat, **no event loss**
- [x] Artificially lowered token ceiling → warning then suspend enrichment;
      **recording continues**

### How the three exit demos were proven

`pnpm lint`, `pnpm typecheck`, `pnpm test` (152 passed, 1 skipped),
`pnpm test:coverage`, and `pnpm test:e2e` (**7/7**, including Lot 0 shell and
Lot 1 Record/Stop) were green on this branch. CI uses the mock LLM transport
(no live keys).

1. **< 200 ms then enrich.** Unit test
   `observer agent > emits a gabarit chat message before enrichment replaces it`
   asserts gabarit emit delay < 200 ms, then mock LLM replace-in-place.
   Playwright `packages/app/e2e/lot2-observer.spec.ts` records the Lot 1
   fixture, clicks `#step-1`, asserts `data-mode=template`, mode pill
   `gabarit déterministe`, and `data-latency-ms < 200` **before** taking
   `gabarit-under-200ms.png` (mock delay 1200 ms so enrichment cannot race the
   shot). Then `data-mode=llm` / pill `enrichi` and
   `enrichment-replace-in-place.png` with the tech block opened.
2. **Offline, no event loss.** Unit test with `enrichmentEnabled: false`.
   E2E launches with `SPYGLASS_LLM_OFFLINE=1` / `SPYGLASS_LLM_TRANSPORT=offline`,
   records click + fill, asserts gabarit copy in chat, zero `data-mode=llm`
   rows, meter `enrichment offline · recording continues`, banner « Réseau
   indisponible… Aucun événement n'est perdu. », and `raw.jsonl` still contains
   `record.start`, `dom.click`, `dom.input`, `record.stop` with no
   `"mode": "llm"`.
3. **Lowered ceiling.** Unit test with `ceiling: 100` and 80 tokens/call.
   E2E sets `SESSION_TOKEN_LIMIT_FAST=100` and `SPYGLASS_LLM_MOCK_TOKENS=80`,
   clicks several fixture controls, asserts the 50 % warning (« Attention :
   80 % du plafond… ») and the danger banner « Plafond de tokens atteint —
   enrichissement suspendu. L'enregistrement continue. », meter `160 / 100`
   with `enrichment ceiling · recording continues`, while `#record-btn` still
   reads Stop and `#rec-pill` stays active.

Stop no longer deadlocks when `onBeforeSeal` flushes the observer: journal
writes use `AsyncLocalStorage` so `appendAgentEvent` may re-enter the current
write (Lot 1 Record/Stop e2e still ~2.7 s).

### Residuals / not in this lot

- **I-03 residual:** no live-key p95 latency / French-quality bake-off in this
  lot. Pin is the current dated Haiku 4.5 snapshot; alias `claude-haiku-4-5`
  is accepted. Re-measure on a real session before marketing CA-04 p95.
- **I-04 residual:** voice / agent / pause-resume gabarits are present for
  schema completeness but unused until later lots. Native-speaker polish
  welcome.
- **I-05:** smart model remains the default `claude-sonnet-4-5-20250929`, not
  frozen (Lot 4).
- F-25 dialogue during recording, F-26 verification proposals, F-27 click-to-
  highlight (C-1 bis overlay) are out of Lot 2 scope.
- Live Anthropic/OpenAI calls are opt-in (`SPYGLASS_LLM_TRANSPORT=live` + key).
- Linux CI `safeStorage.isEncryptionAvailable()` is often false; keys then
  stay in memory. Encrypted persist is covered by a vault double in unit tests.

### Adversarial notes

- Expurgation is inside `LlmGateway.narrate`; there is no public method that
  sends raw events to a transport.
- `raw.jsonl` stays append-only. Enrichment does not rewrite the original
  template line; it emits `spyglass:chat:enriched` and appends `agent.message`.
- Guest pane hide uses `setVisible`, not zero bounds (W-08 / C-1).

### Adversarial pass 1 (auto-fix)

Applied on this branch without a PR. T1 (Settings test / mock transport unless
`SPYGLASS_LLM_TRANSPORT=live`) left for the captain.

- Password/card keystrokes are omitted from gabarits (`shouldMaskField`) and
  `keyGabarit` never interpolates masked or single-character keys.
- Collapsible tech blocks run `expurgatePage` / `expurgateTarget` and drop
  action arguments on field/sensitive events.
- `configSet` calls `budget.configure` live and will not clear an offline halt
  (`SPYGLASS_LLM_OFFLINE=1` or `SPYGLASS_LLM_TRANSPORT=offline`).
- Transient `halt=error` retries after 15 s (and clears on `setEnabled(true)`).
- Rate-limit banners re-announce after the window auto-clears, using the live
  `rateLimitCallsPerMin`.
- `resolveProfile('smart')` uses `LLM_SMART_TIMEOUT_MS` (default 8000), not the
  fast 1200 ms budget.

## Screenshots (committed)

| Relative path | What it shows |
| --- | --- |
| [`screenshots/gabarit-under-200ms.png`](screenshots/gabarit-under-200ms.png) | Click row still `GABARIT DÉTERMINISTE` (`Tu as cliqué sur « Start »`), 0 tokens, REC on |
| [`screenshots/enrichment-replace-in-place.png`](screenshots/enrichment-replace-in-place.png) | Same row `ENRICHI` (`Tu as cliqué sur le bouton Start`) + open `descripteur DOM` JSON |
| [`screenshots/offline-gabarits.png`](screenshots/offline-gabarits.png) | Gabarits only, réseau indisponible banner, `enrichment offline · recording continues` |
| [`screenshots/suspended-enrichment-recording-continues.png`](screenshots/suspended-enrichment-recording-continues.png) | 80 % warning + ceiling banner, meter 160/100, Stop/REC still active |
| [`screenshots/f29-settings-safestorage.png`](screenshots/f29-settings-safestorage.png) | F-29 Settings: Haiku pin, `safeStorage` copy, ceiling 100 |

Absolute paths in this checkout:

- `/workspace/docs/lot-2/screenshots/gabarit-under-200ms.png`
- `/workspace/docs/lot-2/screenshots/enrichment-replace-in-place.png`
- `/workspace/docs/lot-2/screenshots/offline-gabarits.png`
- `/workspace/docs/lot-2/screenshots/suspended-enrichment-recording-continues.png`
- `/workspace/docs/lot-2/screenshots/f29-settings-safestorage.png`

Parent remounts copies to
`/home/box/agent-data/grok-ship/reports/spyglass-screenshots/FM-spyglass-lot-2-20260908/`
(this environment may not be able to write that path; files live under
`docs/lot-2/screenshots/`).
