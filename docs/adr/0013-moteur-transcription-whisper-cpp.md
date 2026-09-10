# ADR-0013 - Moteur de transcription (D-13)

**Statut** : actée. **Exigences liées** : F-34, F-37, F-39, 6.7, 8 (Empreinte).

## Contexte

La transcription doit être locale (ADR-0004), sans installation tierce à la charge de
l'utilisateur, sur trois plateformes et sans GPU.

## Décision

**`whisper.cpp`**, modèle **`small` multilingue quantifié**, **embarqué dans le paquet
applicatif** (de l'ordre de 190 Mo).

## Justification

Ce choix est le seul à réunir quatre propriétés : intégration native dans Electron par
bindings Node, binaires précompilés pour les trois plateformes, exécution CPU sans
dépendance externe, poids compatible avec l'embarquement.

La qualité en français est jugée suffisante pour une **dictée d'intention relue et éditable**
(F-33), qui n'a pas vocation à être transcrite au mot près.

## Alternatives écartées

| Alternative | Motif de rejet |
|---|---|
| Runtime Python (`faster-whisper`, `openai-whisper`) | Installation tierce à la charge de l'utilisateur, contraire à l'exigence |
| Téléchargement du modèle au premier lancement | Dictée non fonctionnelle hors ligne dès l'installation |
| Modèle `base` ou `tiny` | Précision insuffisante en français, y compris pour une dictée relue |
| Modèle `large` embarqué | Poids d'installeur et latence CPU rédhibitoires |

## Conséquences

- Poids d'installeur assumé, atténué par le choix du modèle quantifié.
- Chemin de montée en précision prévu sans changement d'architecture (ADR-0017).

## Amendement 2026-09-10 - disponibilité des binaires précompilés

Le principe reste inchangé, mais la promesse « binaires précompilés pour les trois
plateformes » n'est tenue qu'en partie par l'amont :

| Plateforme | Binaire `whisper-cli` amont | Conséquence |
|---|---|---|
| Linux x64 / arm64 | `whisper-bin-ubuntu-*.tar.gz` | Installation automatique |
| Windows x64 | `whisper-bin-x64.zip` | Installation automatique |
| macOS | **aucun** : la release ne publie qu'un `xcframework` | Compilation locale de `whisper.cpp` requise, ou binaire fourni par la chaîne de packaging macOS |

La dictée est donc **indisponible sur un poste macOS de développement** tant que
`whisper-cli` n'y est pas déposé à la main dans `vendor/whisper/`. Ce point reste à lever
avant toute distribution macOS, faute de quoi l'exigence F-34 (« sans installation tierce à
la charge de l'utilisateur ») ne serait pas tenue sur cette plateforme.

Deux conséquences opérationnelles en découlent :

- La version amont est **épinglée** (`whisper.cpp v1.9.2`, dépôt `ggml-org/whisper.cpp`)
  dans `scripts/fetch-whisper.mjs`, au même titre que les autres dépendances gelées pour v1.
- Le moteur `mock`, qui émet des transcriptions en dur, est **réservé à l'intégration
  continue et aux tests**. En l'absence de moteur local, la dictée refuse de démarrer avec
  un message explicite plutôt que de simuler une transcription.
