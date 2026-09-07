# Lot 0 evidence and PR notes

Do **not** open the pull request from this lot unless a human asks. This file
is the hand-off for a later PR.

## Screenshots (committed)

| Relative path | What it shows |
| --- | --- |
| [`screenshots/two-zone-shell.png`](screenshots/two-zone-shell.png) | Two-zone shell: URL bar, nav controls, WebContentsView, chat placeholder |
| [`screenshots/navigated-webcontentsview.png`](screenshots/navigated-webcontentsview.png) | Guest page loaded in the left `WebContentsView` |
| [`screenshots/stagehand-observe.png`](screenshots/stagehand-observe.png) | Observe results in the side pane (Stagehand via CDP) |
| [`screenshots/stagehand-observe.json`](screenshots/stagehand-observe.json) | JSON payload from `stagehand.observe()` |

Absolute paths in a checkout:

- `docs/lot-0/screenshots/two-zone-shell.png`
- `docs/lot-0/screenshots/navigated-webcontentsview.png`
- `docs/lot-0/screenshots/stagehand-observe.png`
- `docs/lot-0/screenshots/stagehand-observe.json`

## Suggested PR title

```
feat(lot-0): two-zone Electron shell, WebContentsView, Stagehand CDP observe
```

## Suggested PR body (paste)

Lot 0 (Socle) only. Electron shell with a 75/25 resizable split, a real
`WebContentsView` for browsing, URL bar + nav controls, single-page popup
redirect, and Stagehand attached over CDP to the **displayed** view.
`observe` can be run from the side pane or `pnpm observe`.

**No Lot 0 bis / Lot 1+** (no EntraID confirmation, capture probe, Record/Stop,
agent chat, voice, or refinement).

### Exit criteria (PRD §11)

- [x] App launches with two-zone layout + URL bar + WebContentsView (F-01, F-02)
- [x] Manual navigation: type URL, back, forward, reload (F-03)
- [x] `target=_blank` / `window.open` redirected into the current view (F-04)
- [x] Loading indicator (F-05) and persisted `persist:spyglass-browser` (F-06)
- [x] REC pill stub / disabled (F-07; recording is Lot 1)
- [x] Stagehand LOCAL + CDP to the displayed view; `observe` on the current page (ADR-0002, I-01)
- [x] Lint / typecheck / unit / e2e still pass; Lot -1 tooling unchanged

### How to verify observe

1. `pnpm start`
2. Navigate in the URL bar
3. Click **Observe page**, or `pnpm observe`
4. Results appear in the side pane / stdout JSON

CDP endpoint: `userData/cdp.json` (port also shown in the side pane).

### Evidence

![Two-zone shell](screenshots/two-zone-shell.png)
![Navigated WebContentsView](screenshots/navigated-webcontentsview.png)
![Stagehand observe](screenshots/stagehand-observe.png)
