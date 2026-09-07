# PRD - Spyglass

Enregistreur de scénarios de navigation web assisté par IA, propulsé par Stagehand.

| Champ | Valeur |
|---|---|
| Produit | Spyglass |
| Version du document | 1.0 (cadrage complet, toutes décisions actées) |
| Statut | Cadrage complet. 17 décisions actées en section 10, aucune décision structurante ouverte. Prêt pour le lancement du lot 0 |
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

| Indicateur | Cible |
|---|---|
| Temps de création d'un scénario de 10 étapes | < 5 minutes, saisie vocale comprise |
| Taux de rejeu réussi sans IA, sur site inchangé (J+1) | > 95 % |
| Taux de rejeu réussi avec rattrapage IA, sur site modifié | > 80 % |
| Latence perçue d'interaction dans le navigateur embarqué | < 50 ms (indiscernable d'un navigateur natif) |
| Latence d'apparition d'un événement DOM dans le chat | < 800 ms, lot de narration compris |
| Consommation de narration par étape enregistrée | < 600 tokens cumulés entrée et sortie |
| Consommation de narration sur une session nominale de 50 étapes | < 30 000 tokens, soit environ 4 % du plafond |
| Latence de transcription vocale (segment final) | < 2 s après fin d'énoncé, hors ligne |
| Empreinte disque d'une session de 50 étapes | < 10 Mo |

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

| ID | Exigence | Priorité |
|---|---|---|
| F-10 | Bouton unique **Record** / **Stop**, libellé et style mis à jour dynamiquement selon l'état. | P0 |
| F-11 | Capture des interactions utilisateur : clic, double-clic, saisie de champ, changement de sélection, case à cocher, bouton radio, soumission de formulaire, appui sur touche significative (Entrée, Échap, Tab), défilement significatif, survol conduisant à l'ouverture d'un menu. | P0 |
| F-12 | Capture des événements de navigation : chargement de page, navigation client, redirection, retour arrière, requête réseau signifiante (appel XHR/fetch corrélé à une action). | P0 |
| F-13 | Pour chaque événement, production d'un descripteur d'élément multi-stratégies : `id`, `data-testid` et attributs de test, rôle et nom accessible ARIA, texte visible, `name`, balise, sélecteur CSS unique, XPath, index parmi les frères, ancêtres significatifs, **chemin de frames** et **chemin de shadow roots ouverts**. | P0 |
| F-14 | Capture des sélections de texte et lectures de champ, pour permettre la création d'assertions de vérification. | P0 |
| F-15 | Masquage automatique des valeurs sensibles : champs `type=password`, champs marqués `autocomplete` de type carte bancaire, motifs configurables. La valeur n'est jamais persistée en clair, elle est remplacée par une référence de secret. | P0 |
| F-16 | Anti-bruit à la capture : agrégation des frappes clavier d'un même champ en un seul événement de saisie, déduplication des événements redondants (`click` + `change` sur le même contrôle), seuil de défilement. | P0 |
| F-17 | Capture d'un instantané DOM allégé avant et après chaque étape, et d'une capture d'écran selon la politique de rétention définie en 6.11. | P0 |
| F-18 | Pause et reprise d'enregistrement sans clôturer la session. | P2 |
| F-19 | Suppression d'une étape directement depuis le chat pendant l'enregistrement. | P1 |

### 5.3 Agent IA observateur

| ID | Exigence | Priorité |
|---|---|---|
| F-20 | L'agent est connecté à l'instance Stagehand pilotant la page affichée et reçoit chaque événement capturé. | P0 |
| F-21 | Pour chaque événement, l'agent publie dans le chat un message en langage naturel décrivant l'action (« Tu as cliqué sur le bouton *Se connecter* »), assorti d'un bloc technique repliable contenant le descripteur DOM. | P0 |
| F-22 | L'agent associe à chaque action un descripteur d'action rejouable de type `ObserveResult` Stagehand, afin que l'étape puisse être rejouée sans appel LLM. | P0 |
| F-23 | La narration dispose d'un mode dégradé déterministe (gabarits de phrases sans LLM), activé automatiquement en cas de perte réseau, d'erreur du fournisseur, de dépassement du budget de latence ou d'atteinte du plafond de coût de session. Le passage en mode dégradé est signalé dans le chat et journalisé. | P0 |
| F-24 | La narration est mise en lot : les événements sont regroupés sur une fenêtre glissante (défaut : 500 ms) et narrés en un seul appel, afin de borner le coût et le nombre de requêtes. | P0 |
| F-25 | L'utilisateur peut dialoguer avec l'agent pendant l'enregistrement : poser une question sur la page, demander une correction d'étape, demander l'ajout d'une assertion. | P1 |
| F-26 | L'agent propose un critère de vérification pour chaque étape, qualifié `strong` ou `weak` (voir F-44). | P1 |
| F-27 | Le chat est synchronisé avec l'état de la page : chaque message d'étape est lié à l'URL et à l'instantané correspondants, et cliquer sur un message permet d'en visualiser le contexte. | P1 |
| F-28 | Compteur de consommation visible, exprimé en **tokens** : nombre d'appels, tokens d'entrée et de sortie cumulés par profil, rapportés au plafond configuré. Une estimation en devise est affichée **en complément et à titre purement indicatif**. | P1 |
| F-29 | Le fournisseur, le modèle, la clé d'API et le point d'entrée de chaque profil sont configurables par l'utilisateur depuis l'interface, sans redémarrage, avec test de connexion. Les valeurs par défaut sont proposées, jamais imposées. | P0 |

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
| F-38 | Montée en précision proposée **contextuellement** : lorsque l'utilisateur a corrigé manuellement un nombre configurable de segments transcrits, l'application propose le téléchargement du modèle plus précis. Un réglage enfoui dans les préférences ne serait jamais rapproché du problème vécu. La proposition reste refusable définitivement. | P2 |
| F-39 | Les deux modèles de transcription coexistent après montée en précision. Le modèle `small` n'est jamais supprimé et sert de repli automatique si le modèle plus lourd dépasse le budget de latence mesuré sur la machine au premier usage. Le cache des modèles réside dans le répertoire de données applicatives standard de la plateforme, surchargeable par configuration. | P2 |

### 5.5 Artefacts

| ID | Exigence | Priorité |
|---|---|---|
| F-40 | **Artefact brut** : journal horodaté, append-only, immuable, contenant tous les événements DOM, tous les segments vocaux, tous les messages de l'agent et toutes les captures. Conservé intégralement à des fins de traçabilité. | P0 |
| F-41 | **Artefact raffiné** : scénario structuré, produit par l'agent à partir de l'artefact brut, avec suppression du bruit, fusion des répétitions, ordonnancement canonique « intention utilisateur en langage naturel » puis « action technique » puis « vérification ». | P0 |
| F-42 | Le raffinement ne modifie jamais l'artefact brut. Le raffiné référence les identifiants d'événements bruts dont il est issu (traçabilité amont). | P0 |
| F-43 | Le raffinement est relançable et paramétrable (niveau d'agressivité du nettoyage), et son résultat est éditable manuellement avant génération. | P1 |
| F-44 | Chaque étape raffinée porte obligatoirement au moins un critère de vérification, qualifié `strong` (déduit d'une intention explicite ou d'une assertion utilisateur) ou `weak` (déduit d'une heuristique). La finalisation du scénario est **bloquée** tant qu'il subsiste une vérification `weak` non confirmée par l'utilisateur. | P0 |
| F-45 | **Artefact exécutable** : script autonome rejouant le scénario. Mode visible par défaut, mode `--headless` par paramètre. | P0 |
| F-46 | Versionnage des artefacts : chaque session porte un identifiant, chaque raffinement une révision. | P1 |
| F-47 | Export et import d'une session complète sous forme de dossier autonome. | P1 |
| F-48 | Paramétrage du scénario : les valeurs saisies et les secrets sont extraits en variables du script. | P1 |

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
| F-63 | Un patch n'est promu à l'application qu'après confirmation par **2 exécutions consécutives** produisant le même descripteur corrigé. Un succès isolé est journalisé mais jamais promu, afin d'écarter les états transitoires du site (test A/B, cache, déploiement en cours). Seuil configurable. | P1 |
| F-64 | L'application d'un patch s'effectue sur une **branche git dédiée** et donne lieu à une **pull request**. Aucun commit n'est jamais produit sur la branche par défaut. La fusion requiert une **revue humaine explicite** : une CI verte ne vaut pas validation, le scénario modifié ne pouvant valider sa propre modification. | P1 |
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

### 6.1 Principes directeurs

- **Stagehand est le composant cœur**, en mode local strict. Aucune dépendance à
  Browserbase : environnement local forcé, navigateur local.
- **Aucune adhérence à un fournisseur LLM particulier** : le client LLM est une
  abstraction, configurable par variables d'environnement et depuis l'interface (F-29).
  Les modèles par défaut sont des valeurs proposées, jamais des dépendances.
- **Déterminisme d'abord** : le LLM sert à comprendre, décrire et rattraper, jamais à
  exécuter le chemin nominal.
- **L'artefact brut est sacré** : append-only, jamais réécrit.
- **La voix ne sort jamais de la machine** : la transcription est locale et embarquée.
- **Le texte envoyé aux modèles distants est expurgé par construction** : jamais de
  secret, jamais de jeton, jamais de valeur masquée.
- **Aucune fonction critique ne dépend du réseau** : la capture, la journalisation et la
  dictée restent opérationnelles hors ligne ; seule la qualité de narration se dégrade. Le
  raffinement et le rattrapage, eux, requièrent le réseau, mais interviennent hors du
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

### 6.3 Coquille applicative (décision D-01 : Electron)

La coquille est une application Electron. Le navigateur affiché dans la zone gauche est
une `WebContentsView` Chromium réelle, occupant 75 % de la largeur, avec la vue chat en
interface de rendu classique sur les 25 % restants.

Justification : Electron embarque un Chromium maîtrisé et exposant CDP, condition
nécessaire au pilotage Stagehand de la vue affichée (D-02). Tauri est écarté car sa
WebView système (WebKit sous Linux et macOS) n'expose pas de protocole de débogage
compatible. Une application web avec streaming CDP est écartée car la latence
d'interaction, de 80 à 200 ms, et la fragilité de la saisie clavier dégraderaient le
cœur du produit.

Contraintes de sécurité associées : `contextIsolation` activé, `nodeIntegration`
désactivé, `sandbox` actif sur la vue chargeant du contenu tiers, communication
exclusivement par canaux IPC typés et explicitement exposés.

### 6.4 Rattachement de Stagehand (décision D-02 : connexion CDP à la vue affichée)

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

Point technique à traiter : la résolution de la cible CDP correspondant à la vue
affichée, et le maintien de cette liaison à travers les navigations et les recréations de
contexte.

### 6.5 Sonde DOM (décision D-09 : frames et shadow DOM dès le lot 1)

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

Le support des frames et du shadow DOM est traité dès le premier lot : le format de
descripteur est le contrat le plus coûteux à faire évoluer après coup, et l'absence de ce
support ferait échouer la capture sur les bandeaux de consentement, les tunnels de
paiement, l'authentification fédérée et les composants web. Le shadow DOM fermé reste hors
périmètre, par impossibilité technique.

Contrainte forte : la sonde doit être **passive et invisible** pour le site cible. Aucune
modification du DOM, aucune variable globale exposée sous un nom devinable, aucun impact
mesurable sur les performances de la page.

### 6.6 Pipeline d'événements

```
Événement DOM brut
  → normalisation (type, cible, valeur, horodatage, contexte page)
  → masquage des secrets
  → débruitage / agrégation
  → enrichissement Stagehand (descripteur d'action rejouable)
  → journalisation dans l'artefact brut (append-only)
  → mise en lot (fenêtre glissante de 500 ms)
  → narration distante, asynchrone, dégradable en gabarits
  → affichage chat
```

La journalisation brute est **synchrone et prioritaire** : elle est écrite avant toute
sollicitation réseau et n'en dépend jamais. Une perte de connectivité, une erreur du
fournisseur ou un dépassement de plafond de coût dégradent la formulation mais
n'interrompent jamais l'enregistrement (F-23).

### 6.7 Chaîne vocale (décisions D-04 et D-13 : transcription locale embarquée, D-05 : WebSocket depuis le processus principal)

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

Moteur retenu : `whisper.cpp`, avec le modèle `small` multilingue quantifié, embarqué
dans le paquet applicatif. Ce choix est le seul à réunir une intégration native dans
Electron par bindings Node, des binaires précompilés pour les trois plateformes, une
exécution CPU sans dépendance externe, et un poids compatible avec l'embarquement, de
l'ordre de 190 Mo. La qualité en français est jugée suffisante pour une dictée d'intention
relue et éditable (F-33), qui n'a pas vocation à être transcrite au mot près.

Chemin d'évolution acté (D-17), sans changement d'architecture : mise à disposition de
`large-v3-turbo` quantifié, sensiblement plus précis en français mais d'un poids de l'ordre
de 575 Mo, en téléchargement optionnel après installation plutôt qu'embarqué.

Trois règles encadrent cette montée en précision :

- **Proposition contextuelle** (F-38) : elle est déclenchée par le constat d'un besoin réel,
  à savoir un nombre significatif de segments corrigés à la main, et non reléguée dans un
  écran de préférences que l'utilisateur gêné par la précision n'ouvrira jamais.
- **Coexistence des modèles** (F-39) : `small` n'est jamais supprimé. Les 190 Mo qu'il
  occupe sont un prix faible pour garantir qu'aucune configuration matérielle ne se
  retrouve avec une dictée devenue trop lente.
- **Repli automatique sur mesure** (F-39) : la latence du modèle lourd est mesurée au
  premier usage sur la machine réelle ; si elle dépasse le budget, le repli sur `small` est
  automatique et signalé. La décision n'est pas prise sur une caractéristique matérielle
  déclarée, mais sur une mesure.

### 6.8 Abstraction LLM (décisions D-03 : deux profils, D-12 et D-14 : modèles distants par clé d'API)

Un unique point d'entrée, avec deux profils de modèle, tous deux distants et authentifiés
par clé d'API :

| Profil | Usage | Contraintes |
|---|---|---|
| `fast` | Narration des événements en direct | Latence et coût unitaire prioritaires, appels mis en lot, qualité rédactionnelle en français suffisante |
| `smart` | Dialogue de chat, raffinement de l'artefact, rattrapage à l'exécution supervisée via Stagehand | Qualité et raisonnement prioritaires, **multimodalité attendue** pour le diagnostic visuel, latence tolérante, volume d'appels faible |

Justification du recours à une API pour le profil `fast` : la narration est une tâche de
transformation de descripteur DOM en langage naturel dont la qualité rédactionnelle
conditionne directement la lisibilité de l'artefact final. Un modèle distant de petite
taille offre une qualité de français nettement supérieure à un modèle local exécutable sur
CPU, pour un coût unitaire négligeable au regard du volume d'événements d'une session.

Contreparties assumées et traitées :

| Contrepartie | Traitement |
|---|---|
| Dépendance réseau | Mode dégradé par gabarits déterministes (F-23), signalé et journalisé |
| Coût par événement | Mise en lot des événements (F-24), plafonnement en tokens et seuil de débit (5.7) |
| Latence réseau | Narration asynchrone, jamais bloquante pour la capture ni pour la navigation |
| Sortie de données de page | Expurgation systématique en amont (6.9), politique documentée (section 9) |

Modèle par défaut du profil `fast` : **Claude Haiku**. Ce n'est qu'une valeur par défaut,
jamais une contrainte : fournisseur, modèle, clé d'API et point d'entrée sont intégralement
configurables par l'utilisateur (F-29). L'implémentation respecte donc une interface
indépendante du fournisseur, et aucune particularité propre à un fournisseur ne doit
remonter dans les couches supérieures.

Modèle par défaut du profil `smart` : **Claude Sonnet**. Retenir la même famille que le
profil `fast` évite une seconde clé, un second SDK et une seconde facturation, tout en
apportant la multimodalité native requise par le diagnostic visuel et un support de
première classe dans Stagehand. Comme pour `fast`, ce n'est qu'un défaut : le modèle est
librement reconfigurable (F-29).

La multimodalité est **attendue mais non obligatoire** (F-61). Un modèle texte seul reste
utilisable, au prix d'un diagnostic dégradé sur les échecs d'origine visuelle : élément
masqué, superposé, hors écran ou rendu de façon inattendue.

Alternative documentée : le rattrapage n'étant pas requis en intégration continue (F-60),
le profil `smart` n'a pas besoin d'être joignable depuis un runner distant. Un modèle
hébergé sur un réseau privé peut donc assurer l'intégralité de ce profil en usage local,
au prix de la multimodalité si le modèle en est dépourvu. Cette configuration est
pertinente lorsque le parcours enregistré porte sur une application interne sensible.

Les deux profils peuvent viser des fournisseurs distincts. Toute indisponibilité du profil
`smart` bloque le raffinement et le rattrapage, mais jamais l'enregistrement ni la dictée.

**Maîtrise de la consommation.** Le coût nominal de la narration est négligeable : de
l'ordre de 600 tokens par étape, soit environ 30 000 tokens pour une session de 50 étapes.
Le plafond n'est donc pas un instrument budgétaire mais un **disjoncteur**. Ce qu'il doit
détecter n'est pas un utilisateur prolixe, mais une anomalie : rafale d'événements sur une
page pathologique, boucle de narration, ou fuite de contexte gonflant le prompt à chaque
appel. Le plafond par défaut est fixé à un ordre de grandeur au-dessus du nominal, de
façon à ne jamais se déclencher en usage normal tout en bornant franchement toute dérive.
Le détail des seuils et des comportements figure en 5.7.

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
  "kind": "dom.click | dom.input | dom.submit | nav.load | nav.spa | nav.popup-redirected | voice.final | agent.message | user.message | selection",
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

Le champ `pageId` est présent dès la v1 bien qu'une seule page soit gérée. Il rend le
support ultérieur d'une popup additif plutôt que structurant (voir D-10). Le champ
`narration.mode` trace si la description provient du modèle distant ou du mode dégradé.

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

### 6.11 Rétention des instantanés et captures (décision D-11 : tampon glissant)

- **Instantané DOM allégé** pour chaque étape : arbre d'accessibilité et éléments
  interactifs uniquement, jamais le HTML brut. Cible de 20 à 50 Ko par instantané.
- **Captures d'écran** en JPEG qualité 70, conservées pour les N dernières étapes
  (défaut : 10) et systématiquement pour toute étape en échec.
- Purge configurable, politique de rétention par session.
- Objectif : session typique de 50 étapes sous 10 Mo, tout en garantissant que le
  rattrapage IA (F-52) dispose bien du DOM avant et après l'étape en échec.

### 6.12 Artefact exécutable (décision D-06 : moteur en librairie, script mince généré)

Le JSON raffiné est la source de vérité. Le moteur d'exécution (vérifications, tentatives,
rattrapage IA, rapports) est une librairie versionnée. Le fichier généré est un script
mince et lisible qui importe ce moteur et déclare le scénario :

```ts
import { runScenario } from '@spyglass/runner'
import scenario from './scenario.json'

await runScenario(scenario, { headless: process.argv.includes('--headless') })
```

Ce compromis conserve la lisibilité et l'éditabilité au niveau des étapes, tout en
maintenant la logique d'exécution en un seul endroit. Le script reste exécutable hors de
Spyglass, la librairie étant une dépendance déclarée. En mode `--no-ai`, il ne requiert
aucune clé d'API.

### 6.13 Auto-réparation assistée (décision D-08)

Un rattrapage IA réussi révèle un écart entre le scénario et la réalité de l'application.
Cet écart peut être capitalisé, mais l'automatisation de sa correction est le point où le
produit peut se détruire lui-même : un scénario qui se répare seul finit par être toujours
vert, donc sans valeur.

**Trois natures de patch, un seul périmètre automatisable :**

| Nature du patch | Effet | Traitement |
|---|---|---|
| **Descripteur d'action** : le sélecteur a changé, l'élément reste le même | Le scénario retrouve sa cible et continue de vérifier la même chose | **Seul périmètre éligible** à l'application assistée |
| **Critère de vérification** : l'assertion ne passe plus | Le scénario cesse de vérifier ce qu'il vérifiait | **Proposition pure, définitivement.** Une assertion affaiblie automatiquement produit un test complaisant |
| **Structure du scénario** : étape ajoutée, supprimée, réordonnée | Le parcours métier lui-même change | **Proposition pure, définitivement.** L'IA réécrirait une intention utilisateur qu'elle n'a pas observée |

Cette restriction est un **invariant de conception** (F-62), non un réglage : elle ne
comporte ni option de contournement ni variable de configuration.

**Cycle de vie d'un patch :**

```
Rattrapage IA réussi
  → patch écrit dans runs/<runId>/suggested-patch.json (jamais appliqué)
  → si nature ≠ descripteur d'action : s'arrête ici, définitivement
  → sinon : compteur de confirmations incrémenté
  → 2 exécutions consécutives avec le même descripteur corrigé (F-63)
  → branche git dédiée + pull request (F-64)
  → revue humaine explicite, obligatoire
  → fusion, compteur de patchs du scénario incrémenté (F-65)
```

**Garde-fou anti-dérive** (F-65) : un scénario réparé de façon répétée cesse
progressivement de décrire la réalité de l'application. Au-delà de 3 patchs cumulés il est
signalé comme fragile, au-delà de 5 il est marqué obsolète et doit être ré-enregistré. Le
produit assume ici que la réparation automatique est un sursis, jamais un substitut à
l'enregistrement humain.

La v1 (lot 5) s'arrête à la production du patch. L'application assistée est livrée au
lot 7.

### 6.14 Arborescence d'une session

```
sessions/<sessionId>/
  meta.json           identifiants, dates, URL de départ, version d'outil, coût de session
  raw.jsonl           artefact brut, append-only, immuable
  snapshots/          instantanés DOM allégés
  screenshots/        captures d'écran, selon politique de rétention
  audio/              enregistrements et transcriptions horodatées, jamais transmis
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
  health.json         compteur de patchs cumulés, statut sain / fragile / obsolète
```

## 7. Configuration

Variables d'environnement, chargées depuis un fichier local non versionné.

| Variable | Rôle | Défaut |
|---|---|---|
| `LLM_FAST_PROVIDER` | Fournisseur du profil `fast` (narration) | `anthropic` |
| `LLM_FAST_API_KEY` | Clé d'API du profil `fast` | requis |
| `LLM_FAST_BASE_URL` | Point d'entrée du profil `fast` | optionnel |
| `LLM_FAST_MODEL` | Modèle de narration | Claude Haiku, version à figer au lot 2 |
| `LLM_FAST_BATCH_MS` | Fenêtre de mise en lot de la narration | `500` |
| `LLM_FAST_TIMEOUT_MS` | Budget de latence de la narration avant bascule en gabarits (F-23) | `1500` |
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
| `PATCH_AUTO_APPLY` | Active l'application assistée des patchs (lot 7) | `false` |
| `PATCH_CONFIRM_RUNS` | Exécutions consécutives requises avant promotion d'un patch | `2` |
| `PATCH_WARN_THRESHOLD` | Patchs cumulés au-delà desquels un scénario est signalé fragile | `3` |
| `PATCH_STALE_THRESHOLD` | Patchs cumulés au-delà desquels un scénario est marqué obsolète | `5` |

Aucune clé n'est jamais écrite dans un artefact ni affichée dans le chat. Les clés sont
lues et utilisées exclusivement dans le processus principal.

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
- L'expurgation est un point de passage unique et obligatoire (6.9), couvert par des tests
  dédiés.
- L'utilisateur est informé, au démarrage d'une session, que la narration transmet des
  données de page à un fournisseur distant, avec possibilité de désactiver la narration
  LLM et de rester en mode gabarits.
- Les artefacts peuvent contenir des données personnelles issues des pages visitées :
  avertissement à l'utilisateur, et commande de purge de session.

## 10. Décisions d'architecture actées

| ID | Décision | Choix retenu |
|---|---|---|
| D-01 | Technologie de la coquille | **Electron**, vue navigateur native embarquée |
| D-02 | Rattachement de Stagehand | **Connexion CDP à la vue affichée**, navigateur unique partagé |
| D-03 | Stratégie LLM | **Deux profils distincts** : `fast` pour la narration, `smart` pour raffinement et rattrapage |
| D-04 | Transcription vocale | **Locale**, sans appel réseau |
| D-05 | Transport audio | **WebSocket depuis le processus principal**, jamais depuis le renderer |
| D-06 | Format du script généré | **Hybride** : JSON source de vérité, moteur en librairie versionnée, script mince lisible |
| D-07 | Vérification d'étape | **Heuristique proposée + validation groupée au raffinement**, finalisation bloquée sur vérification faible non confirmée |
| D-08 | Auto-réparation | **Proposition uniquement en v1**, application assistée au lot 7, strictement limitée au descripteur d'action (invariant non configurable). Promotion après 2 confirmations consécutives, branche dédiée et pull request, revue humaine obligatoire, marquage fragile à 3 patchs et obsolète à 5 |
| D-09 | Frames et shadow DOM | **Support complet dès le lot 1**, shadow DOM fermé hors périmètre |
| D-10 | Popup et nouvel onglet | **Redirection dans la page courante**. Hypothèse de travail retenue : les applications cibles utilisent le flux OIDC EntraID `loginRedirect`, compatible sans réserve. À confirmer en lot 0 bis |
| D-11 | Rétention des captures | **Tampon glissant** : instantanés allégés systématiques, captures d'écran sur les N dernières étapes et sur tous les échecs |
| D-12 | Modèle de narration (profil `fast`) | **Fournisseur distant via clé d'API, Claude Haiku par défaut**, entièrement reconfigurable par l'utilisateur. La qualité rédactionnelle en français prime sur l'autonomie hors ligne, le coût étant borné par la mise en lot et le plafond de session. Mode dégradé par gabarits obligatoire |
| D-13 | Moteur de transcription | **`whisper.cpp`, modèle `small` multilingue quantifié, embarqué dans le paquet applicatif**, sans installation tierce ni appel réseau. Montée vers `large-v3-turbo` prévue en option téléchargeable |
| D-14 | Modèle de raisonnement (profil `smart`) | **Claude Sonnet par défaut**, reconfigurable. Multimodalité attendue, avec avertissement non bloquant et diagnostic textuel dégradé si le modèle configuré en est dépourvu. Rattrapage IA réservé à l'exécution supervisée, désactivé par défaut en intégration continue |
| D-15 | Souveraineté des données | **Aucune contrainte en v1**, hypothèse explicitement révisable. L'abstraction de fournisseur et le filtre d'expurgation constituent les points d'ancrage d'une mise en conformité ultérieure |
| D-16 | Unité de plafonnement de la consommation | **Le token**, jamais la devise. Plafond `fast` de 500 000 tokens par session avec avertissement à 50 %, seuil de débit de 60 appels par minute, estimation préalable et confirmation pour les opérations `smart`. Estimation monétaire affichée en complément, à titre strictement indicatif |
| D-17 | Montée en précision de la transcription | **Modèle `large-v3-turbo` en téléchargement optionnel**, proposé contextuellement après un nombre configurable de corrections manuelles. Les deux modèles coexistent, `small` servant de repli automatique sur mesure de latence réelle. Cache dans le répertoire de données applicatives standard, surchargeable |

## 11. Lotissement

| Lot | Contenu | Critère de sortie |
|---|---|---|
| **Lot 0 - Socle** | Coquille Electron deux zones, `WebContentsView`, barre d'URL, page unique, Stagehand connecté en CDP à la vue affichée | Naviguer manuellement, Stagehand exécute un `observe` sur la page affichée |
| **Lot 0 bis - Confirmation EntraID** | Vérification de l'hypothèse `loginRedirect` sur une application cible réelle | Authentification EntraID complétée dans la vue unique, sans popup requise |
| **Lot 1 - Capture** | Sonde DOM multi-frames et shadow DOM, normalisation, masquage, débruitage, artefact brut append-only, bouton Record / Stop, rétention D-11 | Un parcours de 10 actions, dont une dans une iframe et une dans un composant web, produit un `raw.jsonl` complet et fidèle |
| **Lot 2 - Agent observateur** | Abstraction LLM à deux profils, filtre d'expurgation, narration distante mise en lot, mode dégradé par gabarits, compteurs en tokens, double seuil et seuil de débit, blocs techniques repliables, descripteurs rejouables | Le chat décrit correctement le parcours ; en coupant le réseau, la narration bascule en gabarits sans perte d'événement ; un plafond abaissé artificiellement déclenche avertissement puis bascule, sans interrompre l'enregistrement |
| **Lot 3 - Voix** | Capture audio, sidecar de transcription embarqué, transport WebSocket depuis le main, corrélation temporelle, édition des segments | Dicter avant et après une action, retrouver l'association dans l'artefact brut, avec le réseau coupé |
| **Lot 4 - Raffinement** | Génération de l'artefact raffiné, vérifications qualifiées `strong` / `weak`, blocage de finalisation, édition, révisions | Un scénario raffiné valide, traçable vers le brut, sans vérification faible non confirmée |
| **Lot 5 - Exécution** | Moteur en librairie, vérifications, rattrapage IA borné, reprise en mode script, rapport, patch suggéré | Rejeu réussi sans IA sur site inchangé, rattrapage réussi sur sélecteur volontairement cassé, patch produit mais non appliqué |
| **Lot 6 - Script généré** | Génération du script mince, `--headless` et paramètres, mode d'emploi | Script exécuté hors de Spyglass, en visible et en headless |
| **Lot 7 - Finition** | Application assistée des patchs (invariant F-62, confirmation F-63, branche et PR F-64, compteurs F-65), montée en précision optionnelle de la transcription (D-17), export/import, rejeu pas à pas dans l'interface, paramétrage des scénarios | Un patch de descripteur confirmé deux fois produit une PR revue puis fusionnée ; un patch de vérification reste en proposition ; scénario paramétré rejoué avec jeux de données distincts |

## 12. Points ouverts d'implémentation

Aucune décision structurante ne reste ouverte : les 17 arbitrages d'architecture sont actés
en section 10. Les points ci-dessous relèvent de l'implémentation et seront tranchés au sein
du lot concerné, sans remettre en cause le cadrage.

| ID | Point | Lot |
|---|---|---|
| I-01 | Résolution de la cible CDP correspondant à la vue affichée, et maintien de la liaison à travers navigations et recréations de contexte | Lot 0 |
| I-02 | Confirmation de l'hypothèse `loginRedirect` sur une application EntraID réelle (D-10). En cas d'invalidation, requalification vers le support d'une popup d'authentification éphémère non enregistrée | Lot 0 bis |
| I-03 | Version exacte du modèle du profil `fast` à figer, après mesure de latence et de qualité rédactionnelle en français | Lot 2 |
| I-04 | Gabarits de narration du mode dégradé : couverture des types d'événements et qualité rédactionnelle | Lot 2 |
| I-05 | Version exacte du modèle du profil `smart` à figer, après évaluation sur des raffinements et des diagnostics réels | Lot 4 |
| I-06 | Format exact de l'instantané DOM allégé, arbitrage entre volume et pouvoir diagnostique | Lot 1 |

## 13. Risques

| Risque | Impact | Atténuation |
|---|---|---|
| Sélecteurs fragiles sur applications à classes générées dynamiquement | Rejeu inexploitable | Descripteur multi-stratégies, priorité aux attributs stables et à l'accessibilité, rattrapage IA |
| Hypothèse `loginRedirect` invalidée sur une application cible | Blocage de l'authentification en entreprise | Confirmation en lot 0 bis, `pageId` prévu dès la v1 pour rendre le support popup additif |
| Indisponibilité réseau ou du fournisseur pendant un enregistrement | Narration perdue | Mode dégradé par gabarits (F-23), journalisation brute indépendante du réseau |
| Rafale d'événements sur une page pathologique | Consommation anormale, chat noyé | Seuil de débit à 60 appels par minute (F-73), mise en lot (F-24), bascule automatique en gabarits |
| Estimation monétaire erronée par tarifs obsolètes | Décision utilisateur faussée | Plafonnement en tokens et non en devise (F-70), table de tarifs versionnée et estimation présentée comme indicative (F-75) |
| Transmission involontaire de données sensibles au fournisseur de narration | Incident de confidentialité | Filtre d'expurgation unique et obligatoire (6.9), tests dédiés, désactivation possible de la narration LLM |
| Transcription locale imprécise en environnement bruyant | Intentions erronées dans le scénario | Édition des segments, affichage systématique du texte reconnu, détection d'activité vocale |
| Précision insuffisante de `whisper small` en français sur vocabulaire métier | Intentions mal transcrites dans l'artefact | Édition manuelle des segments (F-33), montée optionnelle proposée contextuellement (D-17, F-38) |
| Poids de l'installeur avec modèle de transcription embarqué | Adoption freinée | Modèle `small` quantifié retenu, de l'ordre de 190 Mo, le modèle plus lourd restant optionnel |
| Contrainte de souveraineté apparaissant après la v1 (D-15) | Remise en cause du fournisseur, voire du raffinement distant | Abstraction de fournisseur (F-29), filtre d'expurgation unique, alternative sur réseau privé déjà documentée |
| Modèle `smart` non multimodal configuré par l'utilisateur | Diagnostic dégradé sur les échecs visuels | Détection de capacité et avertissement explicite (F-61), repli documenté sur le DOM textuel |
| Sites détectant l'automatisation | Blocage du parcours | Navigateur réel, interaction humaine réelle, sonde passive |
| Dérive vers un agent autonome coûteux | Perte de l'avantage produit | Règle intangible : IA en rattrapage uniquement, `--no-ai` toujours possible |
| Auto-réparation affaiblissant silencieusement les assertions | Scénarios toujours verts, sans valeur de détection | Invariant F-62 non configurable, revue humaine obligatoire (F-64), compteurs de fragilité (F-65) |
| Accumulation de patchs masquant une refonte réelle de l'application | Scénario déconnecté du parcours métier | Marquage fragile puis obsolète (F-65), ré-enregistrement imposé |

## 14. Critères d'acceptation de la v1

1. Un utilisateur enregistre un parcours de connexion puis de recherche sur un site
   public, en 10 étapes, en commentant vocalement au moins 3 étapes.
2. Le parcours comprend au moins une interaction dans une iframe et une dans un composant
   web à shadow DOM ouvert, toutes deux correctement capturées.
3. Une authentification OIDC EntraID en flux `loginRedirect` se déroule intégralement dans
   la vue unique et est correctement enregistrée.
4. Le chat a décrit chaque action en langage naturel, avec le descripteur DOM associé, et
   la consommation de session reste sous 10 % du plafond de tokens par défaut.
5. Plafond abaissé artificiellement : l'avertissement apparaît à 50 %, la narration bascule
   en gabarits à 100 % avec un message explicite et une action de relèvement, et
   l'enregistrement se poursuit sans perte d'événement.
6. Coupure du réseau en cours d'enregistrement : la narration bascule en gabarits, la
   dictée reste opérationnelle, aucun événement n'est perdu, la bascule est journalisée.
7. L'artefact brut contient l'intégralité des événements, y compris les segments vocaux,
   et n'a pas été modifié par le raffinement.
8. L'artefact raffiné contient 10 étapes ou moins, chacune avec intention, action et
   vérification confirmée, sans répétition ni bruit.
9. La session complète occupe moins de 10 Mo sur disque.
10. Le script généré rejoue le scénario en mode visible, sans aucun appel LLM et sans clé
    d'API, et se termine avec un code de sortie nul.
11. Le même script rejoue le scénario en `--headless`.
12. Après modification volontaire d'un identifiant sur la page cible, le rejeu supervisé
    échoue à l'étape concernée, bascule en rattrapage IA, réussit, reprend en mode script
    jusqu'à la fin, et produit un patch suggéré non appliqué.
13. Le même rejeu, exécuté avec la variable `CI` positionnée et sans clé d'API, échoue
    proprement à l'étape concernée, sans tentative de rattrapage, avec un rapport
    exploitable et un code de sortie non nul.
14. Un patch portant sur un critère de vérification ou sur la structure du scénario reste
    en proposition et ne peut être appliqué par aucun chemin, y compris configuration
    modifiée.
15. Une revue du trafic sortant confirme qu'aucun flux audio, aucun secret et aucune valeur
    masquée n'ont été transmis.
