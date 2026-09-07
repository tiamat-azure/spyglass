# ADR-0005 - Transport audio depuis le processus principal (D-05)

**Statut** : actée. **Exigences liées** : F-30 à F-32, 6.7, 9.

## Contexte

La capture audio a lieu dans le processus de rendu, qui charge par ailleurs du contenu
d'interface. Le moteur de transcription s'exécute en processus enfant.

## Décision

L'audio transite par **IPC** vers le processus principal, qui seul relaie vers le moteur de
transcription par **WebSocket sur `localhost`**. Le renderer n'ouvre jamais de socket
sortante.

## Justification

Isolation stricte du canal audio : un renderer sans capacité de socket sortante ne peut
pas, même compromis, exfiltrer un flux audio. La garantie devient structurelle plutôt que
déclarative.

## Alternatives écartées

| Alternative | Motif de rejet |
|---|---|
| WebSocket ouverte depuis le renderer | Canal de sortie audio possible depuis le processus le plus exposé |
| Écriture de fichiers audio intermédiaires | Latence incompatible avec le pseudo-streaming, résidus sur disque |

## Conséquences

- Surcoût d'un saut IPC par trame audio, négligeable en PCM 16 kHz mono.
- La vérification de sécurité se réduit à un contrôle de politique réseau du renderer.
