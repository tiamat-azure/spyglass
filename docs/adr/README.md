# Décisions d'architecture (ADR)

Registre des arbitrages structurants de Spyglass. Le [PRD](../../PRD.md) porte le **quoi**
et le **comment normatif** ; les ADR portent le **pourquoi**, les alternatives écartées et
les conséquences.

Règle : une exigence du PRD ne répète jamais une justification d'ADR, elle la référence.

| ADR | Décision | Choix retenu | Statut |
|---|---|---|---|
| [0001](0001-coquille-electron.md) | D-01 Technologie de la coquille | Electron, vue navigateur native embarquée | Actée |
| [0002](0002-rattachement-stagehand-cdp.md) | D-02 Rattachement de Stagehand | Connexion CDP à la vue affichée | Actée |
| [0003](0003-strategie-llm-deux-profils.md) | D-03 Stratégie LLM | Deux profils distincts `fast` et `smart` | Actée |
| [0004](0004-transcription-vocale-locale.md) | D-04 Transcription vocale | Locale, sans appel réseau | Actée |
| [0005](0005-transport-audio-main.md) | D-05 Transport audio | WebSocket depuis le processus principal | Actée |
| [0006](0006-format-script-genere.md) | D-06 Format du script généré | Hybride : JSON source de vérité + moteur en librairie | Actée |
| [0007](0007-verification-etape.md) | D-07 Vérification d'étape | Heuristique proposée, validation groupée au raffinement | Actée |
| [0008](0008-auto-reparation.md) | D-08 Auto-réparation | Proposition en v1, application assistée au lot 7 | Actée |
| [0009](0009-frames-et-shadow-dom.md) | D-09 Frames et shadow DOM | Support complet dès le lot 1 | Actée |
| [0010](0010-popup-et-nouvel-onglet.md) | D-10 Popup et nouvel onglet | Redirection dans la page courante | Actée sous hypothèse (lot 0 bis) |
| [0011](0011-retention-des-captures.md) | D-11 Rétention des captures | Tampon glissant | Actée |
| [0012](0012-modele-narration-fast.md) | D-12 Modèle de narration | Fournisseur distant, Claude Haiku par défaut | Actée |
| [0013](0013-moteur-transcription-whisper-cpp.md) | D-13 Moteur de transcription | `whisper.cpp`, modèle `small` quantifié embarqué | Actée |
| [0014](0014-modele-raisonnement-smart.md) | D-14 Modèle de raisonnement | Claude Sonnet par défaut, multimodalité attendue | Actée |
| [0015](0015-souverainete-des-donnees.md) | D-15 Souveraineté des données | Aucune contrainte en v1, révisable | Actée |
| [0016](0016-plafonnement-en-tokens.md) | D-16 Unité de plafonnement | Le token, jamais la devise | Actée |
| [0017](0017-montee-precision-transcription.md) | D-17 Montée en précision STT | `large-v3-turbo` en téléchargement optionnel | Actée |

## Gabarit

Chaque ADR suit la même structure : Contexte, Décision, Justification, Alternatives
écartées, Conséquences, Exigences liées.
