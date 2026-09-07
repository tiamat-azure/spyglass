# ADR-0010 - Popup et nouvel onglet (D-10)

**Statut** : actée **sous hypothèse à confirmer en lot 0 bis**.
**Exigences liées** : F-04, 2.3, 6.10, I-02, section 13.

## Contexte

Le multi-onglets multiplie les états de page à capturer, à narrer et à rejouer. L'obstacle
réel est l'authentification fédérée en entreprise, qui peut recourir à une popup.

## Décision

**Une seule page active.** Toute tentative d'ouverture d'onglet ou de fenêtre
(`target=_blank`, `window.open`) est redirigée dans la page courante et journalisée comme
`nav.popup-redirected`.

## Hypothèse de travail

Les applications cibles utilisent le flux OIDC EntraID `loginRedirect`, compatible sans
réserve avec une page unique.

**Cette hypothèse n'est pas encore vérifiée.** Elle est confirmée ou infirmée au lot 0 bis
(I-02). En cas d'invalidation, requalification vers le support d'une popup
d'authentification éphémère non enregistrée.

## Justification

Le champ `pageId` est présent dès la v1 bien qu'une seule page soit gérée : il rend le
support ultérieur d'une popup **additif plutôt que structurant**. C'est le prix d'option
payé d'avance contre le risque d'invalidation de l'hypothèse.

## Conséquences

- Risque identifié : blocage de l'authentification en entreprise si l'hypothèse tombe.
- Le lot 0 bis est un jalon bloquant avant l'investissement du lot 1.
