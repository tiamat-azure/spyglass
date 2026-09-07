# ADR-0006 - Format de l'artefact exécutable (D-06)

**Statut** : actée. **Exigences liées** : F-45, F-48, F-58, 6.12.

## Contexte

Le script généré doit être lisible et éditable par un automaticien, tout en évitant que la
logique d'exécution soit dupliquée dans chaque scénario généré.

## Décision

Format **hybride** : le JSON raffiné est la source de vérité, le moteur d'exécution
(vérifications, tentatives, rattrapage, rapports) est une **librairie versionnée**, et le
fichier généré est un **script mince** qui importe le moteur et déclare le scénario.

## Justification

Un script entièrement généré ferait figer la logique d'exécution à la date de génération :
toute correction du moteur imposerait de régénérer tous les scénarios existants. À
l'inverse, un JSON seul sans script perdrait l'exécutabilité autonome et la lisibilité au
niveau des étapes.

## Alternatives écartées

| Alternative | Motif de rejet |
|---|---|
| Script Playwright entièrement généré | Logique d'exécution dupliquée et figée dans chaque scénario |
| JSON seul exécuté par un CLI | Perte de lisibilité et d'éditabilité au niveau des étapes |

## Conséquences

- Le script reste exécutable hors de Spyglass, la librairie étant une dépendance déclarée.
- En mode `--no-ai`, le script ne requiert aucune clé d'API.
- La librairie devient un artefact à versionner et à faire évoluer de façon compatible.
