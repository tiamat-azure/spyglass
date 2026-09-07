# Contrats de prompt

Trois usages, trois contrats. Chacun impose une **sortie structurée validée** : une réponse
non conforme est rejetée et traitée comme une indisponibilité du profil, jamais interprétée
partiellement.

## 1. Narration (profil `fast`, lot 2)

**Entrée.** Un lot d'événements expurgés (6.9), fenêtre de `LLM_FAST_BATCH_MS`.

```jsonc
{ "locale": "fr", "events": [ { "id": "evt_000123", "kind": "dom.click",
  "target": { "role": "button", "accessibleName": "Se connecter", "text": "Se connecter" },
  "page": { "url": "https://exemple.fr/login", "title": "Connexion" } } ] }
```

**Sortie attendue.**

```jsonc
{ "narrations": [ { "id": "evt_000123", "text": "Tu as cliqué sur le bouton Se connecter" } ] }
```

**Règles.**
- Une phrase par événement, à la deuxième personne, au passé composé, sans jargon technique.
- Aucun `id` inconnu, aucun `id` manquant : la réponse est rejetée si l'ensemble diffère.
- Jamais de valeur de champ, jamais d'URL complète dans le texte narratif.
- En cas de rejet, de dépassement de `LLM_FAST_TIMEOUT_MS` ou d'erreur : le gabarit
  déterministe déjà affiché reste en place (F-21, F-23).

## 2. Raffinement (profil `smart`, lot 4)

**Entrée.** L'artefact brut expurgé, les segments vocaux corrélés, le niveau d'agressivité.

**Sortie attendue.** Un tableau d'objets conformes à
[`refined-step.schema.json`](schemas/refined-step.schema.json), validé avant persistance.

**Règles.**
- L'`intent` provient d'un segment vocal lorsqu'il en existe un corrélé ; à défaut, il est
  déduit de l'action et la vérification associée est nécessairement `weak`.
- Toute étape porte au moins une `verification` (F-44).
- `sourceEvents` est obligatoire et doit ne référencer que des `id` réellement présents dans
  `raw.jsonl` : la traçabilité amont est vérifiée mécaniquement, pas seulement demandée.
- Les événements rétractés (`step.retracted`) sont exclus de l'entrée.

## 3. Rattrapage (profil `smart`, lot 5)

**Entrée.** Scénario complet, étape en échec avec son `intent`, DOM allégé avant et après,
capture d'écran si le modèle est multimodal (F-61), message d'erreur.

**Sortie attendue.**

```jsonc
{ "diagnosis": "Le bouton a changé d'identifiant, son rôle et son nom accessible sont inchangés",
  "patch": { "scope": "action.descriptor", "descriptor": { "type": "click", "selector": "…" } },
  "confidence": 0.0 }
```

**Règles.**
- `scope` ne peut valoir que `action.descriptor`. **Toute autre valeur est rejetée par le
  code, pas par le prompt** : l'invariant F-62 n'est jamais confié au modèle.
- Le modèle peut décrire un écart de vérification ou de structure dans `diagnosis`, mais ne
  peut produire aucun patch correspondant.
- Le patch est écrit dans `runs/<runId>/suggested-patch.json`, jamais appliqué (6.13).

## Règle transverse

Aucun prompt ne reçoit de secret, de jeton, de cookie, de valeur masquée ni de flux audio.
Le filtre d'expurgation (6.9) est le seul point de passage, et il est en amont du client LLM,
pas dans la construction du prompt.
