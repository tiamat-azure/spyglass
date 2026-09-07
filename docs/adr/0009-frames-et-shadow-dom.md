# ADR-0009 - Support des frames et du shadow DOM (D-09)

**Statut** : actée. **Exigences liées** : F-13, 6.5, 6.10, I-06.

## Contexte

Le descripteur d'élément est le format le plus coûteux à faire évoluer après coup : il est
gravé dans l'artefact brut, dans le raffiné et dans les scénarios générés.

## Décision

Support complet des **iframes** et des **shadow roots ouverts** dès le **lot 1**, avec
`framePath` et `shadowPath` de premier ordre dans le descripteur. Le **shadow DOM fermé**
(`mode: 'closed'`) reste hors périmètre, par impossibilité technique.

## Justification

L'absence de ce support ferait échouer la capture sur les cas les plus courants en
entreprise : bandeaux de consentement, tunnels de paiement, authentification fédérée,
composants web. Le repousser imposerait une migration de format des artefacts déjà produits.

## Alternatives écartées

| Alternative | Motif de rejet |
|---|---|
| Support différé à un lot ultérieur | Migration de format d'artefact, capture inexploitable sur les cas réels d'entreprise |
| Contournement du shadow DOM fermé | Non observable par conception ; tout contournement serait fragile et intrusif |

## Conséquences

- La sonde est injectée sur chaque document et chaque iframe, avant tout script de page.
- Contrainte forte : la sonde doit rester **passive et invisible** pour le site cible, sans
  modification du DOM, sans variable globale devinable, sans impact mesurable sur les
  performances.
