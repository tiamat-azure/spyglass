# ADR-0007 - Stratégie de vérification d'étape (D-07)

**Statut** : actée. **Exigences liées** : F-26, F-44, 6.10.

## Contexte

Un scénario sans assertion n'a aucune valeur de détection. Demander une assertion explicite
à chaque étape pendant l'enregistrement briserait le rythme du parcours humain.

## Décision

**Heuristique proposée** par l'agent au fil de l'eau, qualifiée `strong` ou `weak`, puis
**validation groupée au raffinement**. La finalisation du scénario est bloquée tant qu'il
subsiste une vérification `weak` non confirmée.

## Justification

La qualification `strong` / `weak` déplace l'effort humain là où il est utile : l'utilisateur
ne relit que ce dont le système doute. Le blocage de finalisation interdit qu'un scénario
parte en production avec des assertions purement heuristiques, sans pour autant imposer une
saisie exhaustive pendant l'enregistrement.

## Alternatives écartées

| Alternative | Motif de rejet |
|---|---|
| Assertion explicite obligatoire à chaque étape | Rompt le parcours humain, contredit l'objectif de 10 étapes en moins de 5 minutes |
| Assertions purement heuristiques, sans revue | Scénarios complaisants, faux positifs à l'exécution |

## Conséquences

- Une étape raffinée porte obligatoirement au moins un critère de vérification.
- `strength`, `weakReason` et `confirmedByUser` sont des champs de premier ordre du modèle de
  données.
- **Ergonomie du blocage (F-44b).** Toute étape sans dictée corrélée produit mécaniquement une
  vérification `weak`. Sur une session de 50 étapes commentée 5 fois, le blocage de F-44
  imposerait 45 confirmations unitaires, faisant du garde-fou de qualité le premier frein à
  l'adoption. Les `weak` sont donc scindées en deux groupes : les **routinières**, adossées à
  un changement d'état observable, confirmables en un geste après affichage exhaustif de la
  liste ; les **douteuses**, confirmables une par une exclusivement. Le blocage est
  intégralement conservé, il porte sur le geste et non sur le nombre d'étapes.
