# ADR-0012 - Modèle du profil `fast`, narration (D-12)

**Statut** : actée. **Exigences liées** : F-23, F-24, F-29, 6.8, 2.3, section 7.

## Contexte

La narration transforme un descripteur DOM en langage naturel, à raison d'un appel par lot
d'événements. Sa qualité rédactionnelle conditionne directement la lisibilité de l'artefact
final, donc la valeur perçue du produit.

## Décision

**Fournisseur distant via clé d'API**, **Claude Haiku** comme valeur par défaut,
entièrement reconfigurable par l'utilisateur (F-29). **Mode dégradé par gabarits
déterministes obligatoire** (F-23).

## Justification

Un modèle distant de petite taille offre une qualité de français nettement supérieure à un
modèle local exécutable sur CPU, pour un coût unitaire négligeable au regard du volume
d'événements d'une session. La qualité rédactionnelle en français prime donc sur l'autonomie
hors ligne, à condition que la perte de réseau ne casse jamais l'enregistrement.

## Alternatives écartées

| Alternative | Motif de rejet |
|---|---|
| Modèle local sur CPU | Qualité de français insuffisante pour un artefact destiné à être relu |
| Gabarits déterministes seuls | Narration illisible et sans valeur sémantique ; conservés comme mode dégradé |

## Contreparties assumées et traitées

| Contrepartie | Traitement |
|---|---|
| Dépendance réseau | Mode dégradé par gabarits (F-23), signalé et journalisé |
| Coût par événement | Mise en lot (F-24), plafonnement en tokens et seuil de débit (5.7) |
| Latence réseau | Narration asynchrone, jamais bloquante pour la capture ni pour la navigation |
| Sortie de données de page | Expurgation systématique en amont (6.9), politique documentée (section 9) |

## Conséquences

- Le fonctionnement entièrement hors ligne est un non-objectif de la v1 : seule la qualité
  de narration se dégrade.
- L'utilisateur est informé au démarrage de session et peut rester en mode gabarits.
- Version exacte du modèle à figer au lot 2, après mesure (I-03).
