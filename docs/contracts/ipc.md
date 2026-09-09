# Contrat IPC

Tous les canaux sont typés, exposés explicitement par le `preload` via `contextBridge`, et
nommés `spyglass:<domaine>:<action>`. Le renderer n'a **jamais** accès à Node, au système de
fichiers, à une socket sortante ni aux clés d'API (ADR-0001, ADR-0005).

## Directions

- **invoke** : renderer → main, avec réponse (`ipcRenderer.invoke`).
- **send** : renderer → main, sans réponse.
- **emit** : main → renderer, flux poussé (`webContents.send`).

## Session d'enregistrement

| Canal | Direction | Requête | Réponse |
|---|---|---|---|
| `spyglass:session:start` | invoke | `{ startUrl: string }` | `{ sessionId: string }` |
| `spyglass:session:stop` | invoke | `{}` | `{ sessionId, eventCount, sizeBytes }` |
| `spyglass:session:pause` | invoke | `{}` | `{ state: RecorderState }` |
| `spyglass:session:resume` | invoke | `{}` | `{ state: RecorderState }` |
| `spyglass:session:retract` | invoke | `{ eventId: string }` | `{ retractedEventId: string }` (F-19) |
| `spyglass:session:state` | emit | — | `{ state: RecorderState, since: number, sessionId? }` |

`RecorderState` is `idle` | `recording` | `stopping` | `sealed` | `sealed-failed` | `refining` | `reviewing` | `finalized` | `replaying`.
`sealed-failed` is terminal for that session after a durable `record.stop` when
`meta.json` could not be sealed; retry Stop repairs meta only (no second stop event).
`refining` / `reviewing` / `finalized` / `replaying` never write `raw.jsonl` (F-42, F-59).

## Événements et chat

| Canal | Direction | Charge utile |
|---|---|---|
| `spyglass:event:appended` | emit | `RawEvent` validé, **après** écriture dans `raw.jsonl` |
| `spyglass:chat:message` | emit | `{ eventId, stepIndex, mode: 'template', text, technical }` (< 200 ms, F-21) |
| `spyglass:chat:enriched` | emit | `{ eventId, mode: 'llm', text }` remplacement en place |
| `spyglass:chat:ask` | invoke | `{ text: string }` → `{ replyId: string }` (F-25) |
| `spyglass:usage:update` | emit | `{ profile: 'fast'\|'smart', calls, inputTokens, outputTokens, ratio }` (F-28) |

## Navigateur

| Canal | Direction | Charge utile |
|---|---|---|
| `spyglass:nav:goto` | invoke | `{ url: string }` → `{ ok: true, url } \| { ok: false, error }` |
| `spyglass:nav:back` / `:forward` / `:reload` | invoke | `{}` |
| `spyglass:nav:state` | emit | `{ url, title, loading, canGoBack, canGoForward }` (F-02, F-05) |
| `spyglass:nav:popup-redirected` | emit | `{ url, source: 'window.open' \| 'target=_blank' }` (F-04, Lot 0 log) |
| `spyglass:layout:browserBounds` | send | `{ x, y, width, height }` DIP bounds of the left zone |
| `spyglass:stagehand:observe` | invoke | `{ instruction?: string }` → `{ ok, instruction, observations[], error?, cdpUrl?, guestUrl? }` (Lot 0 proof) |
| `spyglass:stagehand:cdp` | invoke | `{}` → `{ cdpUrl, port, guestUrl, targetId? }` (`port`/`cdpUrl` empty when remote debugging is off) |
| `spyglass:stagehand:result` | emit | same payload as `spyglass:stagehand:observe` |

## Voix

| Canal | Direction | Charge utile |
|---|---|---|
| `spyglass:voice:start` / `:stop` | invoke | `{ mode: 'hold' \| 'continuous' }` |
| `spyglass:voice:frame` | send | `ArrayBuffer` PCM 16 kHz mono. **Seul canal audio**, relayé par le main vers le sidecar en WebSocket `localhost` (ADR-0005) |
| `spyglass:voice:partial` | emit | `{ text, startTs }` |
| `spyglass:voice:final` | emit | `{ eventId, text, startTs, endTs }` |
| `spyglass:voice:edit` | invoke | `{ eventId, text }` (F-33) |
| `spyglass:voice:level` | emit | `{ rms: number }` (F-35) |

## Configuration

| Canal | Direction | Charge utile |
|---|---|---|
| `spyglass:config:get` | invoke | `{}` → configuration effective, **clés d'API masquées** (`sk-…abcd`) |
| `spyglass:config:set` | invoke | `{ profile, provider, model, baseUrl, apiKey? }` → `{ ok }`. La clé est chiffrée par `safeStorage` dans le main, jamais renvoyée |
| `spyglass:config:test` | invoke | `{ profile }` → `{ ok, latencyMs, multimodal: boolean }` (F-29, F-61) |

## Artefacts

| Canal | Direction | Charge utile |
|---|---|---|
| `spyglass:refine:run` | invoke | `{ aggressiveness?, confirm? }` → `{ ok, revision }` (F-41, F-43, F-74) |
| `spyglass:refine:estimate` | invoke | `{ aggressiveness? }` → `{ estimatedTokens, requiresConfirm, threshold }` (F-74) |
| `spyglass:refine:confirm` | invoke | `{ routine?: true, index?: number }` → `{ ok, revision }` (F-44b) |
| `spyglass:refine:edit` | invoke | `{ index, intent }` → `{ ok, revision }` (F-43) |
| `spyglass:refine:finalize` | invoke | `{}` → `{ ok }` or blocked on unconfirmed weak (F-44) |
| `spyglass:refine:get` | invoke | `{}` → révision courante |
| `spyglass:refine:state` | emit | `{ phase, revision? }` |
| `spyglass:generate:script` | invoke | `{ sessionId, revision }` → `{ paths: string[] }` |
| `spyglass:replay:start` | invoke | `{ forceAi?, noAi?, stepByStep? }` → `{ ok: true, runId }` or `{ ok: false, error }` (F-59, F-60) |
| `spyglass:replay:progress` | emit | `{ runId, stepIndex, status, mode, attempt, message }` |
| `spyglass:replay:next` / `:stop` | invoke | `{}` — pas à pas (F-59) |
| `spyglass:session:export` | invoke | `{}` → main `dialog.showOpenDialog` (directory, may create) then `{ ok, dest, sessionId }` or `{ ok: false, error }` (`cancelled` if dismissed; refuses a non-empty dest, O7a) (F-47, E4a) |
| `spyglass:session:import` | invoke | `{}` → main `dialog.showOpenDialog` (existing directory only) then `{ ok, sessionId, sessionDir }` or `{ ok: false, error }` (refuses if `sessionId` already exists, I7a) (F-47, E4a) |
| `spyglass:stt:upgrade-status` | invoke | `{}` → proposition large-v3-turbo (F-38) |
| `spyglass:stt:upgrade-decide` | invoke | `{ action: 'accept' \| 'refuse' }` (refus définitif) |
| `spyglass:stt:upgrade-offer` | emit | `{ propose: true }` |

## Règles

1. Toute charge utile entrante dans le main est **validée** contre son schéma avant
   traitement. Un message invalide est journalisé et rejeté, jamais interprété partiellement.
2. `spyglass:event:appended` n'est émis qu'**après** l'écriture disque : le renderer ne peut
   pas afficher une étape absente de l'artefact brut.
3. Aucun canal ne transporte de clé d'API vers le renderer, dans aucun sens.
4. Aucun canal ne transporte d'audio vers l'extérieur du main.
