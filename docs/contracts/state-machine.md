# Machine à états de l'orchestrateur de session

Composant central de 6.2. Une seule instance par fenêtre. Toute transition est journalisée
dans `raw.jsonl` sous un `kind` de la famille `record.*`.

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Recording : session:start / record.start
    Recording --> Paused : session:pause / record.pause
    Paused --> Recording : session:resume / record.resume
    Recording --> Stopping : session:stop
    Paused --> Stopping : session:stop
    Stopping --> Sealed : flush disque + record.stop
    Sealed --> Refining : refine:run
    Refining --> Reviewing : révision produite
    Reviewing --> Refining : refine:run (relance, F-43)
    Reviewing --> Finalized : toutes vérifications confirmées (F-44)
    Reviewing --> Reviewing : vérification weak non confirmée -> blocage
    Finalized --> Replaying : replay:start (Lot 5, F-59)
    Replaying --> Finalized : run terminé
    Finalized --> Generated : generate:script (Lot 6)
    Generated --> Replaying : replay:start
    Sealed --> [*]
    Generated --> [*]
```

## Invariants

| # | Invariant |
|---|---|
| S-1 | `Sealed` est terminal pour l'artefact brut : aucune écriture dans `raw.jsonl` après cet état (F-40). |
| S-2 | La transition `Reviewing → Finalized` est **refusée** tant qu'une vérification `weak` n'est pas confirmée (F-44, ADR-0007). |
| S-3 | Une perte de réseau ne provoque **aucune** transition. Elle n'affecte que le mode de narration (F-23). |
| S-4 | `Recording → Stopping` attend le vidage du tampon d'écriture avant `Sealed`. Un arrêt brutal laisse `raw.jsonl` valide jusqu'à la dernière ligne complète. |
| S-5 | `Refining` requiert le profil `smart` joignable ; son indisponibilité empêche d'entrer dans cet état, jamais d'en sortir. `Replaying` déterministe (F-50, F-60) n'exige pas de clé. Seul le sous-état `Recovering` exige `smart` (F-52). |

## Sous-machine d'exécution d'une étape (lot 5)

```mermaid
stateDiagram-v2
    [*] --> Deterministic
    Deterministic --> Verified : vérification OK
    Deterministic --> Recovering : vérification KO et rattrapage autorisé
    Deterministic --> Failed : vérification KO et --no-ai ou CI (F-60)
    Recovering --> Verified : rattrapage réussi, patch suggéré écrit (F-57)
    Recovering --> Recovering : tentative < MAX_AI_RETRIES
    Recovering --> Failed : tentatives épuisées (F-55)
    Verified --> [*] : étape suivante en mode déterministe (F-54)
    Failed --> [*] : arrêt, code de sortie non nul
```
