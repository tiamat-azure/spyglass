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
