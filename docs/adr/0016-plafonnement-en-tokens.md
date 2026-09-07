# ADR-0016 - Unité de plafonnement de la consommation (D-16)

**Statut** : actée. **Exigences liées** : F-28, F-70 à F-75, section 5.7, section 7.

## Contexte

La narration produit un appel LLM par lot d'événements, sur toute la durée d'un
enregistrement. Le risque n'est pas budgétaire mais comportemental.

## Décision

Le plafonnement s'exprime **en tokens, jamais en devise**. L'estimation monétaire est
affichée en complément, à titre strictement indicatif, et n'entre dans **aucune logique de
contrôle**.

## Justification

Le token est la seule unité mesurable localement, indépendante du fournisseur, du modèle et
des évolutions tarifaires. Un plafond en devise dépendrait d'une table de tarifs qui
deviendrait fausse sans prévenir, et déclencherait des coupures arbitraires.

## Le plafond est un disjoncteur, pas un budget

Le coût nominal de la narration est négligeable : de l'ordre de 600 tokens par étape, soit
environ 30 000 tokens pour une session de 50 étapes, contre un plafond par défaut de
500 000 tokens.

Ce que le plafond doit détecter n'est donc pas un utilisateur prolixe, mais une **anomalie** :
rafale d'événements sur une page pathologique, boucle de narration, ou fuite de contexte
gonflant le prompt à chaque appel. Il est fixé à un ordre de grandeur au-dessus du nominal,
de façon à ne jamais se déclencher en usage normal tout en bornant franchement toute dérive.

C'est aussi pourquoi un **seuil de débit** (60 appels par minute) complète le plafond cumulé :
une rafale doit être détectée avant accumulation, pas après.

## Compteurs séparés par profil

Le profil `fast` est plafonné en cumul de session, en disjoncteur temps réel. Le profil
`smart`, dont un raffinement représente à lui seul un ordre de grandeur au-dessus de toute la
narration, est encadré **par opération** et non par session, avec estimation préalable et
confirmation au-delà d'un seuil.

## Conséquences

- L'enregistrement n'est jamais interrompu par l'atteinte d'un plafond : bascule en gabarits
  déterministes, avec action de relèvement proposée (F-72).
- Si le modèle configuré est absent de la table de tarifs, seule la consommation en tokens
  est affichée, sans estimation monétaire ni message d'erreur.
