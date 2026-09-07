# ADR-0003 - Stratégie LLM à deux profils (D-03)

**Statut** : actée. **Exigences liées** : F-23, F-24, F-29, 5.7, 6.8.

## Contexte

Deux usages du LLM coexistent, aux contraintes opposées : narrer des événements en direct
(volume élevé, latence critique, qualité rédactionnelle) et raisonner sur un scénario
(volume faible, latence tolérante, qualité de raisonnement).

## Décision

Un **unique point d'entrée** exposant **deux profils** configurables indépendamment :
`fast` pour la narration, `smart` pour le dialogue, le raffinement et le rattrapage.

## Justification

Un profil unique imposerait soit un modèle trop coûteux pour la narration, soit un modèle
trop faible pour le diagnostic. La séparation permet aussi des compteurs de consommation
disjoints, avec des politiques de plafonnement de nature différente (ADR-0016).

## Alternatives écartées

| Alternative | Motif de rejet |
|---|---|
| Modèle unique | Compromis coût/qualité intenable sur les deux usages |
| Trois profils ou plus | Complexité de configuration sans bénéfice démontré |

## Conséquences

- Les deux profils peuvent viser des fournisseurs distincts.
- L'indisponibilité de `smart` bloque le raffinement et le rattrapage, jamais
  l'enregistrement ni la dictée.
- L'implémentation respecte une interface indépendante du fournisseur : aucune
  particularité propre à un fournisseur ne remonte dans les couches supérieures.
