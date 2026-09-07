# ADR-0008 - Périmètre de l'auto-réparation (D-08)

**Statut** : actée. **Exigences liées** : F-57, F-62 à F-65, 6.13, 8 (Intégrité des scénarios).

## Contexte

Un rattrapage IA réussi révèle un écart entre le scénario et la réalité de l'application.
Cet écart peut être capitalisé, mais l'automatisation de sa correction est le point où le
produit peut se détruire lui-même : un scénario qui se répare seul finit par être toujours
vert, donc sans valeur de détection.

## Décision

**Trois natures de patch, un seul périmètre automatisable.**

| Nature du patch | Effet | Traitement |
|---|---|---|
| **Descripteur d'action** : le sélecteur a changé, l'élément reste le même | Le scénario retrouve sa cible et continue de vérifier la même chose | **Seul périmètre éligible** à l'application assistée |
| **Critère de vérification** : l'assertion ne passe plus | Le scénario cesse de vérifier ce qu'il vérifiait | **Proposition pure, définitivement.** Une assertion affaiblie automatiquement produit un test complaisant |
| **Structure du scénario** : étape ajoutée, supprimée, réordonnée | Le parcours métier lui-même change | **Proposition pure, définitivement.** L'IA réécrirait une intention utilisateur qu'elle n'a pas observée |

Cette restriction est un **invariant de conception** (F-62), non un réglage : ni option de
contournement, ni variable de configuration.

En v1, le produit s'arrête à la production du patch (lot 5). L'application assistée est
livrée au lot 7, sous quatre conditions cumulatives : promotion après 2 exécutions
consécutives produisant le même descripteur corrigé (F-63), branche git dédiée et pull
request (F-64), revue humaine explicite, compteurs de fragilité (F-65).

## Justification

- **Confirmation par répétition** (F-63) : un succès isolé peut refléter un état transitoire
  du site (test A/B, cache, déploiement en cours). Le promouvoir graverait un accident.
- **Pull request et revue humaine** (F-64) : une CI verte ne vaut pas validation, le
  scénario modifié ne pouvant valider sa propre modification.
- **Garde-fou anti-dérive** (F-65) : un scénario réparé de façon répétée cesse
  progressivement de décrire la réalité de l'application. La réparation automatique est un
  sursis, jamais un substitut à l'enregistrement humain. D'où le marquage fragile à 3 patchs
  et obsolète à 5.

## Alternatives écartées

| Alternative | Motif de rejet |
|---|---|
| Application automatique de tout patch réussi | Scénarios toujours verts, perte totale de valeur de détection |
| Patch de vérification applicable sous option | Une option de contournement finit toujours par être activée sous pression de livraison |
| Commit direct sur la branche par défaut | Modification non revue et non attribuable d'un actif de test |

## Conséquences

- Le champ `patchHistory[].scope` n'admet que la valeur `action.descriptor`.
- Le produit assume de laisser des patchs de vérification et de structure en proposition
  permanente, donc du travail manuel résiduel.
