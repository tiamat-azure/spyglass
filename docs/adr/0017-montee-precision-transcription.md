# ADR-0017 - Montée en précision de la transcription (D-17)

**Statut** : actée, livrée au lot 7. **Exigences liées** : F-33, F-38, F-39, 6.7, section 7.

## Contexte

Le modèle `small` embarqué (ADR-0013) suffit à une dictée d'intention relue, mais peut
décrocher sur du vocabulaire métier ou en environnement bruyant.

## Décision

Mise à disposition de **`large-v3-turbo` quantifié** (de l'ordre de 575 Mo) en
**téléchargement optionnel après installation**, plutôt qu'embarqué. Sans changement
d'architecture.

## Trois règles encadrent cette montée en précision

- **Proposition contextuelle** (F-38) : elle est déclenchée par le constat d'un besoin réel,
  à savoir un nombre significatif de segments corrigés à la main, et non reléguée dans un
  écran de préférences que l'utilisateur gêné par la précision n'ouvrira jamais. La
  proposition reste refusable définitivement.
- **Coexistence des modèles** (F-39) : `small` n'est jamais supprimé. Les 190 Mo qu'il occupe
  sont un prix faible pour garantir qu'aucune configuration matérielle ne se retrouve avec
  une dictée devenue trop lente.
- **Repli automatique sur mesure** (F-39) : la latence du modèle lourd est mesurée au premier
  usage sur la machine réelle ; si elle dépasse le budget, le repli sur `small` est
  automatique et signalé. La décision n'est pas prise sur une caractéristique matérielle
  déclarée, mais sur une mesure.

## Alternatives écartées

| Alternative | Motif de rejet |
|---|---|
| `large-v3-turbo` embarqué par défaut | Installeur de l'ordre de 765 Mo, pénalisant l'adoption pour un besoin minoritaire |
| Remplacement de `small` après montée | Aucun repli possible sur machine lente, dictée dégradée sans recours |
| Réglage dans les préférences | Jamais rapproché du problème vécu par l'utilisateur |

## Conséquences

- Le cache des modèles réside dans le répertoire de données applicatives standard de la
  plateforme, surchargeable par configuration (`STT_MODEL_DIR`).
- Deux modèles coexistent sur disque après montée.
