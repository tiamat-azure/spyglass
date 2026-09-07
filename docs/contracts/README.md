# Contrats techniques

Ces fichiers sont **normatifs**. Le PRD (section 15) les référence et ne les duplique pas.

| Contrat | Fichier | Lot |
|---|---|---|
| Événement brut | [`schemas/raw-event.schema.json`](schemas/raw-event.schema.json) | -1 |
| Étape raffinée | [`schemas/refined-step.schema.json`](schemas/refined-step.schema.json) | -1 |
| Santé d'un scénario | [`schemas/health.schema.json`](schemas/health.schema.json) | -1 |
| Canaux IPC | [`ipc.md`](ipc.md) | -1 |
| Machine à états | [`state-machine.md`](state-machine.md) | -1 |
| Prompts et sorties structurées | [`prompts.md`](prompts.md) | 2 et 4 |

## Règle de version

`schemaVersion` est porté par `meta.json` et par chaque ligne de `raw.jsonl`. Toute
modification non rétrocompatible d'un schéma incrémente cette version et s'accompagne d'un
convertisseur de session. Le format du descripteur d'élément est identifié par le PRD comme
« le contrat le plus coûteux à faire évoluer » (ADR-0009) : il est figé au lot 1.

## Validation

Les schémas sont exécutables. Un jeu d'exemples valides et invalides est maintenu dans
`examples/` et vérifié en intégration continue dès le lot -1.
