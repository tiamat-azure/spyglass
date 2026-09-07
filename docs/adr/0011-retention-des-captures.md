# ADR-0011 - Rétention des instantanés et captures (D-11)

**Statut** : actée. **Exigences liées** : F-17, F-52, 6.11, 2.2 (empreinte disque).

## Contexte

Le rattrapage IA (F-52) exige de disposer de l'état de la page avant et après une étape en
échec. Conserver tout l'historique visuel d'une session ferait exploser l'empreinte disque.

## Décision

**Tampon glissant** : instantanés DOM allégés systématiques, captures d'écran conservées
pour les N dernières étapes (défaut : 10) et systématiquement pour toute étape en échec.

## Justification

Le pouvoir diagnostique se concentre sur les étapes récentes et sur les échecs. Au-delà, une
capture d'écran est un coût de stockage sans usage.

## Alternatives écartées

| Alternative | Motif de rejet |
|---|---|
| Capture systématique de toutes les étapes | Empreinte disque incompatible avec la cible de session |
| Aucune capture d'écran, DOM seul | Prive le diagnostic visuel des échecs d'origine graphique |
| HTML brut plutôt qu'instantané allégé | Volume et bruit ; l'arbre d'accessibilité porte l'essentiel du pouvoir diagnostique |

## Conséquences

- Format de l'instantané allégé à arbitrer entre volume et pouvoir diagnostique (I-06).
- La politique de rétention est configurable par session.
