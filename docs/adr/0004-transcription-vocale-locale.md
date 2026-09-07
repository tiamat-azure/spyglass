# ADR-0004 - Transcription vocale locale (D-04)

**Statut** : actée. **Exigences liées** : F-34, F-37, 6.7, 9.

## Contexte

L'utilisateur dicte son intention métier pendant qu'il navigue dans une application
potentiellement interne et sensible.

## Décision

Transcription **locale**, sans aucun appel réseau. Aucun flux audio ne quitte la machine.

## Justification

La dictée porte du vocabulaire métier confidentiel et se déroule dans un contexte
d'entreprise. Une transcription distante créerait un canal de sortie audio permanent,
difficile à justifier auprès d'une direction de la sécurité, et rendrait la dictée
inopérante hors ligne alors qu'elle est une fonction critique.

## Alternatives écartées

| Alternative | Motif de rejet |
|---|---|
| API de transcription distante | Sortie de données audio, dépendance réseau sur une fonction critique |
| API de reconnaissance vocale du navigateur | Implémentations qui délèguent au cloud, garanties non contrôlables |

## Conséquences

- La dictée reste pleinement fonctionnelle hors ligne, y compris lorsque la narration est
  en mode dégradé.
- Contrainte d'empreinte et de charge CPU sur le poste (ADR-0013).
