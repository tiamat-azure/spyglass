# Protocole de mesure — objectifs de qualité non contractuels (PRD §2.2)

Les cibles **> 95 %** de rejeu sans IA sur site inchangé à J+1 et **> 80 %** avec
rattrapage IA sur site modifié **orientent la conception**. Elles ne sont pas
opposables en v1. Lot 6 publie le protocole, le corpus, et les premiers taux
mesurés.

## Corpus

Dix sites **publics**, sans authentification, choisis pour la stabilité de
l'infrastructure (domaines d'exemple IANA, organismes de standards) plutôt que
pour un parcours métier. La liste canonique est
[`corpus.json`](corpus.json) / `PUBLIC_CORPUS` dans `@spyglass/runner`.

Un **corpus local immuable** de 10 pages (`/site-01` … `/site-10`, servi par
`startFixtureServer`) valide le même protocole en CI **sans réseau sortant et
sans clés d'API**.

`w3.org` n'expose pas « W3C » dans le `innerText` du `body` (titre / meta
seulement). Pour cet hôte, l'étape 1 est `elementVisible` sur `body`
(`requireText: false`) plus `urlMatches` exact.

## Vague J+0

1. Pour chaque site, scénario smoke : `startUrl` → `wait` body/h1 →
   `textPresent` (marqueur) → `urlMatches` (URL exacte, pas un glob universel).
2. Exécuter le **script généré** (ou `runScenario` sans driver) en `--headless --no-ai`.
3. Succès = code 0, toutes les étapes `mode=script`.
4. Enregistrer `docs/lot-6/measured-rates.json` (vague `J+0` ou `local-immutable`).

## Vague J+1

Rejouer **le même** `scenario.json` au plus tôt 24 h après J+0, mêmes flags,
sans régénérer les sélecteurs. Le taux « site inchangé sans IA » est
`passed / 10` sur cette vague.

Commande :

```bash
pnpm --filter @spyglass/runner measure-corpus
# live public (réseau requis) :
pnpm --filter @spyglass/runner exec node src/corpus-cli.ts --public --j1 --out docs/lot-6/measured-rates.j1.json
```

CI utilise le corpus local (`measure-corpus` sans `--public`).

## Site modifié + rattrapage IA (cible 80 %)

Les sites publics ne sont **pas** dégradés. La mesure « site modifié » utilise
le fixture Lot 6 / Lot 1 : sélecteur cassé, `--ai` ou mock
`SPYGLASS_LLM_TRANSPORT=mock`, patch suggéré `applied: false` (Lot 5, F-57).
Cette vague n'est pas un taux sur le corpus public.

## Hors périmètre

- Latence d'interaction embarquée < 50 ms (mesure UX, pas ce protocole).
- Application automatique de patchs (Lot 7 / F-62–F-65).
- Clés d'API en CI pour le chemin `--no-ai`.
