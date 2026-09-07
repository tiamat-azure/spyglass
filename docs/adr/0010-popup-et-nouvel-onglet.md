# ADR-0010 - Popup et nouvel onglet (D-10)

**Statut** : actée. **Hypothèse `loginRedirect` confirmée** le 2026-09-08 (lot 0 bis).
**Exigences liées** : F-04, 2.3, 6.10, I-02, section 13.

## Contexte

Le multi-onglets multiplie les états de page à capturer, à narrer et à rejouer. L'obstacle
réel est l'authentification fédérée en entreprise, qui peut recourir à une popup.

## Décision

**Une seule page active.** Toute tentative d'ouverture d'onglet ou de fenêtre
(`target=_blank`, `window.open`) est redirigée dans la page courante et journalisée comme
`nav.popup-redirected`.

## Hypothèse de travail — confirmée

Les applications cibles utilisent le flux OIDC EntraID `loginRedirect`, compatible sans
réserve avec une page unique.

**Confirmée le 2026-09-08** (capitaine, mot explicite) sur la foi du scout
`scout/lot-0bis-evidence-20260908` @ `840f187` (`docs/lot-0bis-scout/`) :

- Outlook Web / MSAL.js : `state.meta.interactionType === "redirect"` (pas `popup`).
- Toute la chaîne observée est restée dans l'unique `WebContentsView` invitée.
- Aucun `window.open`, `target=_blank`, `nav.popup-redirected`, ni seconde fenêtre OS.

Le hop **MFA / fédération d'annuaire n'a pas été parcouru** (arrêt à l'écran Sign in).
L'hypothèse est néanmoins **confirmée** : le chemin nominal `loginRedirect` ne requiert
pas de popup. Risque résiduel : un IdP d'entreprise qui basculerait en `loginPopup` ou
ouvrirait une fenêtre STS après l'e-mail / MFA. `pageId` reste **additif** (déjà dans le
contrat d'événement brut) pour ce cas, sans changer le modèle v1 à une page.

## Justification

Le champ `pageId` est présent dès la v1 bien qu'une seule page soit gérée : il rend le
support ultérieur d'une popup **additif plutôt que structurant**. C'est le prix d'option
payé d'avance contre le risque résiduel ci-dessus.

## Conséquences

- Le lot 1 (capture) n'est plus bloqué par D-10 / I-02.
- F-04 (rediriger `window.open` / `target=_blank` dans la vue courante) reste en vigueur
  pour tout le reste du web ; le chemin Outlook observé ne s'en sert pas.
- CA-03 (enregistrement complet d'un login EntraID) se vérifie pendant la capture, pas
  comme prérequis d'architecture.
