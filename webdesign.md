# Webdesign - Spyglass

Référentiel de design de Spyglass. Ce document est l'**entrée unique de l'agent
d'implémentation** : il contient les décisions actées, les tokens, les assets vectoriels
sources et les règles à respecter. Il complète `PRD.md` (le quoi) en décrivant le comment
visuel.

| Champ | Valeur |
|---|---|
| Produit | Spyglass |
| Version du document | 1.4 |
| Statut | 6 axes tranchés (W-01 à W-05, W-08) et 3 contradictions internes arbitrées (X-1 à X-3, section 8.1). Icônes des deux grilles livrées et gelées. Points encore ouverts : section 8 |
| Moodboard source | `.lavish/spyglass-design.html` (10 directions rendues, 10 marques SVG, démos de motion, ratios WCAG calculés) |
| Dernière mise à jour | 2026-09-07 |
| Portée | Coquille, chat, réglages (F-29), identité, iconographie. Les écrans des lots 3 à 7 ne sont pas encore spécifiés (O-5) |

> **Comment lire ce document.** Les sections 2 à 6 sont normatives : elles se transposent
> directement en code. La section 1 explique pourquoi, et sert à trancher les cas non
> prévus sans avoir à revenir demander. Pour visualiser une direction écartée ou comparer
> une alternative, ouvrir le moodboard : `npx -y lavish-axi .lavish/spyglass-design.html`.

---

## 0. Décisions actées

| ID | Axe | Décision |
|---|---|---|
| W-01 | Direction graphique | **D1 Nocturne Optique** : fond quasi noir, un faisceau cyan qui désigne, magenta réservé à l'enregistrement |
| W-02 | Palette | **P1 cyan / magenta**, thème sombre par défaut **et thème clair jumeau** partageant les mêmes noms de tokens |
| W-03 | Identité | **L6 Le Diaphragme** : six lames d'ouverture inscrites dans un cercle |
| W-04 | Iconographie | **Jeu maison**, contour 1,75 px sur grille 24, le plein étant strictement réservé aux états |
| W-05 | Assets vectoriels | **Sprite `<symbol>` + `<use>`** pour les icônes, **logo en SVG inline** animable |
| W-06 | Conséquence de W-03 | La marque à 6 lames est illisible sous 20 px : une **variante à 3 lames** est obligatoire pour le favicon et les petites tailles (voir 4.2) |
| W-08 | Implantation des réglages | **Fenêtre unique, onglets `Navigateur` / `Réglages`**. Le second onglet masque la vue web par `setVisible(false)` et conserve la colonne de chat (voir 3.4) |
| W-07 | Conséquence de W-02 | Le thème clair n'est pas optionnel ni secondaire : 75 % de l'écran affiche des sites tiers majoritairement clairs, et le produit est projeté en réunion |

---

## 1. Principes directeurs

### 1.1 Ce que le design doit servir

Spyglass n'est pas un outil de conversation : c'est un **instrument d'observation** dont la
sortie est un artefact. Trois conséquences structurantes.

1. **La page cible est le sujet, l'interface est le cadre.** L'application ne doit jamais
   entrer en concurrence visuelle avec les 75 % d'écran occupés par le site observé. Aucune
   couleur saturée en grande surface, aucun mouvement dans le champ périphérique de la vue
   navigateur.
2. **Le chat est un journal dense, pas une messagerie.** À 25 % de largeur sur un écran
   1440, la colonne fait environ 340 px. Chaque pixel de padding s'y paie. Le rythme visuel
   y est celui d'un log lisible, pas celui d'une conversation aérée.
3. **Chaque état du système doit se voir sans être lu.** Enregistrement, mode dégradé,
   vérification faible, échec, scénario fragile : cinq états portés par cinq couleurs
   distinctes, doublées d'une forme ou d'un libellé.

### 1.2 Contraintes non négociables

| # | Contrainte | Origine | Conséquence de design |
|---|---|---|---|
| C-1 | **Zéro pixel injecté dans la page cible** | PRD 6.5 : la sonde est passive et invisible | L'indicateur d'enregistrement (F-07), les surbrillances de cible et tout overlay appartiennent à la **coquille Electron**, jamais au DOM observé. Deux mécanismes distincts, voir C-1 bis |
| C-1 bis | **Surbrillance de cible par vue transparente empilée** (arbitrage X-3) | 3.2 : désigner l'élément narré, pas seulement la vue | Le signal périphérique (cadre d'enregistrement, liserés) est peint **autour** de la `WebContentsView`. La surbrillance d'un **élément précis** exige en plus une **seconde vue transparente empilée au-dessus** de la vue web, dans laquelle la coquille dessine le cadre. Elle suppose que la sonde expose les rectangles englobants : **exigence à porter dans le PRD** (voir 8.2) |
| C-2 | Colonne de chat à 25 % | F-01 | Corps de texte `--sg-text-sm`, mono `--sg-text-xs`, padding horizontal `--sg-space-5`, largeur minimale `--sg-chat-min` |
| C-3 | Deux registres de texte | F-21 | Paire sans-serif / monospace obligatoire, le bloc technique étant toujours repliable |
| C-4 | Le mode dégradé doit être visible | F-23 | État visuel dédié (désaturation + liseré ambre + étiquette), jamais une simple ligne de texte |
| C-5 | **Aucune animation ne retarde l'accusé de réception d'une entrée utilisateur** | PRD CA-04 : étape affichée en moins de 200 ms | Un clic, une frappe ou une dictée produisent leur effet **immédiatement** ; l'animation accompagne le résultat, elle ne le précède jamais et n'est jamais attendue avant de rendre. Les transitions de 3.1 et 3.2 sont donc licites. Restent proscrits sur grande surface : `backdrop-filter`, ombres empilées, dégradés animés |
| C-6 | Contrastes conformes, chat au clavier | PRD 8 | AA minimum partout, AAA sur le corps de texte, focus dessiné et jamais uniquement lumineux |
| C-7 | Trois personas sur un seul écran | PRD 3 | La densité technique est **repliable**, jamais supprimée : l'expert métier voit la phrase, l'automaticien déplie le descripteur |

### 1.3 Règle du néon

Le néon de Spyglass est un **effet lumineux**, séparé de la couleur du texte. Il ne porte
jamais une information seul.

- Source unique : les tokens `--sg-glow-accent` et `--sg-glow-rec` (section 2). Une seule
  ombre, jamais empilée, jamais réécrite à la main. En thème clair ces tokens valent `none` :
  le néon n'y existe pas optiquement, le signal passe alors par la bordure et le libellé.
- **Autorisé** : pastille REC, contour de l'élément désigné par l'agent, bouton primaire au
  survol et au focus, indicateur de niveau micro.
- **Interdit** : texte de narration, blocs techniques, toute surface supérieure à
  200 × 80 px, toute surface repeinte plus d'une fois par seconde, la bande de 8 px
  jouxtant la `WebContentsView`.
Les préférences système `prefers-contrast` et `prefers-reduced-motion` sont traitées une
seule fois, dans `tokens.css` (section 2) : halos neutralisés, durées mises à zéro. Aucun
composant ne redéclare ces media queries.

---

## 2. Design tokens

Source de vérité : un seul fichier `src/renderer/styles/tokens.css`. Aucune valeur
hexadécimale ne doit apparaître ailleurs dans le code.

```css
/* tokens.css - Spyglass, direction D1 Nocturne Optique */

:root {
  /* Typographie */
  --sg-font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --sg-font-display: "Inter Tight", "Inter", ui-sans-serif, system-ui, sans-serif;
  --sg-font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;

  --sg-text-2xs: 10px;   /* horodatage, compteurs */
  --sg-text-xs:  11px;   /* bloc technique monospace */
  --sg-text-sm:  13px;   /* corps du chat - taille de référence */
  --sg-text-md:  14px;   /* UI de la coquille */
  --sg-text-lg:  16px;
  --sg-text-xl:  20px;
  --sg-text-2xl: 26px;

  --sg-leading-tight: 1.25;
  --sg-leading-body:  1.45;   /* chat */
  --sg-tracking-caps: 0.08em; /* REC, étiquettes d'état */

  /* Espacement - échelle indicielle, pas un multiple : l'index n'est pas la valeur.
     Toute distance des sections 3 à 7 doit référencer un de ces tokens. */
  --sg-space-1: 2px;  --sg-space-2: 4px;  --sg-space-3: 6px;  --sg-space-4: 8px;
  --sg-space-5: 12px; --sg-space-6: 16px; --sg-space-7: 24px; --sg-space-8: 32px;

  /* Rayons */
  --sg-radius-xs: 4px; --sg-radius-sm: 6px; --sg-radius-md: 10px;
  --sg-radius-lg: 14px; --sg-radius-pill: 999px;

  /* Mouvement */
  --sg-dur-fast: 120ms;      /* changement d'état atomique */
  --sg-dur-base: 160ms;      /* message entrant */
  --sg-dur-slow: 240ms;      /* bascule de régime, dépli */
  --sg-dur-pulse: 2000ms;    /* période de pulsation REC */
  --sg-dur-brand: 400ms;     /* ouverture du logo au lancement */
  --sg-ease-standard: cubic-bezier(.2, .8, .2, 1);
  --sg-ease-exit: cubic-bezier(.4, 0, 1, 1);

  /* Structure */
  --sg-split-default: 75%;   /* F-01 */
  --sg-chat-min: 300px;
  --sg-gutter: 8px;          /* zone tampon entre la vue web et le chat */
  --sg-rec-frame: 2px;

  /* Élévation - seules valeurs de z-index autorisées */
  --sg-z-base: 0;      --sg-z-sticky: 10;   /* en-tête de chat, barre d'URL */
  --sg-z-overlay: 20;  /* couche d'overlay au sein d'une vue ; la surbrillance de cible,
                          elle, vit dans une vue Electron distincte empilée (C-1 bis) */
  --sg-z-dialog: 30;   --sg-z-toast: 40;    --sg-z-tooltip: 50;
}

/* ---------- Thème sombre (défaut) ---------- */
:root, [data-theme="dark"] {
  color-scheme: dark;

  --sg-bg:            #06090F;
  --sg-bg-elev:       #0B111E;
  --sg-surface:       #0E1524;
  --sg-surface-2:     #131C30;
  --sg-border:        #1E2A44;
  --sg-border-strong: #2C3C5E;

  --sg-text:          #E8F0FF;  /* 17,4:1 sur bg - AAA */
  --sg-text-muted:    #8FA3C8;  /*  7,8:1 sur bg - AAA */

  --sg-accent:        #35F2FF;  /* 14,5:1 - l'agent observe et désigne */
  --sg-accent-ink:    #06090F;  /* texte posé sur accent */
  --sg-rec:           #FF3D9A;  /*  6,1:1 - enregistrement, exclusivement */
  --sg-success:       #3DFFA8;  /* 15,3:1 - vérification tenue */
  --sg-warning:       #FFC44D;  /* 12,6:1 - mode dégradé, weak, seuil 50 % */
  --sg-danger:        #FF6B6B;  /*  7,2:1 - échec, scénario obsolète */

  --sg-glow-accent: 0 0 14px color-mix(in oklab, var(--sg-accent) 55%, transparent);
  --sg-glow-rec:    0 0 14px color-mix(in oklab, var(--sg-rec) 55%, transparent);
  --sg-shadow-1: 0 1px 2px rgb(0 0 0 / .40);
  --sg-shadow-2: 0 6px 20px rgb(0 0 0 / .45);
}

/* ---------- Thème clair jumeau ---------- */
[data-theme="light"] {
  color-scheme: light;

  --sg-bg:            #F7F9FC;
  --sg-bg-elev:       #EEF2F8;
  --sg-surface:       #FFFFFF;
  --sg-surface-2:     #F0F4FA;
  --sg-border:        #E2E8F2;
  --sg-border-strong: #C9D4E5;

  --sg-text:          #0B1220;  /* 17,8:1 - AAA */
  --sg-text-muted:    #4E5D78;  /*  6,3:1 - AA+ */

  --sg-accent:        #0072A8;  /*  5,0:1 - AA */
  --sg-accent-ink:    #FFFFFF;
  --sg-rec:           #C2185B;  /*  5,6:1 - AA */
  --sg-success:       #0F7A5A;  /*  5,0:1 */
  --sg-warning:       #8A5A00;  /*  5,6:1 */
  --sg-danger:        #C2261F;  /*  5,5:1 */

  --sg-glow-accent: none;  /* pas de néon en thème clair : il n'existe pas optiquement */
  --sg-glow-rec:    none;
  --sg-shadow-1: 0 1px 2px rgb(11 18 32 / .08);
  --sg-shadow-2: 0 6px 20px rgb(11 18 32 / .10);
}

@media (prefers-contrast: more) {
  :root { --sg-glow-accent: none; --sg-glow-rec: none; --sg-border: var(--sg-border-strong); }
}
@media (prefers-reduced-motion: reduce) {
  :root {
    --sg-dur-fast: 0ms; --sg-dur-base: 0ms; --sg-dur-slow: 0ms;
    --sg-dur-brand: 0ms;
    /* la pulsation n'est pas raccourcie, elle est supprimée : voir 3.1 */
  }
}
```

**Vérification obligatoire au lot 2** : un test automatisé calcule le ratio de contraste de
chaque paire texte/fond des deux thèmes et échoue sous 4,5:1.

**Le seuil AAA de 7:1 s'applique à la seule phrase de narration** : `--sg-text` à
`--sg-text-sm`, la ligne que l'expert métier lit réellement. Horodatages, compteurs,
étiquettes d'état et bloc technique monospace relèvent du seuil AA de 4,5:1 : ce sont des
métadonnées, volontairement en retrait, et les exiger à 7:1 forcerait à assombrir
`--sg-text-muted` en thème clair sans bénéfice de lisibilité.
Les ratios en commentaire ci-dessus sont calculés, pas estimés ; ils constituent la valeur
attendue du test, à 0,1 près.

Le test couvre **trois familles de paires**, pas seulement texte sur `--sg-bg` :

1. chaque token de texte et de sémantique sur `--sg-bg`, `--sg-bg-elev`, `--sg-surface` et
   `--sg-surface-2` ;
2. `--sg-accent-ink` sur `--sg-accent` et sur `--sg-rec` (boutons pleins) ;
3. les fonds composites en `color-mix`, à commencer par celui du message utilisateur (3.2),
   dont le résultat doit être résolu puis mesuré, jamais supposé équivalent à `--sg-surface`.

### 2.1 Sémantique de couleur

Cinq couleurs, cinq sens, aucun recouvrement. C'est cette discipline, plus que la teinte
choisie, qui rend l'interface lisible en trois secondes.

| Token | Sens unique | Où il apparaît |
|---|---|---|
| `--sg-accent` cyan | **L'agent observe / désigne** | Contour de l'élément narré, liens, bouton primaire, niveau micro |
| `--sg-rec` magenta | **Ça enregistre** | Cadre de fenêtre, pastille REC, pupille du logo, bouton Stop |
| `--sg-success` vert | **Vérification tenue** | Étape validée, vérification `strong`, rejeu réussi |
| `--sg-warning` ambre | **Régime dégradé ou incertain** | Narration en gabarits (F-23), vérification `weak`, seuil 50 % (F-72), scénario fragile (F-65) |
| `--sg-danger` rouge | **Échec** | Étape en échec, scénario obsolète, plafond atteint |

Aucune de ces couleurs ne sert de couleur décorative. Aucun autre usage n'est autorisé sans
mise à jour de ce tableau.

### 2.2 Polices embarquées

Spyglass fonctionne hors ligne (PRD 8, mode dégradé F-23) : **aucune police n'est chargée
depuis un CDN**. Les trois familles sont versionnées dans le dépôt et déclarées en
`@font-face` local.

| Famille | Emploi | Graisses livrées | Format |
|---|---|---|---|
| Inter | corps, UI | 400, 500, 600 | `woff2` variable, axe `wght` 400-600 |
| Inter Tight | wordmark, titres | 600 | `woff2` statique |
| JetBrains Mono | blocs techniques, barre d'URL | 400, 500 | `woff2` statique |

- Sous-jeu latin + latin-étendu uniquement (`unicode-range`), diacritiques françaises
  incluses. Aucun jeu cyrillique ou grec.
- `font-display: block` : le renderer est local, il n'y a pas de FOUT à arbitrer, et un
  échange de métriques décalerait la colonne de chat.
- Budget total des polices : **< 400 Ko**.
- Les fallbacks déclarés dans `--sg-font-*` restent la sécurité en cas de fichier absent ;
  ils ne sont jamais le chemin nominal.
- Inter Tight n'est utilisée que par le wordmark, lui-même vectorisé au build (4.4) : elle
  n'est embarquée que si un titre d'interface l'emploie réellement.

---

## 3. Écrans signature

### 3.1 Coquille (F-01 à F-07)

```
┌────────────────────────────────────────────────────────────────────┐
│  ◄ ►  ⟳   https://app.exemple.fr/connexion              ● REC     │ 40px
├──────────────────────────────────────────┬─────────────────────────┤
│                                          │  chat / narration       │
│   WebContentsView                        │                         │
│   contenu tiers, non stylable            │  messages agent         │
│   75 % par défaut, séparateur draggable  │  segments vocaux        │
│                                          │  compteur de tokens     │
│                                          │                         │
│                                          ├─────────────────────────┤
│                                          │  [ micro ]  [ RECORD ]  │ 56px
└──────────────────────────────────────────┴─────────────────────────┘
        ▲ cadre magenta 2px pendant l'enregistrement, rendu par la coquille (C-1)
```

Règles de mise en oeuvre :

- **Gouttière** de `--sg-gutter` entre la vue web et le chat, remplie par `--sg-bg`, plus
  une ombre interne `inset var(--sg-gutter) 0 12px calc(-1 * var(--sg-gutter)) rgb(0 0 0 / .5)`
  côté vue web. Elle amortit la jonction entre un site clair et une interface sombre
  (C-1, W-07).
- **Séparateur** redimensionnable, zone de saisie de `--sg-space-3`, curseur `col-resize`,
  retour au ratio `--sg-split-default` par double-clic. Largeur de chat bornée à
  `--sg-chat-min`.
- **Cadre d'enregistrement** : bordure de `--sg-rec-frame` en `--sg-rec` sur le conteneur
  de la vue, plus la pastille REC dans la barre. Pulsation de `--sg-dur-pulse`.
  Sous `prefers-reduced-motion: reduce`, l'animation est **supprimée**, pas accélérée :
  mettre sa durée à zéro produirait un clignotement continu. L'état devient fixe, la
  pastille restant pleine et opaque.
- **Barre d'URL** : `--sg-font-mono`, `--sg-text-sm`, troncature au milieu (le domaine et
  la fin de chemin restent lisibles), état de chargement en liseré `--sg-accent` de
  `--sg-rec-frame` sous la barre.

### 3.2 Message d'étape dans le chat

Structure canonique, valable pour tout message d'événement :

```
┌─────────────────────────────────────┐
│ 12:04:31  ⟐ étape 03                │  --sg-text-2xs, --sg-text-muted
│ Tu as cliqué sur « Se connecter »   │  --sg-text-sm, --sg-text, phrase naturelle
│ ▸ descripteur DOM                   │  --sg-text-xs mono, replié (C-3, C-7)
└─────────────────────────────────────┘
```

- Fond `--sg-surface`, bordure 1 px `--sg-border`, rayon `--sg-radius-md`, padding
  `var(--sg-space-3) var(--sg-space-5)`, espacement vertical `--sg-space-2` entre messages.
- **Message utilisateur** (dictée) : bordure gauche de `--sg-rec-frame` en `--sg-accent`, fond
  `color-mix(in oklab, var(--sg-accent) 6%, var(--sg-surface))`.
- **Dépli du bloc technique** : animation de `grid-template-rows: 0fr` vers `1fr` sur
  `--sg-dur-slow`, jamais de `height: auto` animée.
- **Entrée d'un message** : `translateY(6px)` + `opacity 0 → 1`, `--sg-dur-base`,
  `--sg-ease-standard`. La liste ne se réordonne jamais : ajout en fin, défilement suivi
  seulement si l'utilisateur est déjà en bas.
- **Cible désignée** : quand un message est survolé ou sélectionné, l'élément correspondant
  est surligné dans la vue web par un cadre de 2 px en `--sg-accent`, dessiné dans la
  **vue transparente empilée** décrite en C-1 bis, jamais par injection de style dans la
  page. Le cadre suit un rectangle englobant fourni par la sonde ; il disparaît dès que le
  message perd le survol ou la sélection, et n'est jamais persistant.
- **Coût de la surbrillance** : la vue d'overlay n'est instanciée qu'à la première
  désignation, jamais au démarrage, et reste `ignoreMouseEvents`. Elle ne doit intercepter
  ni clic, ni défilement, ni focus : la page cible reste pleinement utilisable pendant
  qu'un élément est désigné.

### 3.3 États produit

| État | Traitement visuel | Exigence |
|---|---|---|
| Enregistrement actif | Cadre magenta + pastille REC pulsée + pupille du logo magenta | F-07 |
| Narration dégradée | Messages désaturés (`filter: grayscale(.85)`), liseré ambre à gauche, étiquette `gabarit déterministe` en `--sg-text-2xs` mono | F-23, C-4 |
| Seuil de tokens 50 % | Jauge passant en ambre + message d'avertissement dans le chat, action « relever le plafond » | F-72 |
| Plafond atteint | Jauge rouge, bascule en gabarits annoncée, l'enregistrement continue visiblement | F-72 |
| Vérification `weak` | Puce ambre sur l'étape + blocage explicite du bouton « Générer le script » avec compteur restant | F-44 |
| Étape en échec au rejeu | Bordure `--sg-danger`, capture d'écran jointe, bouton « voir le diagnostic » | F-56 |
| Scénario fragile / obsolète | Bandeau ambre puis rouge en tête de scénario, jamais un simple badge | F-65 |

**Jauge de tokens** : animation du remplissage uniquement au franchissement d'un palier
(50 %, 100 %), `--sg-dur-slow`. Une mise à jour par appel LLM serait un scintillement
permanent.

### 3.4 Réglages des profils LLM (F-29, P0, lot 2)

C'est le seul écran du produit qui ne soit ni la vue web ni le chat, et il est **P0**.

**Où il s'affiche.** Fenêtre unique, **navigation par onglets** dans la barre supérieure :
`Navigateur` et `Réglages`. Basculer sur `Réglages` **masque** la `WebContentsView` et rend
le formulaire à sa place. Trois points d'implémentation, non négociables :

- Le masquage se fait par `view.setVisible(false)`, **jamais** en réduisant ses `bounds` à
  zéro : un redimensionnement serait observable par le site cible, qui déclencherait ses
  media queries et ses `ResizeObserver` en plein enregistrement (C-1). `setVisible` ne
  touche pas à la mise en page de la page observée.
- **La colonne de chat reste visible et vivante.** Elle n'est pas recouverte : les réglages
  occupent la seule zone de la vue web. Le journal continue de se remplir pendant qu'on
  règle, ce qui est indispensable puisque l'enregistrement n'est jamais interrompu (F-40)
  et que le message de bascule de profil s'y affiche. À 75 % d'un écran 1440, la zone fait
  environ 1080 px : largement de quoi loger deux profils côte à côte.
- **Pendant un enregistrement**, l'onglet `Navigateur` porte la pastille REC et le cadre
  `--sg-rec` reste dessiné autour de la zone, réglages affichés compris. On ne doit jamais
  pouvoir oublier qu'on enregistre parce qu'on a changé d'onglet.

```
┌──────────────────────────────────────────┬─────────────────────────┐
│ [ Navigateur ● ] [ Réglages ]            │  chat / narration       │ 40px
├──────────────────────────────────────────┤                         │
│  Profil fast - narration                 │  messages agent         │
│  ┌────────────────────────────────────┐  │                         │
│  │ Fournisseur   [anthropic        ▾] │  │  le journal continue    │
│  │ Modèle        [claude-haiku…     ] │  │  de se remplir          │
│  │ Point d'entrée[                  ] │  │                         │
│  │ Clé d'API     [••••••••••••]  🔒   │  │                         │
│  │                      [ Tester ]    │  │                         │
│  │ ✓ Connexion établie, 340 ms        │  │                         │
│  └────────────────────────────────────┘  │                         │
│  Profil smart - raffinement, rattrapage  ├─────────────────────────┤
│  …                     [Annuler][Enreg.] │  [ micro ]  [ RECORD ]  │
└──────────────────────────────────────────┴─────────────────────────┘
```

**Règles propres à cet écran.**

- **Origine de chaque valeur, toujours visible.** La précédence du PRD 7 est
  `interface > variables d'environnement > défaut` : une valeur non modifiée porte une
  puce en `--sg-text-2xs` indiquant sa provenance (`défaut`, `env`, `réglée`). Sans cela,
  un utilisateur dont la clé vient de l'environnement croit le champ vide et la ressaisit.
- **Clé d'API** : champ masqué, `--sg-font-mono`, jamais révélable en clair, jamais
  recopiée dans le presse-papiers. Une clé déjà enregistrée affiche un gabarit de longueur
  fixe, pas sa vraie longueur. Cadenas `secret` à droite du champ (5.2).
- **Test de connexion** : trois états explicites, jamais un simple booléen. En attente
  (bouton désactivé, libellé « test en cours »), succès (`--sg-success`, latence mesurée
  affichée), échec (`--sg-danger`, **message du fournisseur repris tel quel**, tronqué à
  deux lignes et dépliable). Diagnostiquer une clé refusée sans le message du fournisseur
  est impossible.
- **Sans redémarrage** (F-29) : l'enregistrement en cours n'est jamais interrompu. Si un
  profil change pendant une session active, un message de chat en `--sg-warning` l'indique
  et horodate la bascule, pour que la narration reste traçable.
- **Plafonds** (F-70 à F-72) : `SESSION_TOKEN_LIMIT_FAST`, `TOKEN_WARN_RATIO`,
  `RATE_LIMIT_CALLS_PER_MIN`, `SMART_TOKEN_CONFIRM`. Exprimés **en tokens, jamais en
  devise** : aucun champ monétaire, aucune estimation de coût dans cet écran.
- **Valeurs par défaut proposées, jamais imposées** (F-29) : chaque champ porte une action
  « rétablir la valeur par défaut », qui ne s'active que si la valeur a été modifiée.
- Aucune clé n'apparaît jamais dans le chat, dans un artefact ni dans un journal (PRD 9).
  Cette fenêtre est le seul endroit du produit où une clé est saisissable.

### 3.5 Focus et clavier (C-6)

```css
:where(a, button, input, textarea, select, [tabindex]):focus-visible {
  outline: 2px solid var(--sg-accent);
  outline-offset: 2px;
  box-shadow: var(--sg-glow-accent);
}
```

Le halo est un supplément, jamais le signal. Ordre de tabulation : onglets
`Navigateur` / `Réglages`, barre d'URL, contrôles de navigation, vue web, liste du chat,
composeur, bouton Record. Les onglets sont un `role="tablist"` navigable aux flèches, et
`Réglages` reste atteignable au clavier pendant un enregistrement. La liste du chat est
navigable par flèches, `Entrée` dépliant le bloc technique de l'étape courante.

---

## 4. Identité visuelle - L6 Le Diaphragme

### 4.1 Concept et construction

Six lames d'ouverture inscrites dans un cercle. La métaphore : Spyglass **ouvre l'obturateur
sur un parcours, le capture, le referme**. Elle relie l'optique du nom au geste
d'enregistrement, sans tomber dans l'oeil de surveillance.

- Grille 64 × 64, cercle de rayon 21 centré en (32, 32), trait 3.
- Une lame unique `M32 11 L47 28`, répétée par rotation de 60° autour du centre. Aucun
  tracé singulier à maintenir : modifier la lame modifie la marque entière.
- Terminaisons rondes, aucune jointure aiguë.
- Zone de protection : un rayon de lame, soit 11 px sur la grille 64.

**Marque principale** - `assets/brand/logo-diaphragm.svg` :

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"
     stroke="currentColor" stroke-width="3" stroke-linecap="round" role="img">
  <title>Spyglass</title>
  <circle cx="32" cy="32" r="21"/>
  <path d="M32 11 47 28"/>
  <path d="M32 11 47 28" transform="rotate(60 32 32)"/>
  <path d="M32 11 47 28" transform="rotate(120 32 32)"/>
  <path d="M32 11 47 28" transform="rotate(180 32 32)"/>
  <path d="M32 11 47 28" transform="rotate(240 32 32)"/>
  <path d="M32 11 47 28" transform="rotate(300 32 32)"/>
</svg>
```

### 4.2 Variante petite taille (W-06, obligatoire)

À 16 px, six lames produisent une tache. La variante à trois lames, trait épaissi, est la
seule autorisée sous 20 px : favicon, barre de titre, notification système, liste de
fichiers.

`assets/brand/logo-diaphragm-16.svg` :

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"
     stroke="currentColor" stroke-width="5" stroke-linecap="round" role="img">
  <title>Spyglass</title>
  <circle cx="32" cy="32" r="20"/>
  <path d="M32 12 46 29"/>
  <path d="M32 12 46 29" transform="rotate(120 32 32)"/>
  <path d="M32 12 46 29" transform="rotate(240 32 32)"/>
</svg>
```

Seuil de bascule : `width < 20px` utilise la variante 3 lames. À implémenter dans le
composant `<Logo>`, pas au cas par cas.

### 4.3 Variante d'état « enregistrement »

Le logo porte l'état de l'application, dans la barre de titre comme dans le dock : les
lames se referment de 12° et une pupille magenta apparaît au centre.

```svg
<!-- logo-diaphragm-rec.svg : lames pivotées, pupille en --sg-rec -->
<g transform="rotate(12 32 32)"> <!-- les 6 lames --> </g>
<circle cx="32" cy="32" r="5.5" fill="var(--sg-rec, #FF3D9A)" stroke="none"/>
```

### 4.4 Lockups

| Variante | Composition | Emploi |
|---|---|---|
| Symbole seul | marque 1:1 | favicon, dock, barre de titre, avatar |
| Horizontal | symbole + mot, écart = 0,4 × hauteur du symbole | en-tête d'application, README, site |
| Empilé | symbole au-dessus, mot centré, écart = 0,3 × hauteur | splash, écran de démarrage, supports carrés |

Wordmark : **Inter Tight 600**, interlettrage `-0.02em`, en capitales initiales
(`Spyglass`, jamais `SPYGLASS`). Le mot est **vectorisé au build** dans les fichiers de
marque : aucun lockup livré ne doit dépendre d'une police installée.

### 4.5 Tests éliminatoires

Tout changement de la marque repasse ces cinq tests avant fusion.

1. **16 px** : silhouette identifiable (variante 3 lames).
2. **Monochrome** : noir sur blanc et blanc sur noir, sans perte.
3. **Inversé** : sur fond `--sg-accent` et sur fond `--sg-rec`.
4. **Aplati** : rendu correct en `fill` unique, sans dépendance à `stroke`.
5. **Impression** : télécopie 1 bit, aucun aplat de gris nécessaire.

### 4.6 Animation

- **Lancement de l'application** : ouverture des lames, rotation de 30° vers 0°,
  `--sg-dur-brand`, `--sg-ease-standard`, une seule fois. Le token tombe à zéro sous
  `prefers-reduced-motion`, le logo s'affiche alors directement ouvert.
- **Bascule en enregistrement** : fermeture de 12° + apparition de la pupille,
  `--sg-dur-slow`.
- **Aucune animation permanente** : le logo ne tourne pas en boucle, jamais.

---

## 5. Iconographie

### 5.1 Règles de famille (W-04)

**Deux tailles optiques, jamais une seule mise à l'échelle** (arbitrage X-2). Chaque
concept existe en deux dessins distincts, dans deux grilles distinctes :

| Taille | Grille | Trait | Aire visuelle | Emploi |
|---|---|---|---|---|
| `ic-*-16` | 16 × 16 | 1,25 px | 14 × 14 | colonne de chat, densité `--sg-text-sm` et en dessous |
| `ic-*-24` | 24 × 24 | 1,75 px | 20 × 20 | coquille : barre d'URL, contrôles, boutons |

- Zone de sécurité : 1 px en grille 16, 1,5 px en grille 24.
- On **redessine**, on n'échelonne jamais : `vector-effect` proscrit, et aucune des deux
  grilles n'est rendue à une taille autre que la sienne. Le dessin 16 simplifie la
  métaphore (moins de détails, angles ouverts), il n'est pas une réduction du dessin 24.
- Rayons extérieurs 3, intérieurs 1,5 en grille 24 ; 2 et 1 en grille 16.
- Terminaisons et jointures rondes dans les deux grilles.
- **Contour par défaut. Le plein est réservé aux états** : pastille d'enregistrement, carré
  d'arrêt, noeud actif. Un aplat signifie « cela se produit maintenant ».
- Une métaphore par concept, jamais réutilisée ailleurs. Le disque plein n'appartient qu'à
  l'enregistrement.
- Couleur exclusivement par `currentColor`. Aucune valeur en dur dans le fichier.
- Bi-chromie éventuelle par variable interne : `fill="var(--ico-accent, currentColor)"`.

### 5.2 Jeu initial

Seize concepts, dont six qui n'existent dans aucune librairie du marché et justifient à
elles seules le jeu maison. **Seize concepts font trente-deux fichiers** : une grille 16 et
une grille 24 par concept (5.1).

| Nom | Concept | Note |
|---|---|---|
| `record` | Enregistrement | Disque plein dans un cercle |
| `stop` | Arrêt | Carré plein dans un cadre |
| `mic` | Dictée | F-30 |
| `wave` | Segment vocal | F-31 |
| `observe` | Observation Stagehand | Lentille |
| `refine` | Raffinement | F-41 |
| `script` | Script généré | F-45 |
| `replay` | Rejeu | F-59 |
| `patch` | Patch suggéré | **spécifique** - F-57 |
| `tokens` | Consommation | **spécifique** - F-28 |
| `frame` | Iframe | **spécifique** - F-13 |
| `shadow` | Shadow DOM ouvert | **spécifique** - D-09 |
| `secret` | Valeur masquée | **spécifique** - F-15 |
| `offline` | Mode dégradé | **spécifique** - F-23 |
| `verify` | Vérification | F-44 |
| `branch` | Branche et pull request | F-64 |

**État des dessins.** Les seize tracés en **grille 24** existent, dessinés et rendus, dans
`.lavish/spyglass-design.html` (recherche : `<symbol id="ic-`). Ils sont à extraire tels
quels vers `assets/icons/24/*.svg` : ils respectent déjà la grille et le trait.

Les seize dessins en **grille 16** sont livrés dans `assets/icons/16/`. Ils sont
**redessinés**, non réduits : métaphore simplifiée, détails secondaires supprimés
(`wave` passe de cinq à quatre barres, `secret` perd son trou de serrure, `tokens` réduit
son pivot), et chaque tracé tient dans l'aire visuelle 14 × 14 avec la zone de sécurité de
1 px, stroke comprise.

---

## 6. Stratégie d'assets vectoriels (W-05)

### 6.1 Décision, et son motif réel

Le sprite `<symbol>` a été popularisé pour économiser des requêtes HTTP et profiter du
cache navigateur. **Spyglass est une application Electron chargée depuis le disque : cet
argument ne vaut rien ici.** Le sprite est retenu pour une autre raison, propre au produit :

> Une session de 50 étapes affiche 150 à 400 messages, portant chacun une à trois icônes.
> En SVG inline, cela représente jusqu'à 1 200 sous-arbres SVG dupliqués dans le DOM du
> renderer, à repeindre et à conserver en mémoire. Avec `<use>`, chaque instance est un
> noeud unique pointant vers une définition unique.

Le logo, lui, reste **inline** : il n'y en a qu'un, il doit être animable par CSS sur ses
parties internes (lames, pupille), ce que `<use>` interdit en pratique.

| Cas d'usage | Décision | Budget |
|---|---|---|
| Logo | SVG inline, composant `<Logo>` unique gérant les variantes 6/3 lames et l'état REC | < 2 Ko |
| Jeu d'icônes UI | Sprite `<symbol>` unique, inliné au build, contenant les **deux grilles** | < 20 Ko pour 32 symboles |
| Illustrations et états vides | SVG optimisés, thémés par `currentColor` | < 8 Ko pièce, 3 à 5 visuels |
| Icône d'application | Raster multi-tailles **généré** depuis le SVG maître (ICO, ICNS, PNG) | 12 déclinaisons, jamais dessinées à la main |
| Overlay d'enregistrement | **Interdit dans la page cible** (C-1) : rendu par la coquille | - |

Icon font : écartée définitivement (accessibilité, rendu flou, pas de bi-chromie).

### 6.2 Chaîne de production

```
assets/brand/*.svg    ─┐
assets/icons/16/*.svg ─┼─► SVGO (currentColor forcé, ids préservés)
assets/icons/24/*.svg ─┘
                          ├─► sprite.svg (<symbol>)      ─► injecté dans index.html
                          ├─► composant <Logo> inline
                          ├─► icône applicative (ico/icns/png)
                          └─► docs, README, site vitrine
```

Une seule source, plusieurs sorties. **Aucun SVG n'est édité à deux endroits** : c'est la
seule règle qui tienne à dix-huit mois.

Configuration SVGO attendue : `removeViewBox: false`, `cleanupIds: false` (les identifiants
de symboles sont un contrat), conversion des couleurs en `currentColor`, suppression des
attributs `width` et `height` racine.

### 6.3 Contrat d'implémentation

```html
<!-- sprite.svg, inliné au build dans index.html : un symbole par grille -->
<symbol id="ic-record-16" viewBox="0 0 16 16" fill="none"
        stroke="currentColor" stroke-width="1.25">…</symbol>
<symbol id="ic-record-24" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="1.75">…</symbol>

<!-- icône décorative : le sens est porté par le texte voisin -->
<svg class="ico ico-16" aria-hidden="true"><use href="#ic-record-16"/></svg>

<!-- icône porteuse de sens : titre obligatoire -->
<svg class="ico ico-24" role="img"><title>Enregistrement en cours</title>
  <use href="#ic-record-24"/></svg>
```

```css
.ico    { color: inherit; flex: none; }
.ico-16 { width: 16px; height: 16px; }
.ico-24 { width: 24px; height: 24px; }
```

**`width: 1em` est proscrit.** Dimensionner l'icône sur la taille du texte revient à la
mettre à l'échelle, ce que 5.1 interdit : à `--sg-text-sm` (13 px), un trait de 1,75 px se
rendrait à 0,95 px effectif, donc gris et flou sur l'écran le plus regardé du produit.

La taille est donc **choisie, pas héritée** : le composant `<Icon size="16 | 24">` sélectionne
le symbole et la classe ensemble. Deux règles d'emploi, sans exception :

- colonne de chat, et tout contexte à `--sg-text-sm` ou moins → `16` ;
- coquille (barre d'URL, contrôles, boutons, barre de composition) → `24`.

Seule la **couleur** reste héritée, par `currentColor`.

**Pièges à connaître.**

- `<use>` ne traverse pas le Shadow DOM et n'hérite que des propriétés héritables. On ne
  stylise donc que par `color`, `fill` et `stroke` via `currentColor`.
- Le sprite est **inséré dans `index.html` au build**, pas récupéré par `fetch` au
  démarrage : sous `file://` avec `contextIsolation` et une CSP stricte (PRD 9), une
  requête vers `sprite.svg` est une source d'échec silencieux. L'inlining garantit aussi
  qu'il est présent **avant** le premier rendu du chat, faute de quoi les premières icônes
  sont vides sans erreur.
- Le sprite compte deux symboles par concept : un lint doit vérifier qu'aucun concept ne
  possède qu'une seule de ses deux grilles, et qu'aucun `<use>` ne référence un identifiant
  sans suffixe `-16` ou `-24`.
- Au-delà de 40 concepts, soit 80 symboles, scinder en deux sprites, coeur et rare, chargés
  séparément.

### 6.4 Arborescence cible

```
assets/
  brand/
    logo-diaphragm.svg          marque 6 lames, source
    logo-diaphragm-16.svg       variante 3 lames, sous 20 px
    logo-diaphragm-rec.svg      état enregistrement
    lockup-horizontal.svg       wordmark vectorisé
    lockup-stacked.svg
  icons/
    24/                         grille 24, trait 1,75 - extraits du moodboard
      record.svg  stop.svg  mic.svg  wave.svg  observe.svg  refine.svg
      script.svg  replay.svg  patch.svg  tokens.svg  frame.svg  shadow.svg
      secret.svg  offline.svg  verify.svg  branch.svg
    16/                         grille 16, trait 1,25 - livré
      record.svg  stop.svg  mic.svg  wave.svg  observe.svg  refine.svg
      script.svg  replay.svg  patch.svg  tokens.svg  frame.svg  shadow.svg
      secret.svg  offline.svg  verify.svg  branch.svg
  illustrations/
    empty-sessions.svg  offline.svg  scenario-stale.svg
build/
  sprite.svg                    généré, non versionné
  app-icons/                    généré, non versionné
```

---

## 7. Accessibilité - checklist de recette

Les règles sont énoncées à leur place normative ; cette section ne les redit pas, elle les
rend vérifiables. Chaque ligne est un test, avec sa norme d'origine.

| # | Vérification | Norme | Comment |
|---|---|---|---|
| A-1 | AA (4,5:1) sur les trois familles de paires ; AAA (7:1) sur la **seule phrase de narration** | 2 | Test automatisé, lot 2 |
| A-2 | Tout focus reste identifiable halos désactivés | 3.5, 1.3 | Rendu sous `prefers-contrast: more` |
| A-3 | Aucun état n'est distinguable par la seule couleur | 1.1, 3.3 | Capture en niveaux de gris des 7 états |
| A-4 | Interface complète au clavier, ordre de tabulation conforme | 3.5 | Parcours sans souris |
| A-5 | Nouveaux messages annoncés en `aria-live="polite"`, **regroupés par lot** pour ne pas noyer le lecteur d'écran | F-24 | Une annonce par lot de narration, pas une par message |
| A-6 | Transcription consultable en texte, y compris en mode dégradé | PRD 8, F-23 | Réseau coupé |
| A-7 | Cibles de pointage ≥ 32 × 32 px dans la coquille, ≥ 24 × 24 px dans le chat, zone étendue par pseudo-élément | - | Audit des zones cliquables |
| A-8 | Toute icône porteuse de sens a un `<title>`, toute icône décorative est `aria-hidden` | 6.3 | Lint des `<use>` |

---

## 8. Ce qui reste ouvert

| ID | Point | Quand trancher |
|---|---|---|
| O-1 | Illustrations d'états vides : trois scènes à définir (aucune session, réseau coupé, scénario obsolète) | Lot 2 |
| O-2 | Wordmark définitif : Inter Tight est un choix par défaut, une alternative sous licence libre plus caractérisée reste à évaluer | Avant la première communication publique |
| O-3 | Thème « Phosphore » (D2) en option pour l'automaticien : décidé plus tard, sans impact sur les tokens puisque seuls les noms de variables sont contractuels | Lot 7 |
| O-4 | Densité alternative du chat (compacte / confortable) selon retours des personas | Après les premiers essais utilisateurs |
| O-5 | **Écrans des lots 3 à 7 non spécifiés** : édition des segments vocaux (lot 3), édition de l'artefact raffiné et confirmation des vérifications `weak` (lot 4), rapport d'exécution et diagnostic (F-56, lot 5), liste des sessions. Le présent document couvre la coquille et le chat | Au lot concerné, en étendant ce document |
| O-6 | Surfaces flottantes : dialogue de confirmation (F-63), avertissement en toast, infobulle. Les niveaux d'élévation sont réservés (section 2), leur traitement visuel ne l'est pas. Note : l'écran de réglages n'en a plus besoin depuis W-08, il est en onglet | Lot 2 |
| O-7 | Barre de défilement du chat : le log est dense et défile en continu, le rendu natif Electron diffère sur les trois plateformes | Lot 2 |
| ~~O-8~~ | ~~Icônes en grille 16 à dessiner~~ : **fermé**. Les 32 tracés sont livrés dans `assets/icons/16/` et `assets/icons/24/`, validés à taille réelle. La grille 16 est gelée | Fermé |

### 8.1 Contradictions relevées, tranchées

Ces trois points opposaient deux règles de ce document entre elles. Ils sont arbitrés et
reportés dans les sections normatives ; ils sont conservés ici pour la traçabilité.

| ID | Contradiction | Arbitrage retenu | Reporté dans |
|---|---|---|---|
| X-1 | C-5 interdisait toute animation dans le chemin d'interaction, alors que 3.1 et 3.2 en spécifient trois. C-5 citait en outre « Indicateurs 2.2 » : dans le PRD, les 50 ms sont un objectif **non contractuel** portant sur la vue navigateur, pas sur la coquille | **C-5 reformulé** : aucune animation ne retarde l'accusé de réception d'une entrée utilisateur. Origine corrigée en CA-04. Les animations de 3.1 et 3.2 sont conservées | 1.2 |
| X-2 | 5.1 imposait de redessiner chaque taille, alors que 6.3 rendait un `<symbol>` unique en `1em`, soit un trait à 0,95 px effectif dans le chat | **Deux tailles optiques** : `ic-*-16` (grille 16, trait 1,25) et `ic-*-24` (grille 24, trait 1,75). `1em` proscrit, taille choisie et non héritée. 32 symboles, sprite < 20 Ko | 5.1, 5.2, 6.1, 6.3, 6.4 |
| X-3 | C-1 plaçait la surbrillance **autour** de la vue, 3.2 la décrivait **sur** l'élément | **Vue transparente empilée** au-dessus de la `WebContentsView`, alimentée par les rectangles englobants de la sonde. Crée une exigence d'architecture, voir 8.2 | C-1 bis, 3.2, 8.2 |

### 8.2 Répercussions à porter dans le PRD

L'arbitrage X-3 dépasse le design : il ajoute des exigences que `PRD.md` ne contient pas.
**Ce document ne les y écrit pas de sa propre initiative** ; elles sont listées ici pour
décision.

| ID | Exigence à ajouter au PRD | Section visée |
|---|---|---|
| P-1 | La sonde expose, à la demande, le **rectangle englobant** d'un élément déjà capturé, pour un usage d'affichage. Cela reste une lecture : la sonde n'injecte toujours rien | PRD 6.5, ADR-0009 |
| P-2 | La coquille gère une **vue d'overlay transparente**, empilée au-dessus de la `WebContentsView`, non interactive et instanciée à la demande | PRD 6.3, ADR-0001 |
| P-3 | Le budget de la sonde reste **< 5 ms par interaction** : la résolution d'un rectangle englobant est déclenchée par le survol d'un message, jamais en continu pendant l'enregistrement | PRD 8, Performance |
| P-4 | Le lot concerné est à désigner : le lot 1 livre la sonde, mais la désignation depuis le chat n'a de sens qu'au lot 2 | PRD 11 |

## 9. Références

- `PRD.md` - exigences fonctionnelles, décisions d'architecture, lotissement.
- `.lavish/spyglass-design.html` - moodboard complet : les 10 directions explorées rendues
  en maquette réelle, les 10 identités candidates en SVG, les démonstrations de mouvement,
  les palettes alternatives et le détail des arbitrages. À consulter pour comprendre ce qui
  a été écarté et pourquoi, avant de proposer une variante.
