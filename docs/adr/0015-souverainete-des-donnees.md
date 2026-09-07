# ADR-0015 - Souveraineté des données (D-15)

**Statut** : actée, hypothèse explicitement **révisable**.
**Exigences liées** : F-29, 6.9, section 9, section 13.

## Contexte

La narration et le raffinement transmettent des descripteurs de page expurgés à un
fournisseur distant. Aucune contrainte de localisation des données n'est posée à ce stade.

## Décision

**Aucune contrainte de souveraineté en v1.** L'hypothèse est documentée comme révisable.

## Justification

Poser une contrainte de souveraineté aujourd'hui imposerait des choix de modèles fortement
dégradés, sans besoin exprimé. Le risque est traité par **conception plutôt que par
contrainte** : l'abstraction de fournisseur (F-29) et le filtre d'expurgation unique (6.9)
constituent les deux points d'ancrage d'une mise en conformité ultérieure, et l'alternative
d'un modèle sur réseau privé est déjà documentée (ADR-0014).

## Conséquences

- Si une contrainte apparaît après la v1, la reconfiguration porte sur le fournisseur et non
  sur l'architecture.
- Le coût de cette révision est borné à la perte éventuelle de multimodalité.
