# PRD - Spyglass

Enregistreur de scénarios de navigation web assisté par IA, propulsé par Stagehand.

| Champ | Valeur |
|---|---|
| Produit | Spyglass |
| Version du document | 1.3 (arbitrages tranchés, contrats techniques et socle d'outillage actés) |
| Périmètre v1 | Lots -1 à 6. Le lot 7 constitue la v1.1 |
| Statut | Cadrage complet. **16 décisions fermes, 1 conditionnelle (D-10)**. Contrats techniques (§15) et socle d'outillage (§16) actés. Prêt pour le lancement du lot -1 |
| Décisions d'architecture | `docs/adr/` (ADR-0001 à ADR-0017), index en section 10 |
| Dernière mise à jour | 2026-09-07 |

---

## 1. Contexte et problème

Créer et maintenir des scénarios de navigation automatisés (tests E2E, robots métier, RPA
web) coûte cher : il faut traduire manuellement un parcours humain en code, puis le
maintenir à chaque changement d'interface. À l'inverse, les agents IA qui pilotent un
navigateur en autonomie sont lents, coûteux en tokens et non déterministes, donc
inadaptés à une exécution répétée en production.

Spyglass propose une troisième voie : **l'humain joue le scénario une fois**, un agent IA
observe et documente en direct, et le produit final est un **script déterministe** dont
l'IA n'est sollicitée qu'en **rattrapage**, lorsqu'une étape échoue.

## 2. Objectifs

### 2.1 Objectifs produit

1. Enregistrer en direct un parcours web réalisé par un humain dans un navigateur
   embarqué, sans instrumentation préalable du site cible.
2. Faire commenter ce parcours par un agent IA, en langage naturel, au fil de l'eau, dans
   un chat synchronisé avec la page.
3. Permettre à l'utilisateur de dicter vocalement son intention avant ou après chaque
   action, pour enrichir le scénario d'une couche sémantique.
4. Produire un artefact brut traçable, puis un artefact raffiné exploitable.
5. Générer un script d'exécution autonome, déterministe par défaut, avec rattrapage IA
   en exécution supervisée.

### 2.2 Indicateurs de succès

**Indicateurs contractuels**, mesurés et vérifiés par les critères d'acceptation (section 14) :

| Indicateur | Cible | Vérifié par |
|---|---|---|
| Temps de création d'un scénario de 10 étapes | < 5 minutes, saisie vocale comprise | CA-01 |
| Latence d'apparition d'une étape dans le chat | < 200 ms, gabarit déterministe local | CA-04 |
| Latence d'enrichissement LLM d'une étape déjà affichée | < 2 s p95, mise en lot comprise | CA-04 |
| Consommation de narration | < 600 tokens par étape, entrée et sortie cumulées, soit < 30 000 tokens sur une session nominale de 50 étapes | CA-04 |
| Latence de transcription vocale (segment final) | < 2 s après fin d'énoncé, hors ligne | CA-01 |
| Empreinte disque d'une session de 50 étapes | < 10 Mo, **hors audio** (non conservé par défaut, voir F-49) | CA-09 |

**Objectifs de qualité non contractuels.** Ils orientent la conception mais ne sont pas
opposables en v1, faute de corpus de référence et de protocole de mesure établis. Un
protocole (corpus de 10 sites publics, mesure à J+1) est à définir au lot 6.

| Objectif | Cible visée |
|---|---|
| Taux de rejeu réussi sans IA, sur site inchangé (J+1) | > 95 % |
| Taux de rejeu réussi avec rattrapage IA, sur site modifié | > 80 % |
| Latence perçue d'interaction dans le navigateur embarqué | < 50 ms, indiscernable d'un navigateur natif |

### 2.3 Non-objectifs (hors périmètre v1)

- Gestion multi-onglets, multi-fenêtres et popups (une seule page active, voir D-10).
- Enregistrement multi-utilisateurs ou collaboratif temps réel.
- Exécution distribuée, parc de navigateurs, grille de test.
- Dépendance à Browserbase ou à toute infrastructure de navigateur hébergée.
- Édition visuelle avancée du scénario (éditeur graphique de steps).
- Support mobile ou applications natives.
- Shadow DOM fermé (`mode: 'closed'`), non observable par conception.
- Fonctionnement entièrement hors ligne : la narration requiert un accès réseau (D-12).
- Rattrapage IA actif par défaut en intégration continue : il reste activable
  explicitement, mais n'est jamais implicite hors exécution supervisée (D-14).
- Application automatique et non revue des correctifs d'auto-réparation (D-08).
- **Distribution signée et notariée** : la v1 est à usage interne, les installeurs ne sont ni
  signés ni notariés (16.3). Toute diffusion en entreprise l'exigera, avec un délai
  d'obtention de certificats à anticiper.

## 3. Personas

| Persona | Besoin | Compétence technique |
|---|---|---|
| **Quality engineer** | Transformer un parcours de recette en test E2E maintenable | Moyenne à élevée |
| **Expert métier** | Décrire un processus web répétitif pour qu'il soit automatisé | Faible |
| **Automaticien / RPA** | Obtenir un script robuste et paramétrable, exécutable en CI | Élevée |

## 4. Parcours utilisateur cible

1. L'utilisateur lance Spyglass. L'écran se découpe en deux : navigateur à gauche (3/4),
   chat à droite (1/4).
2. Il saisit une URL de départ, la page s'affiche, la barre d'URL reflète l'état courant.
3. Il clique sur **Record**. Le bouton devient **Stop**. La session d'enregistrement
   démarre.
4. Il active le micro et dit : « Je vais me connecter avec le compte de démonstration ».
   La dictée apparaît dans le chat comme message utilisateur, transcrite localement.
5. Il navigue normalement : clics, saisies, soumissions de formulaires. Chaque
   interaction remonte dans le chat sous forme de message de l'agent, en langage naturel,
   accompagné du descripteur DOM technique.
6. Il sélectionne un texte à l'écran et indique vocalement « ce montant doit être vérifié
   à cette étape » : une assertion est proposée par l'agent.
7. Il clique sur **Stop**. L'artefact brut est figé et persisté.
8. Il clique sur **Raffiner**. L'agent produit un scénario nettoyé, ordonné, où chaque
   étape associe intention en langage naturel, action technique et critère de
   vérification. Les vérifications jugées faibles sont signalées pour confirmation.
9. Il relit, confirme les vérifications faibles, corrige dans le chat si besoin, puis
   clique sur **Générer le script**.
10. Il obtient un script exécutable, lançable en mode visible par défaut ou en
    `--headless`.

## 5. Exigences fonctionnelles

Priorités : **P0** indispensable v1, **P1** important, **P2** souhaitable.

### 5.1 Coquille applicative et navigateur embarqué

| ID | Exigence | Priorité |
|---|---|---|
| F-01 | Fenêtre unique découpée en deux zones : navigateur (75 % de largeur) et chat (25 %). Séparateur redimensionnable, ratio par défaut restauré au lancement. | P0 |
| F-02 | Barre d'adresse affichant l'URL de la page courante, mise à jour à chaque navigation, y compris les navigations côté client (History API). | P0 |
| F-03 | Contrôles de navigation : précédent, suivant, recharger, aller à l'URL saisie. | P0 |
| F-04 | Une seule page active. Toute tentative d'ouverture d'onglet ou de fenêtre (`target=_blank`, `window.open`) est redirigée dans la page courante et journalisée comme événement `nav.popup-redirected`. | P0 |
| F-05 | Indicateur d'état de chargement de la page. | P1 |
| F-06 | Persistance du profil navigateur (cookies, stockage local) entre les sessions, avec commande de réinitialisation. | P1 |
| F-07 | Indicateur visuel non intrusif signalant que l'enregistrement est actif (bordure ou pastille). | P1 |

### 5.2 Enregistrement

**Définition.** Une **étape de capture** est un événement d'action utilisateur retenu après
débruitage (F-16). Elle porte un `stepIndex` monotone, attribué à la capture, auquel sont
rattachés instantanés et captures d'écran. Elle est distincte de l'**étape raffinée**
(F-41), qui résulte du raffinement et peut agréger ou écarter plusieurs étapes de capture.

| ID | Exigence | Priorité |
|---|---|---|
| F-10 | Bouton unique **Record** / **Stop**, libellé et style mis à jour dynamiquement selon l'état. | P0 |
| F-11 | Capture des interactions utilisateur : clic, double-clic, saisie de champ, changement de sélection, case à cocher, bouton radio, soumission de formulaire, appui sur touche significative (Entrée, Échap, Tab), défilement au-delà de `SCROLL_THRESHOLD_PX`. Le survol conduisant à l'ouverture d'un menu est **hors périmètre v1** : aucune heuristique fiable n'est spécifiable, le menu ouvert est de toute façon capturé par le clic qui suit. | P0 |
| F-12 | Capture des événements de navigation : chargement de page, navigation client, redirection, retour arrière, requête réseau signifiante, définie comme un appel XHR ou `fetch` émis dans les `NET_CORRELATION_MS` suivant une action utilisateur capturée. | P0 |
| F-13 | Pour chaque événement, production d'un descripteur d'élément multi-stratégies : `id`, `data-testid` et attributs de test, rôle et nom accessible ARIA, texte visible, `name`, balise, sélecteur CSS unique, XPath, index parmi les frères, ancêtres significatifs, **chemin de frames** et **chemin de shadow roots ouverts**. | P0 |
| F-14 | Capture des sélections de texte et lectures de champ, pour permettre la création d'assertions de vérification. | P0 |
| F-15 | Masquage automatique des valeurs sensibles : champs `type=password`, champs marqués `autocomplete` de type carte bancaire, motifs configurables. La valeur n'est jamais persistée en clair, elle est remplacée par une référence de secret. | P0 |
| F-16 | Anti-bruit à la capture : agrégation des frappes clavier d'un même champ en un seul événement de saisie après `INPUT_AGGREGATION_MS` d'inactivité ou perte de focus, déduplication des événements redondants (`click` + `change` sur le même contrôle), seuil de défilement `SCROLL_THRESHOLD_PX`. | P0 |
| F-17 | Capture d'**un seul instantané DOM allégé par étape de capture** : l'état « avant » de l'étape N est l'état « après » de l'étape N-1. Un instantané supplémentaire n'est produit que si le DOM a muté sans action utilisateur depuis le dernier (chargement asynchrone). Capture d'écran selon la politique de rétention définie en 6.11. | P0 |
| F-18 | Pause et reprise d'enregistrement sans clôturer la session. | P2 |
| F-19 | **Rétractation** d'une étape depuis le chat pendant l'enregistrement : un événement `step.retracted` référençant l'étape visée est **ajouté** au journal. Rien n'est jamais retiré de l'artefact brut (F-40) ; le chat masque l'étape et le raffinement ignore les étapes rétractées. | P1 |

### 5.3 Agent IA observateur

| ID | Exigence | Priorité |
|---|---|---|
| F-20 | L'agent est connecté à l'instance Stagehand pilotant la page affichée et reçoit chaque événement capturé. | P0 |
| F-21 | Pour chaque événement, le chat publie **immédiatement** un message en gabarit déterministe local, assorti d'un bloc technique repliable contenant le descripteur DOM. Ce message est **remplacé en place** par la narration LLM lorsqu'elle arrive (« Tu as cliqué sur le bouton *Se connecter* »). L'affichage n'attend jamais le réseau. | P0 |
| F-22 | L'agent associe à chaque action un **descripteur d'action rejouable construit localement par la sonde** à partir de F-13, dans un format compatible `ObserveResult` Stagehand. Sa construction ne déclenche **aucun appel LLM** et reste opérationnelle hors ligne. `observe()` n'est invoqué qu'en rattrapage (F-52), sur le profil `smart`. | P0 |
| F-23 | Le gabarit déterministe est l'**état de base** de la narration (F-21), la narration LLM en étant l'enrichissement. En cas de perte réseau, d'erreur du fournisseur, de dépassement du budget de latence ou d'atteinte du plafond de session, l'enrichissement est simplement suspendu : le chat reste complet, la bascule est signalée et journalisée dans `narration.mode`. | P0 |
| F-24 | La narration est mise en lot : les événements sont regroupés sur une fenêtre glissante (défaut : 500 ms) et narrés en un seul appel, afin de borner le coût et le nombre de requêtes. | P0 |
| F-25 | L'utilisateur peut dialoguer avec l'agent pendant l'enregistrement : poser une question sur la page, demander une correction d'étape, demander l'ajout d'une assertion. | P1 |
| F-26 | L'agent propose un critère de vérification pour chaque étape, qualifié `strong` ou `weak` (voir F-44). | P0 |
| F-27 | Le chat est synchronisé avec l'état de la page : chaque message d'étape est lié à l'URL et à l'instantané correspondants, et cliquer sur un message permet d'en visualiser le contexte. | P1 |
| F-28 | Compteur de consommation visible, exprimé en **tokens** : nombre d'appels, tokens d'entrée et de sortie cumulés par profil, rapportés au plafond configuré. Une estimation en devise est affichée **en complément et à titre purement indicatif**. | P0 |
| F-29 | Le fournisseur, le modèle, la clé d'API et le point d'entrée de chaque profil sont configurables par l'utilisateur depuis l'interface, sans redémarrage, avec test de connexion. Les valeurs par défaut sont proposées, jamais imposées. Les réglages sont persistés dans `settings.json` et les clés d'API **chiffrées via `safeStorage` d'Electron**, jamais en clair (précédence de configuration : section 7). | P0 |

### 5.4 Mode voix

| ID | Exigence | Priorité |
|---|---|---|
| F-30 | Bouton micro activant la dictée. Deux modes : maintien pour parler, ou dictée continue avec détection d'activité vocale. | P0 |
| F-31 | Transcription en flux, avec affichage des segments partiels puis consolidation en segment final dans le chat. | P0 |
| F-32 | Chaque segment transcrit est horodaté et corrélé temporellement aux événements DOM voisins, afin de distinguer intention *avant* action et commentaire *après* action. | P0 |
| F-33 | Édition manuelle possible d'un segment transcrit dans le chat. | P1 |
| F-34 | Moteur de transcription **local et embarqué dans l'application**, sans appel réseau et sans installation tierce à la charge de l'utilisateur. Aucun flux audio ne quitte la machine. | P0 |
| F-35 | Indicateur de niveau sonore et d'état du micro. | P2 |
| F-36 | Commandes vocales réservées (« début d'étape », « vérifier que », « annuler la dernière étape »), reconnues comme instructions et non comme narration. | P2 |
| F-37 | La dictée reste pleinement fonctionnelle en l'absence de réseau, y compris lorsque la narration est en mode dégradé. | P0 |
| F-38 | Montée en précision proposée **contextuellement** : lorsque l'utilisateur a corrigé manuellement un nombre configurable de segments transcrits, l'application propose le téléchargement du modèle plus précis. La proposition reste refusable définitivement. (ADR-0017) | P2 |
| F-39 | Les deux modèles de transcription coexistent après montée en précision. Le modèle `small` n'est jamais supprimé et sert de repli automatique si le modèle plus lourd dépasse le budget de latence mesuré sur la machine au premier usage. Le cache des modèles réside dans le répertoire de données applicatives standard de la plateforme, surchargeable par configuration. | P2 |

### 5.5 Artefacts

| ID | Exigence | Priorité |
|---|---|---|
| F-40 | **Artefact brut** : journal horodaté, append-only, immuable, contenant tous les événements DOM, tous les segments vocaux, tous les messages de l'agent et toutes les captures. Conservé intégralement à des fins de traçabilité. | P0 |
| F-41 | **Artefact raffiné** : scénario structuré, produit par l'agent à partir de l'artefact brut, avec suppression du bruit, fusion des répétitions, ordonnancement canonique « intention utilisateur en langage naturel » puis « action technique » puis « vérification ». | P0 |
| F-42 | Le raffinement ne modifie jamais l'artefact brut. Le raffiné référence les identifiants d'événements bruts dont il est issu (traçabilité amont). | P0 |
| F-43 | Le raffinement est relançable et paramétrable (niveau d'agressivité du nettoyage), et son résultat est éditable manuellement avant génération. | P1 |
| F-44 | Chaque étape raffinée porte obligatoirement au moins un critère de vérification, qualifié `strong` (déduit d'une intention explicite ou d'une assertion utilisateur) ou `weak` (déduit d'une heuristique). La finalisation du scénario est **bloquée** tant qu'il subsiste une vérification `weak` non confirmée par l'utilisateur. | P0 |
| F-44b | Les vérifications `weak` sont présentées en deux groupes. Les **routinières** (changement d'état observable : URL modifiée, élément attendu apparu après l'action) sont listées intégralement puis confirmables **en un seul geste**. Les **douteuses** (aucun changement observable, cible ambiguë, assertion portant sur une valeur) sont confirmables **une par une exclusivement**. Le blocage de F-44 est intégralement conservé : il porte sur le geste de confirmation, jamais sur le nombre d'étapes. La liste complète reste affichée avant tout geste groupé. | P0 |
| F-45 | **Artefact exécutable** : script autonome rejouant le scénario. Mode visible par défaut, mode `--headless` par paramètre. | P0 |
| F-46 | Versionnage des artefacts : chaque session porte un identifiant, chaque raffinement une révision. | P1 |
| F-47 | Export et import d'une session complète sous forme de dossier autonome. | P1 |
| F-48 | Paramétrage du scénario : les valeurs saisies et les secrets sont extraits en variables du script. | P1 |
| F-49 | **Rétention audio** : par défaut (`AUDIO_RETENTION=none`), aucun flux audio n'est persisté sur disque, seules les transcriptions horodatées le sont. Les modes `corrected` (audio des seuls segments corrigés manuellement) et `all` sont activables explicitement. L'audio, lorsqu'il est conservé, ne quitte jamais la machine et est purgé avec la session. | P0 |

### 5.6 Exécution du scénario

| ID | Exigence | Priorité |
|---|---|---|
| F-50 | Exécution déterministe par défaut, sans appel LLM : chaque étape est rejouée à partir du descripteur d'action mis en cache. | P0 |
| F-51 | Vérification obligatoire de la réussite après chaque étape. Le passage à l'étape suivante n'a lieu qu'en cas de vérification réussie. | P0 |
| F-52 | En cas d'échec de vérification d'une étape, bascule en **mode rattrapage IA**. L'assistant reçoit en entrée : le scénario complet, l'étape en échec avec son intention en langage naturel, l'état DOM avant la dernière étape, l'état DOM après l'échec, la capture d'écran associée (sous réserve de F-61) et le message d'erreur. | P0 |
| F-53 | L'assistant tente d'atteindre l'objectif de l'étape via Stagehand, dans la limite d'un nombre maximal de tentatives configurable (défaut : 3). | P0 |
| F-54 | En cas de réussite du rattrapage, l'exécution reprend en mode déterministe à partir de l'étape suivante. | P0 |
| F-55 | En cas d'échec après le nombre maximal de tentatives, arrêt du scénario, code de sortie non nul, rapport d'erreur détaillé. | P0 |
| F-56 | Rapport d'exécution : statut par étape, durée, mode utilisé (script ou IA), nombre de tentatives, captures d'écran des échecs. | P1 |
| F-57 | Lorsqu'un rattrapage IA réussit, le nouveau descripteur d'action est écrit dans un patch suggéré, joint au rapport d'exécution. Son application est une action explicite de l'utilisateur, jamais automatique (voir 6.13). | P1 |
| F-58 | Paramètres d'exécution : `--headless`, `--base-url`, `--timeout`, `--max-ai-retries`, `--no-ai` (désactive tout rattrapage), `--ai` (le force), `--report`, `--trace`. | P0 |
| F-59 | Rejeu depuis Spyglass, dans le navigateur embarqué, avec suivi étape par étape dans le chat. | P1 |
| F-60 | Le rattrapage IA est une fonction d'exécution **supervisée**. En environnement d'intégration continue (détection de la variable `CI`), il est désactivé par défaut, équivalent à `--no-ai` : l'échec d'une étape produit un échec net et un rapport. Il reste activable explicitement par `--ai`. Le script généré ne requiert donc aucune clé d'API en CI. | P0 |
| F-61 | Le client LLM détecte la capacité multimodale du modèle configuré pour le profil `smart`. Si le modèle n'est pas multimodal, un avertissement **non bloquant** est affiché à la configuration et journalisé à chaque rattrapage : le diagnostic s'effectue alors sur le DOM textuel seul, sans capture d'écran. | P0 |
| F-62 | **Invariant d'auto-réparation** : seul le *descripteur d'action* peut faire l'objet d'une application assistée. Les critères de vérification et la structure du scénario (ajout, suppression, réordonnancement d'étapes) restent en proposition pure, définitivement. Cet invariant n'est pas configurable et ne comporte pas d'échappatoire. | P0 |
| F-63 | Un patch n'est promu à l'application qu'après confirmation par **2 exécutions consécutives** produisant le même descripteur corrigé. L'état de confirmation est porté par `health.json` (`patchCandidates[]` : `descriptorHash`, `consecutiveRuns`, `lastRunId`), **remis à zéro dès qu'une exécution produit un descripteur différent**. Un succès isolé est journalisé mais jamais promu, afin d'écarter les états transitoires du site (test A/B, cache, déploiement en cours). Seuil configurable. | P1 |
| F-64 | L'application d'un patch s'effectue sur une **branche git dédiée** et donne lieu à une **pull request**. Le dépôt visé est celui du **projet cible**, dans lequel les scénarios générés sont versionnés ; il est désigné par `--repo` et le runner refuse d'agir si l'arbre de travail n'est pas propre. Aucun commit n'est jamais produit sur la branche par défaut. La fusion requiert une **revue humaine explicite** : une CI verte ne vaut pas validation, le scénario modifié ne pouvant valider sa propre modification. | P1 |
| F-65 | Compteur de patchs cumulés par scénario. Au-delà de 3, le scénario est signalé **fragile** ; au-delà de 5, il est marqué **obsolète** et son ré-enregistrement est requis. Seuils configurables. | P1 |

### 5.7 Maîtrise de la consommation

| ID | Exigence | Priorité |
|---|---|---|
| F-70 | Le plafonnement s'exprime **en tokens**, jamais en devise. Le token est la seule unité mesurable localement, indépendante du fournisseur, du modèle et des évolutions tarifaires. | P0 |
| F-71 | Compteurs **séparés par profil**. Le profil `fast` est plafonné en cumul de session (disjoncteur temps réel). Le profil `smart`, dont un raffinement représente à lui seul un ordre de grandeur au-dessus de toute la narration, est encadré par opération et non par session. | P0 |
| F-72 | **Double seuil** sur le profil `fast` : avertissement dans le chat à 50 % du plafond, bascule en gabarits déterministes à 100 %. Le message de bascule est explicite et propose une action « relever le plafond » qui restaure la narration. L'enregistrement n'est jamais interrompu (F-40). | P0 |
| F-73 | **Seuil de débit** complémentaire : au-delà de 60 appels par minute, bascule immédiate en gabarits, sans attendre l'atteinte du plafond cumulé. Ce seuil détecte les pages à événements pathologiques (défilement infini, animations, boucles) avant accumulation. | P0 |
| F-74 | Toute opération du profil `smart` fait l'objet d'une **estimation de consommation en tokens affichée avant déclenchement**. Au-delà d'un seuil configurable, une confirmation explicite est requise. | P0 |
| F-75 | L'estimation en devise s'appuie sur une table de tarifs par modèle, versionnée et éditable. Elle est présentée comme indicative, la facturation du fournisseur faisant seule foi. Si le modèle configuré est absent de la table, seule la consommation en tokens est affichée, sans estimation monétaire ni message d'erreur. | P1 |

## 6. Architecture technique

> Les justifications, alternatives écartées et conséquences de chaque décision sont
> documentées en ADR dans `docs/adr/`. Cette section ne porte que le **comment normatif**.

### 6.1 Principes directeurs

- **Stagehand est le composant cœur**, en mode local strict : environnement local forcé,
  navigateur local, aucune dépendance à Browserbase (ADR-0002).
- **Aucune adhérence à un fournisseur LLM particulier** : le client LLM est une
  abstraction configurable par variables d'environnement et depuis l'interface (F-29). Les
  modèles par défaut sont des valeurs proposées, jamais des dépendances (ADR-0012, ADR-0014).
- **Déterminisme d'abord** : le LLM sert à comprendre, décrire et rattraper, jamais à
  exécuter le chemin nominal.
- **L'artefact brut est sacré** : append-only, jamais réécrit (F-40, F-42).
- **La voix ne sort jamais de la machine** : transcription locale et embarquée (ADR-0004).
- **Le texte envoyé aux modèles distants est expurgé par construction** : jamais de
  secret, jamais de jeton, jamais de valeur masquée (6.9).
- **Aucune fonction critique ne dépend du réseau** : la capture, la journalisation et la
  dictée restent opérationnelles hors ligne ; seule la qualité de narration se dégrade
  (F-23). Le raffinement et le rattrapage requièrent le réseau, mais interviennent hors du
  chemin critique de l'enregistrement.
- **L'IA ne réécrit jamais l'intention** : elle peut réparer le moyen d'atteindre une
  étape, jamais redéfinir ce qui est vérifié ni ce qui est parcouru (F-62).

### 6.2 Vue d'ensemble

```
┌──────────────────────────────────────────────────────────────┐
│  Electron - processus principal                              │
│  ┌────────────────────────────┬─────────────────────────────┐│
│  │  WebContentsView (75 %)    │  Vue chat (25 %)            ││
│  │  page réelle, interaction  │  messages agent + dictée    ││
│  │  humaine native            │  bouton Record / Stop       ││
│  └────────────────────────────┴─────────────────────────────┘│
│         │ CDP                              │ IPC              │
│  ┌──────▼──────────────┐        ┌──────────▼───────────────┐ │
│  │ Stagehand (local)   │        │ Orchestrateur de session │ │
│  │ act / observe /     │◄──────►│ machine à états          │ │
│  │ extract, Playwright │        │ bus d'événements         │ │
│  └─────────────────────┘        └────┬──────────┬──────────┘ │
│  ┌─────────────────────┐             │          │            │
│  │ Sonde DOM injectée  │─────────────┘          │            │
│  │ tous frames + shadow│  événements bruts      │            │
│  └─────────────────────┘                        │            │
│  ┌─────────────────────┐   ┌─────────────────┐  │            │
│  │ STT embarqué        │──►│ Client LLM      │◄─┘            │
│  │ sidecar, hors ligne │   │ fast / smart    │               │
│  └─────────────────────┘   └────────┬────────┘               │
│  ┌────────────────────────────────┐ │  réseau (clé d'API)    │
│  │ Magasin d'artefacts            │ ▼                        │
│  │ (brut / raffiné / script)      │ fournisseur LLM distant  │
│  └────────────────────────────────┘                          │
└──────────────────────────────────────────────────────────────┘
```

### 6.3 Coquille applicative (ADR-0001)

La coquille est une application Electron. Le navigateur affiché dans la zone gauche est
une `WebContentsView` Chromium réelle, occupant 75 % de la largeur, avec la vue chat en
interface de rendu classique sur les 25 % restants.

Contraintes de sécurité associées : `contextIsolation` activé, `nodeIntegration`
désactivé, `sandbox` actif sur la vue chargeant du contenu tiers, communication
exclusivement par canaux IPC typés et explicitement exposés.

### 6.4 Rattachement de Stagehand (ADR-0002)

Stagehand ne lance pas son propre navigateur. Le processus principal expose un port de
débogage distant, et Stagehand s'y connecte en CDP, en ciblant la `WebContentsView`
affichée.

Conséquences :

- L'humain et l'agent partagent exactement la même page. L'agent est intrinsèquement
  conscient de toute interaction utilisateur, sans rejeu ni synchronisation.
- `observe`, `act` et `extract` sont disponibles pendant et après l'enregistrement, sur
  la page réellement visible.
- Le rejeu depuis Spyglass (F-59) utilise le même canal, donc le même comportement qu'en
  enregistrement.
- Point d'implémentation ouvert : résolution et maintien de la liaison CDP (I-01).

### 6.5 Sonde DOM (ADR-0009)

Script injecté avant tout script de page, sur chaque document et chaque iframe, via CDP.
Responsabilités :

- Écoute en phase de capture des événements pertinents, sans jamais les intercepter ni
  les annuler.
- Construction du descripteur d'élément multi-stratégies (F-13), incluant le chemin de
  frames et la traversée des shadow roots ouverts.
- Agrégation et débruitage local (F-16).
- Émission vers le processus principal par liaison CDP dédiée, hors du canal réseau de la
  page, afin d'éviter toute interférence avec le site cible.
- Observation des mutations DOM et de l'History API pour détecter les navigations client.

Le support des frames et du shadow DOM ouvert est traité dès le lot 1 ; le shadow DOM
fermé reste hors périmètre (ADR-0009).

Contrainte forte : la sonde doit être **passive et invisible** pour le site cible. Aucune
modification du DOM, aucune variable globale exposée sous un nom devinable, aucun impact
mesurable sur les performances de la page.

### 6.6 Pipeline d'événements

```
Événement DOM brut
  → normalisation (type, cible, valeur, horodatage, contexte page)
  → masquage des secrets
  → débruitage / agrégation, attribution du stepIndex
  → construction du descripteur d'action rejouable   [LOCAL, sans LLM]
  → journalisation dans l'artefact brut (append-only) [SYNCHRONE]
  → rendu gabarit déterministe → affichage chat < 200 ms
  ────────── fin du chemin critique, 100 % local ──────────
  → mise en lot (fenêtre glissante de 500 ms)
  → narration distante, asynchrone
  → remplacement en place du message de chat
```

Tout ce qui précède la ligne de séparation est **local, synchrone et sans dépendance
réseau** : normalisation, descripteur rejouable (F-22), journalisation et affichage. La
narration distante n'est qu'un **enrichissement** appliqué a posteriori (F-21, F-23). Une
perte de connectivité, une erreur du fournisseur ou un dépassement de plafond laissent donc
le chat complet et l'artefact brut intact ; seule la qualité de formulation se dégrade.

### 6.7 Chaîne vocale (ADR-0004, ADR-0005, ADR-0013)

- Capture audio dans le processus de rendu, flux découpé en trames courtes, converti en
  PCM 16 kHz mono.
- Détection d'activité vocale locale pour ne transmettre que la parole utile et borner le
  coût de calcul.
- Transmission par IPC vers le processus principal, qui relaie vers le moteur de
  transcription par WebSocket sur `localhost`. Le renderer n'a jamais accès à une socket
  sortante, ce qui isole strictement l'audio.
- Moteur de transcription **embarqué dans le paquet applicatif** et exécuté en processus
  enfant. Aucune installation tierce, aucun appel réseau, fonctionnement hors ligne
  garanti.
- Pseudo-streaming par fenêtres glissantes : segments partiels toutes les 300 à 500 ms,
  segment final consolidé à la fin d'énoncé détectée par la détection d'activité vocale.
- Corrélation temporelle : chaque segment final est rattaché à la fenêtre d'événements
  DOM la plus proche, avec une marge configurable, pour produire l'association intention
  / action lors du raffinement.

Moteur retenu : **`whisper.cpp`**, modèle `small` multilingue quantifié, embarqué dans le
paquet applicatif, de l'ordre de 190 Mo (ADR-0013). Chemin d'évolution acté sans changement
d'architecture : `large-v3-turbo` quantifié, de l'ordre de 575 Mo, en téléchargement
optionnel après installation (ADR-0017, F-38, F-39).

### 6.8 Abstraction LLM (ADR-0003, ADR-0012, ADR-0014)

Un unique point d'entrée, avec deux profils de modèle, tous deux distants et authentifiés
par clé d'API :

| Profil | Usage | Contraintes |
|---|---|---|
| `fast` | Narration des événements en direct | Latence et coût unitaire prioritaires, appels mis en lot, qualité rédactionnelle en français suffisante |
| `smart` | Dialogue de chat, raffinement de l'artefact, rattrapage à l'exécution supervisée via Stagehand | Qualité et raisonnement prioritaires, **multimodalité attendue** pour le diagnostic visuel, latence tolérante, volume d'appels faible |

Modèles par défaut : **Claude Haiku** pour `fast`, **Claude Sonnet** pour `smart`. Ce ne
sont que des valeurs par défaut : fournisseur, modèle, clé d'API et point d'entrée sont
intégralement configurables par l'utilisateur (F-29). L'implémentation respecte donc une
interface indépendante du fournisseur, et aucune particularité propre à un fournisseur ne
doit remonter dans les couches supérieures.

La multimodalité est **attendue mais non obligatoire** (F-61). Un modèle texte seul reste
utilisable, au prix d'un diagnostic dégradé sur les échecs d'origine visuelle : élément
masqué, superposé, hors écran ou rendu de façon inattendue.

Les deux profils peuvent viser des fournisseurs distincts, y compris un modèle hébergé sur
un réseau privé pour le profil `smart` (ADR-0014). Toute indisponibilité du profil `smart`
bloque le raffinement et le rattrapage, mais jamais l'enregistrement ni la dictée.

Maîtrise de la consommation : le plafond est un **disjoncteur**, pas un budget. Seuils et
comportements normatifs en 5.7, justification en ADR-0016.

### 6.9 Expurgation avant transmission

Tout élément transmis à un profil distant traverse un filtre d'expurgation :

- Suppression des valeurs de champs masqués (F-15), remplacées par leur référence de
  secret.
- Suppression des cookies, en-têtes, jetons et paramètres d'URL identifiés comme
  sensibles.
- Troncature du texte visible à un volume borné par élément.
- Envoi du descripteur d'élément et du texte de libellé, jamais de l'instantané DOM
  complet en narration. L'instantané n'est transmis qu'au profil `smart`, en rattrapage,
  et sous forme allégée.

Le filtre est un point de passage unique, testé isolément, et son contournement est
impossible par construction dans le client LLM.

### 6.10 Modèle de données

**Événement brut** (une ligne par événement, format JSON Lines) :

```jsonc
{
  "id": "evt_000123",
  "sessionId": "ses_2026...",
  "ts": 1757200000123,
  "schemaVersion": 1,
  "kind": "dom.click",
  "stepIndex": 12,
  "pageId": "page_main",
  "page": { "url": "...", "title": "..." },
  "target": {
    "tag": "button",
    "id": "login-submit",
    "testId": "submit",
    "role": "button",
    "accessibleName": "Se connecter",
    "text": "Se connecter",
    "cssSelector": "...",
    "xpath": "...",
    "framePath": ["main", "#consent-iframe"],
    "shadowPath": ["my-widget", "#inner"]
  },
  "value": { "masked": true, "secretRef": "SECRET_PASSWORD" },
  "narration": { "mode": "llm | template", "batchId": "bat_00012" },
  "snapshotRef": "snap_000123",
  "screenshotRef": "shot_000123"
}
```

**Énumération `kind`**, exhaustive et figée au lot 1. Toute extension incrémente
`schemaVersion`, également porté par `meta.json`.

| Famille | Valeurs |
|---|---|
| Interaction | `dom.click`, `dom.dblclick`, `dom.input`, `dom.change`, `dom.check`, `dom.select`, `dom.submit`, `dom.key`, `dom.scroll` |
| Navigation | `nav.load`, `nav.spa`, `nav.redirect`, `nav.back`, `nav.forward`, `nav.popup-redirected`, `net.request` |
| Sélection | `selection.text`, `selection.value` |
| Voix | `voice.partial`, `voice.final`, `voice.edited` |
| Chat et agent | `agent.message`, `agent.narration-mode`, `user.message` |
| Contrôle de session | `record.start`, `record.pause`, `record.resume`, `record.stop`, `step.retracted` |

`pageId` est présent dès la v1 bien qu'une seule page soit gérée : il rend le support
ultérieur d'une popup additif plutôt que structurant (D-10). `stepIndex` rattache
l'événement à son étape de capture (5.2). `narration.mode` trace si la description provient
du modèle distant ou du gabarit déterministe.

**Étape raffinée** :

```jsonc
{
  "index": 3,
  "intent": "Je me connecte avec le compte de démonstration",
  "action": {
    "type": "click | fill | select | press | navigate | wait",
    "descriptor": { "...": "descripteur Stagehand rejouable" },
    "fallbackSelectors": ["...", "..."]
  },
  "verification": {
    "type": "urlMatches | elementVisible | textPresent | valueEquals",
    "expected": "...",
    "strength": "strong | weak",
    "confirmedByUser": true,
    "timeoutMs": 10000
  },
  "sourceEvents": ["evt_000121", "evt_000123", "evt_000124"],
  "patchHistory": [
    { "runId": "run_0007", "date": "...", "scope": "action.descriptor", "reviewedBy": "..." }
  ]
}
```

Le champ `patchHistory` n'admet que la valeur `action.descriptor` en `scope`, par
application de l'invariant F-62. Il alimente le compteur de fragilité du scénario (F-65).

### 6.11 Rétention des instantanés et captures (ADR-0011)

- **Un instantané DOM allégé par étape de capture** (F-17) : arbre d'accessibilité et
  éléments interactifs uniquement, jamais le HTML brut. Cible de 20 à 50 Ko par instantané.
  L'état « avant » d'une étape est l'instantané de l'étape précédente ; un instantané
  supplémentaire n'est produit qu'en cas de mutation du DOM sans action utilisateur.
- **Captures d'écran** en JPEG qualité 70, conservées pour les N dernières étapes
  (défaut : 10) et systématiquement pour toute étape en échec.
- Purge configurable, politique de rétention par session.
- **Audio non conservé par défaut** (F-49) : seules les transcriptions horodatées sont
  persistées.
- Objectif : session typique de 50 étapes sous 10 Mo hors audio, tout en garantissant que
  le rattrapage IA (F-52) dispose bien du DOM avant et après l'étape en échec. Budget
  indicatif : instantanés 1 à 2,5 Mo, captures 1 à 3 Mo, `raw.jsonl` moins de 0,5 Mo.

### 6.12 Artefact exécutable (ADR-0006)

Le JSON raffiné est la source de vérité. Le moteur d'exécution (vérifications, tentatives,
rattrapage IA, rapports) est une librairie versionnée. Le fichier généré est un script
mince et lisible qui importe ce moteur et déclare le scénario :

```ts
import { runScenario } from '@spyglass/runner'
import scenario from './scenario.json'

await runScenario(scenario, { headless: process.argv.includes('--headless') })
```

Le script reste exécutable hors de Spyglass, la librairie étant une dépendance déclarée. En
mode `--no-ai`, il ne requiert aucune clé d'API.

### 6.13 Cycle de vie d'un patch d'auto-réparation (ADR-0008)

Périmètre, invariant et garde-fous : F-62 à F-65. Justification et natures de patch :
ADR-0008.

```
Rattrapage IA réussi
  → patch écrit dans runs/<runId>/suggested-patch.json (jamais appliqué)
  → si scope ≠ action.descriptor : s'arrête ici, définitivement (F-62)
  → sinon : compteur de confirmations incrémenté
  → 2 exécutions consécutives avec le même descripteur corrigé (F-63)
  → branche git dédiée + pull request (F-64)
  → revue humaine explicite, obligatoire
  → fusion, compteur de patchs du scénario incrémenté (F-65)
```

La **v1 (lots -1 à 6) s'arrête à la production du patch**, au lot 5. L'application
assistée constitue le lot 7, livré en **v1.1**.

### 6.14 Arborescence d'une session

**Cardinalité.** Une **session** d'enregistrement produit un artefact brut, puis 1 à n
**révisions raffinées**, puis **un scénario généré**. Les compteurs de fragilité (F-65) et
l'état de confirmation des patchs (F-63) portent sur ce scénario, donc sur la session. Le
scénario généré est par ailleurs versionné dans le dépôt du projet cible (F-64) ; le
répertoire `sessions/` n'est pas ce dépôt.

```
sessions/<sessionId>/
  meta.json           identifiants, dates, URL de départ, version d'outil, schemaVersion, coût de session
  raw.jsonl           artefact brut, append-only, immuable
  snapshots/          instantanés DOM allégés, un par étape de capture
  screenshots/        captures d'écran, selon politique de rétention
  transcripts/        segments vocaux horodatés, jamais transmis
  audio/              présent uniquement si AUDIO_RETENTION ≠ none (F-49)
  refined/
    rev-1.json        artefact raffiné, révision 1
    rev-2.json
  generated/
    scenario.json     scénario, source de vérité
    scenario.ts       script mince d'exécution
    README.md         mode d'emploi du script généré
  runs/<runId>/
    report.json       rapport d'exécution
    suggested-patch.json  correctifs issus des rattrapages IA réussis, jamais appliqués
  health.json         patchCandidates[], compteur de patchs cumulés, statut sain / fragile / obsolète
```

## 7. Configuration

**Précédence : `interface > variables d'environnement > valeur par défaut`.**

- Les **variables d'environnement** sont des valeurs d'**amorçage**, chargées depuis un
  fichier local non versionné. Elles restent le seul mécanisme pour le script généré et
  pour l'intégration continue, où aucune interface n'existe.
- L'**interface** (F-29) est la source de vérité au moment de l'exécution de Spyglass. Les
  réglages modifiés y sont persistés dans `settings.json`, dans le répertoire de données
  applicatives standard de la plateforme, et surchargent l'amorçage sans redémarrage.
- Les **clés d'API** ne sont jamais écrites en clair dans `settings.json` : elles sont
  chiffrées via `safeStorage` d'Electron. Une clé fournie par variable d'environnement
  reste en mémoire du processus principal et n'est jamais recopiée sur disque.

| Variable | Rôle | Défaut |
|---|---|---|
| `LLM_FAST_PROVIDER` | Fournisseur du profil `fast` (narration) | `anthropic` |
| `LLM_FAST_API_KEY` | Clé d'API du profil `fast` | requis |
| `LLM_FAST_BASE_URL` | Point d'entrée du profil `fast` | optionnel |
| `LLM_FAST_MODEL` | Modèle de narration | Claude Haiku, version à figer au lot 2 |
| `LLM_FAST_BATCH_MS` | Fenêtre de mise en lot de la narration | `500` |
| `LLM_FAST_TIMEOUT_MS` | Budget de latence de l'enrichissement avant abandon du lot (F-23). Avec `LLM_FAST_BATCH_MS`, borne le pire cas à 1,7 s, sous la cible de 2 s p95 (2.2) | `1200` |
| `LLM_SMART_PROVIDER` | Fournisseur du profil `smart` | `anthropic` |
| `LLM_SMART_API_KEY` | Clé d'API du profil `smart` | requis |
| `LLM_SMART_BASE_URL` | Point d'entrée du profil `smart` | optionnel |
| `LLM_SMART_MODEL` | Modèle de raffinement et de rattrapage | Claude Sonnet, version à figer au lot 4 |
| `SESSION_TOKEN_LIMIT_FAST` | Plafond de tokens cumulés du profil `fast` par session | `500000` |
| `TOKEN_WARN_RATIO` | Fraction du plafond déclenchant l'avertissement | `0.5` |
| `RATE_LIMIT_CALLS_PER_MIN` | Seuil de débit d'appels avant bascule en gabarits | `60` |
| `SMART_TOKEN_CONFIRM` | Consommation estimée au-delà de laquelle une opération `smart` requiert confirmation | `100000` |
| `STT_MODEL` | Modèle de transcription embarqué | `whisper-small-q5_1` |
| `STT_LANGUAGE` | Langue de dictée | `fr` |
| `STT_MODEL_DIR` | Répertoire de cache des modèles de transcription | données applicatives standard de la plateforme |
| `STT_UPGRADE_PROMPT_AFTER` | Segments corrigés manuellement déclenchant la proposition de montée en précision | `10` |
| `STT_MAX_LATENCY_MS` | Budget de latence au-delà duquel le repli sur `small` est automatique | `2000` |
| `SESSIONS_DIR` | Répertoire de stockage des sessions | `./sessions` |
| `MAX_AI_RETRIES` | Tentatives de rattrapage par étape | `3` |
| `SCREENSHOT_RETENTION` | Nombre d'étapes récentes conservées en capture | `10` |
| `AUDIO_RETENTION` | Rétention des flux audio : `none`, `corrected`, `all` (F-49) | `none` |
| `SCROLL_THRESHOLD_PX` | Amplitude de défilement au-delà de laquelle un événement est capturé (F-11, F-16) | `200` |
| `NET_CORRELATION_MS` | Fenêtre après une action utilisateur pendant laquelle une requête réseau est jugée signifiante (F-12) | `1000` |
| `INPUT_AGGREGATION_MS` | Inactivité de saisie déclenchant la consolidation d'un événement de champ (F-16) | `800` |
| `PATCH_ASSISTED_APPLY` | Active l'application **assistée** des patchs, sous branche et pull request (lot 7). Ne rend jamais l'application automatique (F-62) | `false` |
| `PATCH_CONFIRM_RUNS` | Exécutions consécutives requises avant promotion d'un patch | `2` |
| `PATCH_WARN_THRESHOLD` | Patchs cumulés au-delà desquels un scénario est signalé fragile | `3` |
| `PATCH_STALE_THRESHOLD` | Patchs cumulés au-delà desquels un scénario est marqué obsolète | `5` |

Aucune clé n'est jamais écrite dans un artefact ni affichée dans le chat. Les clés sont
lues et utilisées exclusivement dans le processus principal, et ne transitent jamais par le
processus de rendu.

## 8. Exigences non fonctionnelles

| Domaine | Exigence |
|---|---|
| Performance | La sonde DOM ajoute moins de 5 ms par interaction. L'enregistrement ne dégrade pas visiblement la navigation. |
| Robustesse | Une perte de réseau, une erreur du fournisseur LLM ou un dépassement de plafond n'interrompent jamais l'enregistrement, la journalisation brute ni la dictée. Reprise sur incident sans perte d'artefact brut. |
| Déterminisme | Le rejeu d'un scénario inchangé sur un site inchangé ne déclenche aucun appel LLM et ne requiert aucune clé d'API. |
| Confidentialité | Les secrets ne quittent jamais la machine. L'audio ne quitte jamais la machine. Seules des données de page expurgées sont transmises aux profils distants. |
| Coût | Consommation mesurée en tokens, bornée par la mise en lot, plafonnée par session et par débit. Toute estimation monétaire est indicative et n'entre dans aucune logique de contrôle. |
| Portabilité | Fonctionnement sur Linux, macOS et Windows. Script généré exécutable sans Spyglass installé. |
| Empreinte | Enregistrement et dictée fonctionnels sur un poste sans GPU. Installeur maîtrisé malgré le modèle de transcription embarqué, de l'ordre de 190 Mo. |
| Observabilité | Journal applicatif structuré, mesure des latences de bout en bout, traçabilité de chaque appel LLM (usage, coût, durée, profil). |
| Maintenabilité | Séparation stricte entre capture, narration, raffinement et exécution. Chaque couche testable isolément. |
| Intégrité des scénarios | Aucun mécanisme automatique ne peut affaiblir un critère de vérification ni modifier la structure d'un scénario. Toute modification appliquée est tracée, revue et attribuable. |
| Accessibilité | Chat navigable au clavier, contrastes conformes, transcription toujours consultable en texte. |

## 9. Sécurité et conformité

- Le navigateur embarqué exécute du contenu web tiers non fiable : `contextIsolation`
  activé, `nodeIntegration` désactivé, `sandbox` actif, aucune API système accessible
  depuis la page.
- **Ce qui sort de la machine** : descripteurs d'éléments expurgés, texte de libellé
  tronqué, URL nettoyées de leurs paramètres sensibles, et pour le seul profil `smart` en
  rattrapage, instantanés DOM allégés.
- **Ce qui ne sort jamais de la machine** : l'audio, les transcriptions brutes avant
  affichage, les cookies, les jetons, les valeurs de champs masqués, les clés d'API, le
  contenu des artefacts persistés.
- **Ce qui n'est même pas écrit sur disque** : les flux audio, non persistés par défaut
  (F-49) ; les clés d'API en clair, chiffrées via `safeStorage` (section 7).
- L'expurgation est un point de passage unique et obligatoire (6.9), couvert par des tests
  dédiés.
- L'utilisateur est informé, au démarrage d'une session, que la narration transmet des
  données de page à un fournisseur distant, avec possibilité de désactiver la narration
  LLM et de rester en mode gabarits.
- Les artefacts peuvent contenir des données personnelles issues des pages visitées :
  avertissement à l'utilisateur, et commande de purge de session.

## 10. Décisions d'architecture actées

Les 17 arbitrages structurants sont documentés en ADR dans **[`docs/adr/`](docs/adr/)**.
Chaque ADR porte le contexte, la justification, les alternatives écartées et les
conséquences. Le tableau ci-dessous n'est qu'un index.

| ID | Décision | Choix retenu | ADR |
|---|---|---|---|
| D-01 | Technologie de la coquille | Electron, vue navigateur native embarquée | [0001](docs/adr/0001-coquille-electron.md) |
| D-02 | Rattachement de Stagehand | Connexion CDP à la vue affichée, navigateur unique partagé | [0002](docs/adr/0002-rattachement-stagehand-cdp.md) |
| D-03 | Stratégie LLM | Deux profils distincts : `fast` narration, `smart` raffinement et rattrapage | [0003](docs/adr/0003-strategie-llm-deux-profils.md) |
| D-04 | Transcription vocale | Locale, sans appel réseau | [0004](docs/adr/0004-transcription-vocale-locale.md) |
| D-05 | Transport audio | WebSocket depuis le processus principal, jamais depuis le renderer | [0005](docs/adr/0005-transport-audio-main.md) |
| D-06 | Format du script généré | Hybride : JSON source de vérité, moteur en librairie, script mince | [0006](docs/adr/0006-format-script-genere.md) |
| D-07 | Vérification d'étape | Heuristique proposée, validation groupée au raffinement, finalisation bloquante | [0007](docs/adr/0007-verification-etape.md) |
| D-08 | Auto-réparation | Proposition en v1, application assistée au lot 7, limitée au descripteur d'action | [0008](docs/adr/0008-auto-reparation.md) |
| D-09 | Frames et shadow DOM | Support complet dès le lot 1, shadow DOM fermé hors périmètre | [0009](docs/adr/0009-frames-et-shadow-dom.md) |
| D-10 | Popup et nouvel onglet | Redirection dans la page courante. **Hypothèse `loginRedirect` à confirmer en lot 0 bis** | [0010](docs/adr/0010-popup-et-nouvel-onglet.md) |
| D-11 | Rétention des captures | Tampon glissant : instantanés systématiques, captures sur N dernières étapes et échecs | [0011](docs/adr/0011-retention-des-captures.md) |
| D-12 | Modèle de narration (`fast`) | Fournisseur distant via clé d'API, Claude Haiku par défaut, mode dégradé obligatoire | [0012](docs/adr/0012-modele-narration-fast.md) |
| D-13 | Moteur de transcription | `whisper.cpp`, modèle `small` quantifié embarqué, sans installation tierce | [0013](docs/adr/0013-moteur-transcription-whisper-cpp.md) |
| D-14 | Modèle de raisonnement (`smart`) | Claude Sonnet par défaut, multimodalité attendue, rattrapage supervisé uniquement | [0014](docs/adr/0014-modele-raisonnement-smart.md) |
| D-15 | Souveraineté des données | Aucune contrainte en v1, hypothèse explicitement révisable | [0015](docs/adr/0015-souverainete-des-donnees.md) |
| D-16 | Unité de plafonnement | Le token, jamais la devise. Le plafond est un disjoncteur, pas un budget | [0016](docs/adr/0016-plafonnement-en-tokens.md) |
| D-17 | Montée en précision STT | `large-v3-turbo` en téléchargement optionnel, proposé contextuellement | [0017](docs/adr/0017-montee-precision-transcription.md) |

## 11. Lotissement

La **v1 couvre les lots -1 à 6**. Le lot 7 constitue la **v1.1**.

| Lot | Contenu | Critère de sortie |
|---|---|---|
| **Lot -1 - Socle d'outillage** | Stack et versions figées, structure de dépôt, outillage de test, lint et formatage, packaging des trois plateformes, intégration continue, contrats techniques de la section 15 | Une application Electron vide se construit, se teste, se signe et s'installe sur les trois plateformes depuis la CI ; les schémas JSON valident un jeu d'exemples |
| **Lot 0 - Socle** | Coquille Electron deux zones, `WebContentsView`, barre d'URL, page unique, Stagehand connecté en CDP à la vue affichée | Naviguer manuellement, Stagehand exécute un `observe` sur la page affichée |
| **Lot 0 bis - Confirmation EntraID** ⚠️ **jalon go / no-go bloquant** | Vérification de l'hypothèse `loginRedirect` (D-10) sur une application cible réelle. En cas d'invalidation, le plan B (popup d'authentification éphémère non enregistrée) est **chiffré avant** d'engager le lot 1 | Authentification EntraID complétée dans la vue unique sans popup requise, **ou** plan B chiffré et arbitré |
| **Lot 1 - Capture** | Sonde DOM multi-frames et shadow DOM, normalisation, masquage, débruitage, `stepIndex`, **descripteur d'action rejouable local (F-22)**, artefact brut append-only, rétractation (F-19), bouton Record / Stop, rétention D-11 | Un parcours de 10 actions, dont une dans une iframe et une dans un composant web, produit un `raw.jsonl` complet et fidèle ; **chaque descripteur local rejoue son action via `act()` sans appel LLM** |
| **Lot 2 - Agent observateur** | Gabarits déterministes d'abord, abstraction LLM à deux profils, filtre d'expurgation, enrichissement distant mis en lot avec remplacement en place, compteurs en tokens, double seuil et seuil de débit, blocs techniques repliables, configuration depuis l'interface (F-29) | Le chat affiche chaque étape en moins de 200 ms puis l'enrichit ; en coupant le réseau, le chat reste complet en gabarits sans perte d'événement ; un plafond abaissé artificiellement déclenche avertissement puis suspension de l'enrichissement, sans interrompre l'enregistrement |
| **Lot 3 - Voix** | Capture audio, sidecar de transcription embarqué, transport WebSocket depuis le main, corrélation temporelle, édition des segments | Dicter avant et après une action, retrouver l'association dans l'artefact brut, avec le réseau coupé |
| **Lot 4 - Raffinement** | Génération de l'artefact raffiné, vérifications qualifiées `strong` / `weak`, blocage de finalisation, édition, révisions | Un scénario raffiné valide, traçable vers le brut, sans vérification faible non confirmée |
| **Lot 5 - Exécution** | Moteur en librairie, vérifications, rattrapage IA borné, reprise en mode script, rapport, patch suggéré | Rejeu réussi sans IA sur site inchangé, rattrapage réussi sur sélecteur volontairement cassé, patch produit mais non appliqué |
| **Lot 6 - Script généré** | Génération du script mince, `--headless` et paramètres, mode d'emploi, **protocole de mesure des objectifs non contractuels** (corpus de 10 sites publics, rejeu à J+1) | Script exécuté hors de Spyglass, en visible et en headless ; taux de rejeu mesurés sur le corpus et publiés |
| **Lot 7 - Finition (v1.1)** | Application assistée des patchs (invariant F-62, confirmation F-63, branche et PR F-64, compteurs F-65), montée en précision optionnelle de la transcription (D-17), export/import, rejeu pas à pas dans l'interface, paramétrage des scénarios | Un patch de descripteur confirmé deux fois produit une PR revue puis fusionnée ; un patch de vérification reste en proposition ; scénario paramétré rejoué avec jeux de données distincts |

## 12. Points ouverts d'implémentation

**16 des 17 décisions d'architecture sont fermes. Une reste conditionnelle : D-10**, dont
l'hypothèse `loginRedirect` est confirmée ou infirmée au lot 0 bis, jalon go / no-go
bloquant (I-02). Les autres points ci-dessous relèvent de l'implémentation et seront
tranchés au sein du lot concerné, sans remettre en cause le cadrage.

| ID | Point | Lot |
|---|---|---|
| I-01 | Résolution de la cible CDP correspondant à la vue affichée, et maintien de la liaison à travers navigations et recréations de contexte | Lot 0 |
| I-02 | Confirmation de l'hypothèse `loginRedirect` sur une application EntraID réelle (D-10). En cas d'invalidation, requalification vers le support d'une popup d'authentification éphémère non enregistrée | Lot 0 bis |
| I-03 | Version exacte du modèle du profil `fast` à figer, après mesure de latence et de qualité rédactionnelle en français | Lot 2 |
| I-04 | Gabarits de narration du mode dégradé : couverture des types d'événements et qualité rédactionnelle | Lot 2 |
| I-05 | Version exacte du modèle du profil `smart` à figer, après évaluation sur des raffinements et des diagnostics réels | Lot 4 |
| I-06 | Format exact de l'instantané DOM allégé, arbitrage entre volume et pouvoir diagnostique | Lot 1 |
| I-07 | Validation que le descripteur d'action construit localement (F-22) suffit à rejouer l'action via `act()`. **Repli pré-arbitré** en cas d'insuffisance mesurée : enrichissement `observe()` **groupé au raffinement** (un appel par scénario, profil `smart`, lot 4). Ce repli ne rouvre pas d'arbitrage : il préserve l'enregistrement hors ligne et n'ajoute de dépendance réseau qu'au raffinement, qui en a déjà une | Lot 1 |
| I-08 | Détection de la mutation DOM sans action utilisateur déclenchant un instantané supplémentaire (F-17) | Lot 1 |

## 13. Risques

| Risque | Impact | Atténuation |
|---|---|---|
| Sélecteurs fragiles sur applications à classes générées dynamiquement | Rejeu inexploitable | F-13 descripteur multi-stratégies, priorité aux attributs stables, rattrapage IA |
| Hypothèse `loginRedirect` invalidée sur une application cible | Blocage de l'authentification en entreprise | Lot 0 bis bloquant, `pageId` prévu dès la v1 (ADR-0010) |
| Indisponibilité réseau ou du fournisseur pendant un enregistrement | Narration perdue | F-23 mode dégradé, journalisation brute indépendante du réseau (6.6) |
| Rafale d'événements sur une page pathologique | Consommation anormale, chat noyé | F-73 seuil de débit, F-24 mise en lot |
| Estimation monétaire erronée par tarifs obsolètes | Décision utilisateur faussée | F-70 plafonnement en tokens, F-75 table versionnée et estimation indicative |
| Transmission involontaire de données sensibles au fournisseur de narration | Incident de confidentialité | 6.9 filtre unique et obligatoire, tests dédiés, désactivation possible de la narration |
| Transcription locale imprécise en environnement bruyant | Intentions erronées dans le scénario | F-33 édition des segments, affichage systématique du texte reconnu, VAD |
| Précision insuffisante de `whisper small` en français métier | Intentions mal transcrites dans l'artefact | F-33, F-38 montée optionnelle proposée contextuellement (ADR-0017) |
| Poids de l'installeur avec modèle de transcription embarqué | Adoption freinée | Modèle `small` quantifié, modèle lourd optionnel (ADR-0013) |
| Contrainte de souveraineté apparaissant après la v1 | Remise en cause du fournisseur, voire du raffinement distant | F-29 abstraction, 6.9 filtre unique, réseau privé documenté (ADR-0015) |
| Modèle `smart` non multimodal configuré par l'utilisateur | Diagnostic dégradé sur les échecs visuels | F-61 détection de capacité et avertissement, repli sur DOM textuel |
| Sites détectant l'automatisation | Blocage du parcours | Navigateur réel, interaction humaine réelle, sonde passive (6.5) |
| Installeur non signé bloqué par SmartScreen, Gatekeeper ou une politique de poste | Diffusion hors usage interne impossible sans délai | Usage interne assumé en v1 (2.3), chaîne de signature préconfigurée, obtention de certificats à lancer avant toute diffusion |
| Dérive vers un agent autonome coûteux | Perte de l'avantage produit | Règle intangible : IA en rattrapage uniquement, `--no-ai` toujours possible (F-50, F-58) |
| Auto-réparation affaiblissant silencieusement les assertions | Scénarios toujours verts, sans valeur de détection | F-62 invariant, F-64 revue humaine, F-65 compteurs de fragilité |
| Accumulation de patchs masquant une refonte réelle de l'application | Scénario déconnecté du parcours métier | F-65 marquage fragile puis obsolète, ré-enregistrement imposé |

## 14. Critères d'acceptation de la v1

Périmètre : **lots -1 à 6**. Les critères sont identifiés `CA-nn` et référencés par les
indicateurs contractuels de 2.2.

CA-01. Un utilisateur enregistre un parcours de connexion puis de recherche sur un site
   public, en 10 étapes, en commentant vocalement au moins 3 étapes, en moins de 5 minutes.
CA-02. Le parcours comprend au moins une interaction dans une iframe et une dans un composant
   web à shadow DOM ouvert, toutes deux correctement capturées.
CA-03. Une authentification OIDC EntraID en flux `loginRedirect` se déroule intégralement dans
   la vue unique et est correctement enregistrée.
CA-04. Chaque action apparaît dans le chat en moins de 200 ms sous forme de gabarit, puis est
   remplacée par sa narration LLM en moins de 2 s p95, avec le descripteur DOM associé ; la
   consommation de session reste sous 10 % du plafond de tokens par défaut.
CA-05. Plafond abaissé artificiellement : l'avertissement apparaît à 50 %, la narration bascule
   en gabarits à 100 % avec un message explicite et une action de relèvement, et
   l'enregistrement se poursuit sans perte d'événement.
CA-06. Coupure du réseau en cours d'enregistrement : le chat reste complet en gabarits, la
   dictée reste opérationnelle, le descripteur d'action rejouable continue d'être produit
   (F-22), aucun événement n'est perdu, la bascule est journalisée dans `narration.mode`.
CA-07. L'artefact brut contient l'intégralité des événements, y compris les segments vocaux,
   et n'a pas été modifié par le raffinement.
CA-08. L'artefact raffiné contient 10 étapes ou moins, chacune avec intention, action et
   vérification confirmée, sans répétition ni bruit. Les vérifications `weak` routinières ont
   pu être confirmées en un geste après affichage de la liste, les douteuses une par une (F-44b).
CA-09. La session complète occupe moins de 10 Mo sur disque, aucun flux audio n'étant
   persisté avec la configuration par défaut (F-49).
CA-10. Le script généré rejoue le scénario en mode visible, sans aucun appel LLM et sans clé
   d'API, et se termine avec un code de sortie nul.
CA-11. Le même script rejoue le scénario en `--headless`.
CA-12. Après modification volontaire d'un identifiant sur la page cible, le rejeu supervisé
   échoue à l'étape concernée, bascule en rattrapage IA, réussit, reprend en mode script
   jusqu'à la fin, et produit un patch suggéré non appliqué.
CA-13. Le même rejeu, exécuté avec la variable `CI` positionnée et sans clé d'API, échoue
   proprement à l'étape concernée, sans tentative de rattrapage, avec un rapport
   exploitable et un code de sortie non nul.
CA-14. Un patch portant sur un critère de vérification ou sur la structure du scénario reste
   en proposition et ne peut être appliqué par aucun chemin, y compris configuration
   modifiée.
CA-15. Une revue du trafic sortant confirme qu'aucun flux audio, aucun secret et aucune valeur
   masquée n'ont été transmis.
CA-16. Une étape rétractée depuis le chat disparaît de l'interface et du raffiné, tout en
   restant présente dans `raw.jsonl`, accompagnée de son événement `step.retracted` (F-19).
CA-17. Un changement de modèle depuis l'interface prend effet sans redémarrage, et
   `settings.json` ne contient aucune clé d'API en clair (F-29).

## 15. Contrats techniques

Les contrats sont **normatifs et exécutables**, maintenus dans
**[`docs/contracts/`](docs/contracts/)**. Le PRD les référence et ne les duplique pas. Ils
sont produits au lot -1 et validés en intégration continue dès ce lot.

| Contrat | Fichier | Porte |
|---|---|---|
| Événement brut | [`schemas/raw-event.schema.json`](docs/contracts/schemas/raw-event.schema.json) | Énumération `kind`, descripteur d'élément (F-13), descripteur rejouable local (F-22), valeur masquée (F-15) |
| Étape raffinée | [`schemas/refined-step.schema.json`](docs/contracts/schemas/refined-step.schema.json) | Vérification obligatoire (F-44), invariant `scope: action.descriptor` (F-62) |
| Santé d'un scénario | [`schemas/health.schema.json`](docs/contracts/schemas/health.schema.json) | `patchCandidates[]` (F-63), seuils de fragilité (F-65) |
| Canaux IPC | [`ipc.md`](docs/contracts/ipc.md) | Nommage, direction, charges utiles, règles d'isolation |
| Machine à états | [`state-machine.md`](docs/contracts/state-machine.md) | Orchestrateur de session et sous-machine d'exécution d'étape |
| Prompts | [`prompts.md`](docs/contracts/prompts.md) | Entrées, sorties structurées et règles de rejet des trois usages LLM |

Trois invariants sont portés **par le code et les schémas, jamais par un prompt** :

1. `patchHistory[].scope` n'admet que `action.descriptor` (F-62).
2. Une valeur capturée est soit en clair, soit masquée, jamais les deux (F-15).
3. `sourceEvents` ne peut référencer que des identifiants présents dans `raw.jsonl` (F-42).

### 15.1 Spécification d'interface

Inventaire minimal du lot 0, à compléter au lot 2.

| Zone | Composants | États à couvrir |
|---|---|---|
| Barre supérieure | Champ URL, précédent, suivant, recharger, indicateur de chargement | Vide, chargement, erreur de navigation, hors ligne |
| Vue navigateur (75 %) | `WebContentsView`, bordure d'enregistrement (F-07) | Inactif, enregistrement, pause |
| Séparateur | Poignée de redimensionnement (F-01) | Ratio par défaut restauré au lancement |
| Chat (25 %) | Fil de messages, bloc technique repliable, bouton Record / Stop, micro, compteur de tokens | Vide, gabarit en attente d'enrichissement, enrichi, rétracté, erreur de profil, plafond atteint, hors ligne |
| Réglages | Profils `fast` et `smart`, test de connexion, plafonds, rétention | Non configuré, clé invalide, modèle non multimodal (F-61), modèle absent de la table de tarifs (F-75) |

Le chat est navigable au clavier et chaque message expose son texte de transcription
(section 8, Accessibilité).

## 16. Socle technique et outillage (lot -1)

Cette section fixe ce qu'un implémenteur doit savoir avant d'écrire le premier fichier.
Toutes les lignes sont actées.

### 16.1 Stack

| Élément | Choix |
|---|---|
| Langage | TypeScript en mode `strict`, sans `any` implicite |
| Runtime | Node LTS courant au démarrage du lot -1 |
| Coquille | Electron stable courante au démarrage du lot -1 |
| **Politique de version** | **Versions Node et Electron figées au lot -1 pour toute la v1**, relevées uniquement pour un correctif de sécurité. La sonde DOM et la liaison CDP (I-01) sont sensibles à la version de Chromium : une montée en cours de lot rendrait un défaut de capture indiscernable d'une régression amont |
| Gestionnaire de paquets | `pnpm` avec workspaces, `packageManager` figé dans `package.json` |
| Structure | Monorepo à 5 paquets : `app` (Electron), `runner` (`@spyglass/runner`, ADR-0006), `probe` (sonde injectée), `contracts` (types et schémas), `stt` (sidecar). La séparation découle du cadrage : ADR-0006 impose une librairie publiable séparément, la section 8 impose des couches testables isolément |
| Build | `electron-vite` pour le développement, `electron-builder` pour la distribution |
| Périmètre npm | **`@spyglass` à réserver au lot -1**, avant que `@spyglass/runner` ne soit écrit comme dépendance dans des scénarios livrés |

### 16.2 Qualité

| Élément | Choix |
|---|---|
| Tests unitaires | `vitest`, obligatoires sur le filtre d'expurgation (6.9), le masquage (F-15) et le débruitage (F-16) |
| Tests de bout en bout | `@playwright/test` piloté sur l'application Electron **empaquetée**, seule façon de couvrir le paquetage, le sidecar embarqué et le démarrage réel. Playwright est déjà une dépendance transitive de Stagehand |
| Validation de schéma | `ajv`, exécutée en CI sur un corpus d'exemples valides et invalides |
| Lint et format | **Biome**, un seul outil et une seule configuration pour les 5 paquets |
| Couverture | Seuil bloquant sur `contracts` et sur le filtre d'expurgation uniquement, jamais un seuil global |

### 16.3 Distribution

| Élément | Choix |
|---|---|
| Cibles | Linux (AppImage et deb), macOS (dmg, arm64 et x64), Windows (NSIS) |
| **Signature** | **Hors périmètre v1** (2.3) : la v1 est à usage interne, les installeurs ne sont ni signés ni notariés. La chaîne `electron-builder` est néanmoins configurée pour accepter des certificats sans refonte, l'obtention étant le seul chemin critique d'une diffusion ultérieure |
| Binaire `whisper.cpp` | Compilé par plateforme et empaqueté, non téléchargé (ADR-0013) |
| Licences | Compatibilité de `whisper.cpp` et des poids de modèle avec la redistribution dans l'installeur : **vérifiée et documentée au lot -1**, avant la première construction de paquet |
| Intégration continue | Matrice trois OS : construction, tests, validation de schémas, artefacts d'installeur |

### 16.4 Reprise sur incident

Exigée en section 8, non spécifiée jusqu'ici.

- `raw.jsonl` est écrit ligne par ligne, chaque ligne étant un JSON complet suivi d'un saut
  de ligne, avec vidage disque explicite. Un arrêt brutal laisse un fichier valide jusqu'à la
  dernière ligne complète ; une ligne partielle en fin de fichier est tronquée à
  l'ouverture, et l'événement de troncature est journalisé.
- Au démarrage, une session non close (absence de `record.stop`) est détectée et proposée en
  reprise ou en clôture forcée. Une clôture forcée scelle l'artefact tel quel, sans perte.
- Aucun état de session n'est conservé uniquement en mémoire du renderer.
