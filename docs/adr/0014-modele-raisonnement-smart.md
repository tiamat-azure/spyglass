# ADR-0014 - Modèle du profil `smart`, raisonnement (D-14)

**Statut** : actée. **Exigences liées** : F-52, F-60, F-61, F-74, 6.8, section 7.

## Contexte

Le profil `smart` porte le dialogue de chat, le raffinement de l'artefact et le rattrapage à
l'exécution supervisée. Le diagnostic d'un échec d'étape gagne à disposer de la capture
d'écran associée.

## Décision

**Claude Sonnet** comme valeur par défaut, librement reconfigurable (F-29).
**Multimodalité attendue mais non obligatoire** (F-61). Le rattrapage IA est réservé à
l'**exécution supervisée** : désactivé par défaut en intégration continue (F-60).

## Justification

- Retenir la même famille que le profil `fast` évite une seconde clé, un second SDK et une
  seconde facturation, tout en apportant la multimodalité native requise par le diagnostic
  visuel et un support de première classe dans Stagehand.
- Multimodalité non obligatoire : un modèle texte seul reste utilisable, au prix d'un
  diagnostic dégradé sur les échecs d'origine visuelle (élément masqué, superposé, hors
  écran, rendu de façon inattendue). Imposer la multimodalité fermerait la porte aux modèles
  auto-hébergés.
- Désactivation en CI : un rattrapage IA en CI transformerait une régression en succès
  silencieux et introduirait une dépendance à une clé d'API dans le pipeline.

## Alternative documentée

Le rattrapage n'étant pas requis en intégration continue (F-60), le profil `smart` n'a pas
besoin d'être joignable depuis un runner distant. **Un modèle hébergé sur un réseau privé
peut donc assurer l'intégralité de ce profil en usage local**, au prix de la multimodalité
si le modèle en est dépourvu. Cette configuration est pertinente lorsque le parcours
enregistré porte sur une application interne sensible, et constitue le point d'ancrage d'une
mise en conformité de souveraineté (ADR-0015).

## Conséquences

- Le client LLM détecte la capacité multimodale et émet un avertissement non bloquant.
- Le script généré ne requiert aucune clé d'API en CI.
- Version exacte du modèle à figer au lot 4, après évaluation (I-05).
