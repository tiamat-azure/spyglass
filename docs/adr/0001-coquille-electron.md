# ADR-0001 - Technologie de la coquille applicative (D-01)

**Statut** : actée. **Exigences liées** : F-01 à F-07, 6.3, 9.

## Contexte

Spyglass affiche une page web tierce dans laquelle l'humain interagit nativement, tout en
laissant un agent piloter cette même page. La latence d'interaction et la fidélité de la
saisie clavier sont au cœur de la valeur produit.

## Décision

Application **Electron**. Le navigateur de la zone gauche est une `WebContentsView`
Chromium réelle.

## Justification

Electron embarque un Chromium maîtrisé exposant CDP, condition nécessaire au pilotage
Stagehand de la vue affichée (ADR-0002).

## Alternatives écartées

| Alternative | Motif de rejet |
|---|---|
| Tauri | Sa WebView système (WebKit sous Linux et macOS) n'expose pas de protocole de débogage compatible |
| Application web avec streaming CDP | Latence d'interaction de 80 à 200 ms et fragilité de la saisie clavier, qui dégraderaient le cœur du produit |

## Conséquences

- Poids d'installeur significatif, aggravé par le modèle de transcription embarqué (ADR-0013).
- Contraintes de sécurité obligatoires : `contextIsolation` activé, `nodeIntegration`
  désactivé, `sandbox` actif, IPC typé et explicitement exposé.
