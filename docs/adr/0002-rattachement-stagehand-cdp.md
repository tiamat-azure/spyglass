# ADR-0002 - Rattachement de Stagehand (D-02)

**Statut** : actée. **Exigences liées** : F-20, F-22, F-59, 6.4, I-01.

## Contexte

L'agent doit observer et rejouer exactement le parcours joué par l'humain, sans rejeu ni
resynchronisation.

## Décision

Stagehand ne lance pas son propre navigateur. Le processus principal expose un port de
débogage distant ; Stagehand s'y connecte en **CDP**, en ciblant la `WebContentsView`
affichée. Mode local strict : environnement local forcé, aucune dépendance à Browserbase.

## Justification

Un navigateur unique partagé entre l'humain et l'agent supprime par construction toute
classe de bugs de synchronisation d'état, et garantit que le rejeu depuis Spyglass se
comporte comme l'enregistrement.

## Alternatives écartées

| Alternative | Motif de rejet |
|---|---|
| Navigateur Stagehand séparé | Deux états de page à synchroniser, incohérences de session et de cookies |
| Browserbase ou navigateur hébergé | Dépendance d'infrastructure, latence, sortie des données de page |

## Conséquences

- `observe`, `act` et `extract` sont disponibles pendant et après l'enregistrement, sur la
  page réellement visible.
- Point d'implémentation ouvert : résolution de la cible CDP et maintien de la liaison à
  travers les navigations et les recréations de contexte (I-01).
