# Lot 4 evidence and PR notes

Do **not** open the pull request from this lot unless a human asks. This file
is the hand-off for a later PR. Parent runs adversarial review, then opens the
PR.

Branch: `cursor/lot-4-refine-4e10`  
Base: `745650200444ab185e7f33436b193dd4b7dd7331` (Lot 3 merged `main`)

## Suggested PR title

```
feat(lot-4): refine sealed sessions into versioned scenarios with weak confirm
```

## Suggested PR body (paste)

Lot 4 (Raffinement) only. Lots 0–3 (Electron security, capture, observer
gabarits/enrichment, local voice) are unchanged.

After Stop seals `raw.jsonl`, the chrome shows a **Raffiner** panel. A
**smart**-profile call (ADR-0014) turns the journal into
`sessions/<id>/refined/rev-N.json`. Each step is canonical **intent → action →
verification**, with `sourceEvents` pointing at real `evt_*` ids (F-41, F-42).
Noise is dropped, consecutive identical actions merge (aggressiveness
conservative / balanced / aggressive), retracted steps (F-19) are ignored.
`raw.jsonl` is never rewritten.

**F-44 / ADR-0007:** every step has a verification `strong` | `weak`. Finalize
is refused while any weak is unconfirmed. **F-44b:** the full weak list is
shown first. Routine weaks (`observable-state-change`) confirm in one gesture;
doubtful weaks (`no-observable-change`, `ambiguous-target`, `value-assertion`)
confirm one-by-one only.

**F-43 / F-46:** relaunch refine with a new aggressiveness writes `rev-N+1`;
intents are editable before finalize.

**F-71 / F-74:** smart budget is **per operation**. The UI shows a token
estimate before trigger; above `SMART_TOKEN_CONFIRM` an explicit checkbox is
required.

**I-05 closed:** default `LLM_SMART_MODEL` is the dated snapshot
`claude-sonnet-4-5-20250929` (Sonnet 4.5), same pin style as Lot 2 Haiku.
Alias `claude-sonnet-4-5` is accepted. Residual: no live raffinement /
diagnostic bake-off (no live keys). `claude-sonnet-4-6` is a later
dateless-but-pinned id and is **not** the default.

**I-07:** local F-22 descriptors stay the replay source. `observe()` runs
**once per scenario at refine time**, and only when a descriptor is
insufficient (empty selector / css-or-xpath without description+fallbacks).
Lot 1 `act()` arbitration is not reopened.

CI never needs a live key: mock transport (`SPYGLASS_LLM_TRANSPORT=mock`) or
no key. Offline (`SPYGLASS_LLM_OFFLINE=1`) cannot enter `refining` (S-5).

**No Lot 5+** (no runner, generated script, auto patch).

### Exit criteria (PRD §11 Lot 4)

- [x] Valid refined scenario, traceable to raw
- [x] No unconfirmed weak after finalize
- [x] Tests + screenshots

### How the exit demos were proven

`pnpm lint`, `pnpm typecheck`, `pnpm test` (252 passed, 1 skipped),
`pnpm test:schemas`, and `xvfb-run pnpm test:e2e` (**14 passed**, Lots 0–4)
on this branch. CI uses the mock LLM transport (no live keys).

1. **Refine from fixture raw.** Playwright
   `packages/app/e2e/lot4-refine.spec.ts` records start page → Lot 1 fixture
   click + fill, Stop, estimates tokens, confirms the smart threshold, Raffiner.
   Unit tests `refineFromRaw` / `RefineEngine` assert `sourceEvents` ⊆ raw ids
   and `rev-1.json` / `rev-2.json` versioning with byte-identical `raw.jsonl`.
2. **Strong vs weak + F-44b.** Fixture without dictation yields weaks.
   Routine (`observable-state-change` on the `#lot1-link` navigation) vs
   doubtful (`no-observable-change` click, `value-assertion` fill). E2E
   clicks **Confirmer les routinières** then each doubtful **Confirmer**.
   Voice-correlated unit fixture produces `strength: strong`.
3. **Finalize blocked.** `#refine-finalize` stays disabled and
   `#refine-block` reads « Finalisation bloquée : vérifications weak non
   confirmées » until every weak is confirmed; `validateRefinedStep` then
   accepts the finalized revision.

### Residuals / not in this lot

- **I-05 residual:** no live-key quality bake-off of Sonnet 4.5 vs 4.6 on
  real raffinements. Pin is the last dated Sonnet 4.x snapshot.
- Lot 5 runner / generated script / auto-patch remain out of scope.
- Mock refine intents are structured but not native-speaker copy-edited.

### Adversarial notes

- Expurgation still sits in front of the smart transport (`LlmGateway.refine`).
- `sourceEvents` that are not in `raw.jsonl` reject the model output as a
  whole (prompt contract §2); local fallback is used only after a successful
  HTTP body that fails to parse.
- Transport failure (offline) does **not** persist a revision and does not
  leave the session in `refining`.
- Confirming routine weaks never confirms doubtful ones.
- `raw.jsonl` fingerprint is checked around persist/confirm/edit/finalize.
- Model-supplied `verification.expected` / type is ignored; local
  classification + `urlGlob` (including Chromium `file://null/…`) win.

## Screenshots (committed)

| Relative path | What it shows |
| --- | --- |
| [`screenshots/refine-ui-estimate.png`](screenshots/refine-ui-estimate.png) | Sealed session, smart estimate 1344 tokens, confirm checkbox, Raffiner |
| [`screenshots/strong-weak-badges.png`](screenshots/strong-weak-badges.png) | Refined steps with WEAK badges, intent, action, edit |
| [`screenshots/blocked-finalize.png`](screenshots/blocked-finalize.png) | Finaliser disabled + « Finalisation bloquée » + weak list |
| [`screenshots/raw-id-traceability.png`](screenshots/raw-id-traceability.png) | `sourceEvents evt_000002` |
| [`screenshots/weak-confirm-routine-doubtful.png`](screenshots/weak-confirm-routine-doubtful.png) | Full weak list: routinière vs douteuse (F-44b) |

Absolute paths in this checkout:

- `/workspace/docs/lot-4/screenshots/refine-ui-estimate.png`
- `/workspace/docs/lot-4/screenshots/strong-weak-badges.png`
- `/workspace/docs/lot-4/screenshots/blocked-finalize.png`
- `/workspace/docs/lot-4/screenshots/raw-id-traceability.png`
- `/workspace/docs/lot-4/screenshots/weak-confirm-routine-doubtful.png`

Parent remounts copies to
`/home/box/agent-data/grok-ship/reports/spyglass-screenshots/FM-spyglass-lot-4-20260908/`
(this environment may not be able to write that path; files live under
`docs/lot-4/screenshots/`).
