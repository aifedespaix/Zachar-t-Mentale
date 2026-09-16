# Audit design UI — modale de description (18 idées)

**Persona unique** : expert design d'interface (design systems, motion design, cohérence visuelle).
**Périmètre lu** : `src/content/DescriptionDialog.tsx`, `src/content/BlockEditor.tsx`, `src/content/MathPalette.tsx`,
`src/content/LanguageHelpPalette.tsx`, `src/components/ui/tooltip.tsx`, `src/components/ui/button.tsx`,
`src/components/CardNode.tsx`, `src/index.css`, `src/colors/levelColors.ts`, `src/types/cardBlock.ts`,
`src/theme/circularReveal.ts`, `src/utils/prefersReducedMotion.ts`.
**Contrainte** : aucun code écrit, aucun autre fichier modifié.

---

## Verdict global

La liste est majoritairement **utile et cohérente avec l'intention du produit**, mais elle a un défaut structurel :
elle ajoute des **surfaces** (toolbar haute, conteneurs bleus, poignées et « + » permanents) à une modale qui
souffre déjà d'un empilement de conventions contradictoires — **6 rayons de bordure différents**
(5, 6, 8, 9, 10, 999 px), **un pointillé qui porte 4 sens** (ajouter / désactivé / cible de drop / séparateur),
et **deux systèmes de couleur** (tokens Tailwind du `Button` vs `color-mix` inline de `GHOST_BUTTON`/`MathPalette`).

Le point le plus grave n'est pas dans la liste, et il conditionne #2 et #15 : `BlockEditor.tsx:533-537` peint
l'état actif **et** l'indicateur de drop avec `var(--accent, currentColor)`. Or `--accent` vaut `oklch(0.97)` en
thème clair — **plus clair que `--border` (`oklch(0.922)`)** et identique à `--muted`. Autrement dit : en thème
clair, **le bloc actif et l'anneau pointillé de drop sont aujourd'hui quasi invisibles**. Animer un déplacement
sur un indicateur qu'on ne voit pas ne produira rien de perçu. À corriger avant #1, #2 et #15.

Deuxième constat transversal : la liste confond **« plus compact »** et **« en haut »**. La palette actuelle
(MathPalette) est un pavé de 2 à 4 rangées de touches de 44 à 52 px de haut : transposée telle quelle en haut,
elle consomme 150 à 250 px **en permanence**, donc elle prend plus de place qu'aujourd'hui (où elle n'existe que
sur le bloc focalisé). #5 ne peut réussir qu'avec une bande à **hauteur fixe et compacte**, sinon c'est une
régression mesurable de la surface d'écriture.

Troisième constat : **#9 est à refuser sur le plan visuel**, pas sur le plan UX. Dans cette app, la couleur est un
langage : **bleu = niveau 3 « Sous-partie »** (`levelColors`, teinte 235). Un conteneur bleu translucide sera lu
comme une carte de niveau 3. Et toutes les autres teintes sont prises (25 / 70 / 235 / 105 + `--locked` 48) : il
n'existe pas de « bleu neutre » disponible.

---

## Item par item

1. **Icône seule + tooltip coloré (NavArrow)** — 🏗️ **Garder l'icône, refuser le tooltip coloré par carte.**
   Les 4 pilules (bordure 2px + fond coloré + ombre + glyphe texte) sont l'élément le plus daté de la modale, à
   remplacer par un cercle. Mais : (a) les mots « Précédent / Suivant / Parent / Sous-partie » sont
   **porteurs de sens** (ils disent ce que fait le saut) — les remplacer par 4 cercles identiques rend les 4
   bords indiscernables hors survol ; (b) un tooltip à couleur arbitraire par instance **casse le composant
   partagé** (voir §Incohérences 6). Reco : cercle 32 px + **point 8 px couleur du niveau cible** (le même point
   que le chip de titre), tooltip **neutre** avec seulement une **bordure haute 2 px** teintée par une variable
   `--tint`. Pattern de pop déjà présent dans l'app : `EdgeButton` de `CardNode` (`motion.button`,
   `whileHover scale 1.15`, `whileTap 0.85`, spring 500/25, `border: 1.5px solid <couleur>`) — **c'est la
   convention de hover à reprendre**, pas un nouveau langage.
2. **Animer le déplacement des blocs** — ✅ **Garder, à spécifier avec `motion/react`.** `layout` + `LayoutGroup`
   donne le FLIP nativement. **Bloqueur réel** : `CardBlock` n'a **aucun id** et le rendu est `key={index}` ;
   avec des clés par index, `motion` anime le mauvais nœud (et un `view-transition-name` par index morphe les
   mauvaises paires). Il faut d'abord une **clé stable non persistée** (tableau d'ids dans un `useRef`, déplacé
   par les mêmes opérations que `move`/`insert`/`remove`) — le format sérialisé ne change pas.
3. **`Entrée` = ligne, `Ctrl+Entrée` = bloc, `Tab` = type** — ⚠️ **Côté visuel, `Tab` est muet** : la pastille de
   type est à droite du bloc, le caret à gauche, à ~1000 px de distance sur la mesure de 1080 px. Changer l'état
   à 1000 px du regard ne se perçoit pas. Reco : badge transitoire « Formule / Texte » 10,5 px/700 en haut à
   gauche du bloc, fondu sortant à 900 ms, + pulse 160 ms sur la pastille de droite.
4. **Héritage du type du bloc du dessus** — ⚠️ Conséquence visuelle non traitée : un bloc formule vide hérite
   d'un **champ vide et muet** → impossible de distinguer « vide » de « cassé ». Placeholder en
   `--muted-foreground` obligatoire + tint de création `--muted` qui s'efface en 600 ms.
5. **Palette de symboles en toolbar haute + switch animé** — 🏗️ **À décomposer.** Bonne intuition (regrouper
   l'outillage), exécution à revoir : (a) la palette transposée telle quelle = 150-250 px permanents ; (b) le
   switch **change la hauteur** du panneau, donc déplace tout le contenu — violation directe de la
   « règle anti-décalage » déjà documentée dans `index.css` (`transform` only, jamais padding/margin) ;
   (c) elle détruit le modèle revendiqué en tête de `BlockEditor` : « les outils sont sur le bloc que j'écris ».
   Reco : bande **sticky à 60 px de haut**, touches 44×44 sans libellé, défilement horizontal par groupe.
6. **`Entrée` = nouvelle ligne dans le WYSIWYG** — ⚠️ Un bloc à 2 lignes **perd sa frontière visuelle** : une
   seule poignée dans la gouttière, un seul cadre. Filet gauche 2 px à 40 % sur les blocs multilignes, sinon le
   modèle « bloc » s'efface à l'écran.
7. **Focus auto au passage formule↔texte par clic** — ✅ Nécessaire, mais **un focus programmatique n'est pas
   visible** : tous les champs sont en `outline: none` avec des cadres custom. Flash du cadre vers `--ring` sur
   200 ms, sinon l'utilisateur conclut que le clic n'a rien fait.
8. **Bouton « Question » + champ en texte bleu clair** — ⚠️ « texte bleu clair » **échoue le contraste** en
   thème clair. Utiliser la teinte `border` du niveau 3 (`l=0.55` clair / `0.62` sombre), déjà validée AA sur ce
   fond, et traiter l'en-tête comme le chip de titre (cadre + fond teinté), pas comme du texte bleu nu.
9. **Question = bloc parent, bordure + fond bleu translucide** — ❌ **Refuser le fond bleu translucide.**
   Trois raisons vérifiables : (a) **collision de langage** — bleu = niveau 3 « Sous-partie » partout ailleurs ;
   (b) la palette niveau 3 a `bg l=0.96` face à `--popover l=1.0` en clair : séparation perceptuelle quasi nulle
   (tache grisâtre), et en sombre `l=0.22` sur `0.205` donne un marine boueux ; (c) le translucide **sature à la
   2ᵉ imbrication** (2 × alpha ≈ opaque), donc l'imbrication change le sens visuel. Reco : conteneur sans flood —
   `1 px var(--border)`, radius 10, indentation 12 px, **filet gauche 3 px** en pleine couleur `border` niveau 3,
   fond `transparent`, en-tête 28 px avec libellé 10,5 px/700/`0.06em` (réutiliser `FooterTitle`), enfants en
   `--popover` plein, **imbrication max 1**.
10. **Blocs OU blocs parents, et les organiser** — 🏗️ **À décomposer** : sans règle d'indentation (12 px/niveau)
    et sans profondeur max, la modale devient un jardin de boîtes. C'est la même décision que #9.
11. **Bug : deux champs formule empilés au chargement** — ✅ Critiquement visuel : l'état actuel affiche **LaTeX
    brut + champ visuel** côte à côte, soit les deux typographies les plus éloignées possibles. Reco : jamais les
    deux — squelette de **hauteur fixe 38 px** sur `--muted` pendant le chargement, aucune bascule de hauteur.
12. **Cellule formule à la largeur de la case mère** — ✅ `width: 100%`, `box-sizing: border-box`,
    `min-width: 0` + **variante compacte du champ** (13 px, padding 4/6). `FIELD_STYLE` actuel (14 px, 6/8) ne
    correspond pas au padding interne de MathLive. La cellule doit réserver **22 px à droite** pour le toggle
    Aa/∑, sinon le champ passe dessous.
13. **Undo/redo en icônes dans la toolbar du haut** — 🏗️ **Aucune toolbar n'existe** aujourd'hui (en-tête =
    fil d'Ariane + chip de titre ; pied = Supprimer / autosave / Raccourcis / Fermer). Deux bandes empilées
    (en-tête + palette) = ~120 px de chrome. Reco : fusionner en **une seule rangée d'en-tête** — le chip de
    titre en `flex: 1`, puis le groupe `[annuler][rétablir][fermer]` de 28 px, ce qui **supprime au passage le
    chevron `position: absolute; top: 10; right: 10`** qui sert aujourd'hui de refuge au `padding-right: 56px`.
14. **Menu de type affiche « Image » pour un tableau ; déplacer +ligne/+colonne** — ✅ **Bug confirmé**
    (`BlockEditor.tsx:799` : tout ce qui n'est ni math ni text s'intitule « Image »). Pour le déplacement des
    actions : le panneau de droite est aujourd'hui une colonne de boutons `GHOST_BUTTON` (26 px de haut) ;
    y ajouter 2 entrées donne **4 boutons empilés ≈ 110 px** le long de chaque bloc = bruit vertical. Reco :
    **un menu « Tableau » unique** (`DropdownMenu`, comme `BlockKindMenu`) contenant les 4 actions, et
    suppression du footer explicatif.
15. **« + » intercalés + drag de lignes/colonnes avec aperçu live** — ⚠️ **Direction juste, exécution à revoir.**
    Aujourd'hui les « + » et corbeilles sont **tous visibles en permanence** à `opacity 0.42` : cela forme une
    clôture pointillée autour de la grille (bruit) et ils sont placés **au début** de chaque colonne/ligne, pas
    entre. Et **l'aperçu live est impossible en HTML5 DnD** (le ghost est un bitmap figé, aucun DOM
    réordonnable, `dragover` non throttlé de façon fiable) : il faut du pointer-based. Pas de dnd-kit dans le
    projet → `motion` (`drag` avec `dragListener={false}` sur une poignée, + `layout` sur les frères).
16. **Image dans le sélecteur formule/texte** — ❌ **En conversion** : le menu désactive déjà image pour cette
    raison exacte (« perdre le fichier »), et l'ajouter comme cible de conversion met une action destructrice au
    milieu d'actions non destructrices. Dans une cellule, pire : colonne `minmax(84px, 1fr)`, et le toggle Aa/∑
    n'a pas de 3ᵉ état. Reco : création d'image depuis le menu « Ajouter un bloc », jamais par conversion.
17. **Tooltips au lieu de `title` partout** — ⚠️ Cohérent avec le DS, mais deux pièges : (a) `delayDuration = 0`
    sur **chaque** `TooltipProvider` — il y en a un par fonctionnalité, et un dans `EdgeButton` donc **un par
    carte** — rendrait une gouttière de 5 icônes clignotante ; (b) remplacer un `title` par un tooltip ne doit
    jamais laisser les deux. Reco : **un seul** `TooltipProvider` à la racine du dialogue, `delayDuration 300`
    (0 réservé aux 4 NavArrow, cibles isolées), et un petit wrapper `IconButton` = `Button` + `Tooltip` +
    `aria-label`.
18. **« + » à la place des flèches absentes** — ⚠️ **Restreindre aux frères (haut/bas).** Un « + » sur le bord
    gauche créerait un **parent**, c'est-à-dire une carte ailleurs dans l'arbre : action de canvas, pas de
    modale. Style : même cercle que #1 mais **pointillé 1,5 px à 50 %** — « n'existe pas encore » est déjà la
    convention du pointillé dans l'app (`ADD_BUTTON`, état désactivé de `MathPaletteKey`).

---

## Spécifications visuelles chiffrées

### #1 — NavArrow : cercle + tooltip

- **Géométrie** : 32 × 32 px, `border-radius: 999px`, position inchangée (`-18px` hors cadre — possible car le
  contenu de la modale n'a pas d'`overflow: hidden` ; le tooltip est portalisé vers `body` donc il n'est pas
  rogné non plus).
- **Couleurs** : fond `var(--popover)`, `border: 1.5px solid <levelColor.border>` (comme `EdgeButton`),
  icône 15 px `strokeWidth 2`, **point de niveau 8 px** en bas à droite du cercle, couleur `levelColor.border`.
- **Pop hover (convention existante, à reprendre telle quelle)** :
  `whileHover={{ scale: 1.15 }}`, `whileTap={{ scale: 0.85 }}`,
  `transition={{ type: 'spring', stiffness: 500, damping: 25 }}` (`motion/react`).
  Si `useReducedMotion()` est vrai : pas de `whileHover`/`whileTap`, seulement le fond.
- **Fond de survol** : `color-mix(in oklab, var(--popover), <levelColor.border> 14%)`, `transition: background-color 120ms ease-in-out`
  (même valeur que `MathPaletteKey`).
- **Tooltip** : `delayDuration 0`, surface **neutre** (`bg-foreground text-background` comme aujourd'hui),
  `border-top: 2px solid <levelColor.border>` via `style` — un liseré de 2 px suffit à dire « voici la couleur
  de la carte visée » sans repeindre la bulle. Contenu : `Précédent · <titre>` / `3 sous-parties`.
- **Nombre d'enfants > 1** : badge `12px/700` dans une pastille 18 px, fond `<levelColor.bg>`, texte
  `<levelColor.text>`, collée en haut à droite du cercle — l'information « combien » ne doit pas attendre le survol.
- **Empilement** : `TooltipContent` est en `z-50` (Tailwind) et la modale en `zIndex: 50` inline. Les deux
  portals sont ajoutés à `body` ; le portal du tooltip étant créé **à l'ouverture** (donc après celui du
  dialogue), il passe au-dessus à z-index égal. **Ne pas baisser le `z-50`**, et **ne pas** remplacer par un
  tooltip non portalisé : il serait rogné par le conteneur `overflow: hidden` du corps de la modale.

### #2 — Réordonnancement des blocs

- **Prérequis** : clés stables par bloc (voir #2 ci-dessus). Sans cela, aucune animation correcte n'est possible.
- **Outil** : `motion/react` — `<LayoutGroup>` autour de la liste, `motion.div layout` sur chaque ligne,
  `transition={{ layout: { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] } }}`.
- **Choréographie** :
  - bloc déplacé : **220 ms**, `cubic-bezier(0.2, 0.8, 0.2, 1)` ;
  - blocs qui se décalent : **180 ms**, même courbe, avec décalage de **15 ms** par position (plafond 60 ms) —
    c'est le « stagger » qui fait lire l'ordre du mouvement ;
  - source pendant le vol : `opacity 0.35` (la valeur 0.4 existe déjà) ; atterrissage : retour à `1` en **120 ms**.
  - `prefers-reduced-motion` : `duration: 0` (échange en une frame), via `useReducedMotion()`.
- **Indicateur d'insertion** (au `dragover`, HTML5 DnD conservé dans un premier temps) :
  **2 px solide `var(--ring)`** + halo de 6 px `color-mix(in oklab, var(--ring), transparent 82%)`,
  `outline-offset: 5px`, `border-radius: 10px`. **Abandonner le pointillé gris** (`2px dashed var(--accent)`) :
  pointillé + gris + animation de déplacement = trois signaux pour une seule idée, et c'est la signature visuelle
  du drag & drop de 2005.
- **HTML5 DnD vs pointer** : le HTML5 DnD suffit pour animer **au drop** (le ghost est un bitmap du bloc entier,
  déjà réglé via `setDragImage`). Il ne permet **pas** l'aperçu live (les voisins qui s'écartent pendant le vol) :
  cela impose `pointerdown/move/up` + `setPointerCapture`, donc réécrire l'auto-scroll, le clavier et les tests
  de drop. Reco : **garder le DnD HTML5 pour #2**, et réserver le passage au pointer à #15 où l'aperçu live est
  explicitement demandé.
- **Alternative écartée** : `document.startViewTransition` (précédent dans `circularReveal.ts` avec garde
  `prefersReducedMotion()`) capture un cliché plein écran — il animerait aussi le fond de modale, le fil
  d'Ariane et le pied. À garder pour le thème, pas pour un réordonnancement local.

### #5 — Bande de symboles en haut

- **Layout** : bande `position: sticky; top: 0; z-index: 2`, **hauteur fixe 60 px**
  (`8px` padding haut/bas + touches `44px`), `background: var(--popover)`, `border-bottom: 1px solid var(--border)`,
  `border-radius: 10px 10px 0 0`. Elle vit **à l'intérieur** de la zone de scroll (le `div` `flex:1; overflowY:auto`
  de `BlockEditor`) : elle ne doit pas être une bande fixe qui ampute la surface d'écriture de 60 px en permanence.
- **Touches** : **44 × 44 px** (`min-width: 44px`), pas 40 — la palette actuelle a raison de refuser en dessous de
  44 : « une cible se rate d'abord par sa hauteur ». Compactage obtenu en **supprimant les libellés**
  (`spelled = false`, face seule, `font-size: 19px`) et en gardant **une seule rangée par groupe** avec
  `overflow-x: auto; scroll-snap-type: x proximity`. Les noms de groupes (« Structures », « Opérateurs »…)
  deviennent des chips `10,5px/700/0.06em`, `--muted-foreground`, en tête de groupe.
- **Couleurs des touches** : conserver la logique existante (`overBackground(accent, 30)` /
  `veiled(accent, 40)`) **mais** recalculer la surface de mélange : `overBackground` compose contre
  `var(--background)` alors que la palette sera posée sur `var(--popover)`. Exposer une variable `--surface`
  (ou passer `var(--popover)`), sinon les teintes dérivent entre le footer actuel et la bande.
  Transition conservée : `background-color 120ms ease-in-out, border-color 120ms ease-in-out`.
- **Switch animé** : hauteur **figée**, contenu en `AnimatePresence mode="popLayout"` :
  entrant `initial={{ opacity: 0, x: dir * 12 }}` → `animate={{ opacity: 1, x: 0 }}` sur
  **180 ms `cubic-bezier(0.2, 0, 0, 1)`** ; sortant `exit={{ opacity: 0, x: -dir * 12 }}` sur **120 ms ease-out**.
  `dir = +1` quand on va vers les caractères (texte), `-1` vers les maths — la direction suit **l'ordre des
  groupes**, jamais la position du bloc dans la page, sinon le glissement contredit le déplacement du focus.
- **Exception assumée** : la bande suit le **bloc focalisé**, pas la souris. Si aucun bloc n'a le focus, la bande
  garde son dernier contenu à `opacity 0.6`, désactivée — sinon elle clignote à chaque clic hors champ.
- **Ce qui est refusé** : pas de barre d'onglets redondante (le focus décide déjà), pas de changement de hauteur,
  pas de translation du contenu en dessous.

### #9 — Conteneur « question »

| Élément | Thème clair | Thème sombre |
| --- | --- | --- |
| Cadre | `1px solid var(--border)` | idem |
| Filet gauche 3 px | `levelColor(3).border` = `oklch(0.55 0.14 235)` | `oklch(0.62 0.13 235)` |
| Fond | `transparent` (pas de flood) | idem |
| Hover du cadre | `color-mix(in oklab, var(--foreground), transparent 90%)` | idem |
| En-tête 28 px | libellé `10,5px/700 uppercase 0.06em` + point 8 px niveau 3 | idem |
| Enfants | `var(--popover)` plein, `border: 1px solid var(--border)` | idem |
| Indentation | `12px` par niveau, **max 1 niveau** | idem |

Le fond bleu translucide demandé est remplacé par **le filet gauche + le point + le libellé** : trois signaux
non chromatiques au niveau du fond, la couleur ne portant qu'un seul élément (le filet), ce qui évite la
confusion avec une carte de niveau 3 et évite la saturation à l'imbrication.

### #15 — Tableau : insertions et déplacement

- **Grille** : `grid-template-columns: 32px repeat(n, minmax(84px, 1fr))`, `gap: 6px`
  (32 px au lieu de 40 px : un seul bouton par poignée en régime normal).
- **« + » intercalés** : la zone d'insertion est **le gap lui-même** — un bouton de 16 px centré sur la frontière,
  `opacity: 0` au repos, `opacity: 1` sur survol de la zone (12 px de large), transition **120 ms ease-out**.
  Axe d'insertion affiché pendant le survol : **2 px `var(--ring)` pleine hauteur** (colonne) / pleine largeur
  (ligne). Les extrémités ont le même bouton, jamais de bouton permanent visible.
- **Poignées** : ligne = 14 × 22 px centrée verticalement dans la gouttière, visible au survol de la ligne
  (`opacity 0.35 → 0.9`, 120 ms). Colonne = même poignée dans une **bande de 14 px au-dessus de l'en-tête** —
  jamais dans le texte de l'en-tête (une poignée au milieu d'un mot est illisible).
- **Drag avec aperçu live** : pointer-based via `motion` — `dragListener={false}` et `onPointerDown` sur la
  poignée, `setPointerCapture`. Ghost = clone portalisé à `opacity 0.75`,
  `box-shadow: 0 10px 24px rgba(0, 0, 0, 0.18)`, `border: 1px solid var(--ring)`, suivi du curseur **sans lag**
  (transform direct, `transition: none` sur le ghost).
- **Réaction des voisins** : `motion.div layout`, **160 ms `cubic-bezier(0.2, 0, 0, 1)`**, décalage par
  `transform` uniquement. **Ne jamais animer `grid-template-columns`** : cela reflow le texte de toutes les
  cellules à chaque frame, et le texte qui se recompose pendant le glissement est le défaut le plus visible de
  ce genre d'interaction.
- **Cible d'insertion** : bande de 6 px `color-mix(in oklab, var(--ring), transparent 75%)` + trait 2 px
  `var(--ring)` — **le même signal que #2**, même couleur, même épaisseur : un seul vocabulaire de « ça va
  atterrir ici » dans toute la modale.

### #13 / #17 — En-tête et tooltips

- En-tête en une rangée : `display: flex; gap: 8px; align-items: center; padding: 12px 12px 12px 20px`.
  Chip de titre `flex: 1`. Groupe de droite : `[annuler][rétablir]` (`Button variant="ghost" size="icon-sm"`,
  28 px, `disabled:opacity-50` — l'état désactivé est déjà fourni par le design system), puis `[fermer]` 30 px.
  Le chevron `absolute` disparaît, `padding-right: 56px` aussi.
- Un **seul** `TooltipProvider` en tête de `DescriptionDialog` (`delayDuration 300`), un second local
  `delayDuration 0` autour des 4 `NavArrow` — Radix ne permet qu'un délai par provider, et les deux besoins sont
  réellement différents (cible isolée vs gouttière dense).

---

## Incohérences avec le design system existant

1. **`var(--accent)` détourné en couleur d'interaction.** `BlockEditor.tsx:533-537` l'utilise pour la bordure du
   bloc actif et pour `outline: 2px dashed`. `--accent` est un **token de surface** (`oklch(0.97)` clair /
   `0.269` sombre), identique à `--muted` en clair : l'affordance est invisible en thème clair. La couleur
   d'interaction de l'app est `--ring` (`0.708` / `0.556`). À reprendre pour #2 et #15.
2. **Six rayons coexistent dans une seule modale** : `HANDLE_BUTTON` 5 px, `GHOST_BUTTON`/`CELL_BUTTON` 6 px,
   croix 8 px, chip de titre 9 px, cadre de bloc 10 px, `FooterButton`/NavArrow 999 px — alors que `Button`
   définit le rayon par token (`min(var(--radius-md), 10px)`, soit 8 px). Toute nouvelle surface (#5, #9)
   doit tirer son rayon de `--radius`, pas d'un nombre choisi sur place.
3. **`GHOST_BUTTON` réimplémente le `Button`.** 30 × 26 px, `border: 1px solid var(--border)`, `opacity: 0.7`,
   `background: none` : c'est `variant="ghost" size="icon-xs"` (24 × 24, `--radius`) avec deux pixels d'écart.
   Le menu de type, la conversion en tableau, « Ajouter un bloc » et `FooterButton` devraient passer par le
   composant partagé, sinon #13/#14/#17 continueront d'ajouter des variantes locales.
4. **Le pointillé porte quatre sens** : « ajouter » (`ADD_BUTTON`), « désactivé » (`MathPaletteKey`), « cible de
   drop » (`outline` de `BlockEditor`), « séparateur » (`BlockFooter` `borderTop`). Après #15 et #18, il en
   portera six. Convention à fixer : **pointillé = n'existe pas encore / indisponible**, **solide teinté = cible
   de drop**.
5. **Deux systèmes de couleur** : `Button` via tokens Tailwind ; `GHOST_BUTTON`, `HANDLE_BUTTON`, `CELL_BUTTON`,
   NavArrow, `MathPalette` via `color-mix` inline. Résultat concret : `overBackground()` compose contre
   `var(--background)` alors que la palette est posée sur `color-mix(var(--border), transparent 93%)` — déjà
   faux aujourd'hui, et **fatal pour #5** qui change encore de surface.
6. **Le tooltip partagé ne peut pas être teinté par instance.** `TooltipContent` fusionne bien `className`, mais
   la **flèche** (`TooltipPrimitive.Arrow`) a des classes figées (`bg-foreground fill-foreground`,
   `tooltip.tsx:50`) : teinter la bulle laisse une flèche noire. Un tooltip coloré par carte exigerait d'ajouter
   une prop `arrowClassName` (ou des variables CSS) au composant partagé — et, même fait proprement, cela
   contredirait la convention actuelle : **le tooltip est du chrome neutre**, sa couleur ne porte aucune
   information dans toute l'app. D'où le refus du volet « tooltip aux couleurs de la carte » de #1.
7. **`TooltipProvider` monté par fonctionnalité — et par carte.** `CardNode.EdgeButton` en monte un **par
   bouton**, donc par nœud du canvas ; `NavArrow` (4 par modale) en monterait 4 de plus. Chaque provider a son
   propre état de délai : le remplacement global des `title` (#17) doit hoister un provider unique, sinon on
   installe un coût de montage par ligne de liste.
8. **`title=` natif là où le tooltip existe déjà.** `NavArrow` (`DescriptionDialog.tsx:533`), la croix, les
   `GutterIcon`, `HANDLE_BUTTON`, `CELL_BUTTON`, `BlockKindMenu` : des dizaines de `title` (≈ 1 s de délai, non
   stylable, invisible au clavier) alors que l'app a un `Tooltip` Radix. C'est le fondement de #17 — mais cela
   implique un `aria-label` sur chaque cible (déjà présent pour la plupart), car un tooltip seul n'est pas un nom
   accessible pour un bouton sans texte.
9. **Icônes mixtes** : glyphes texte `↑↓←→` dans `NAV_GLYPH` (et drapeaux SVG dessinés à la main) alors que
   partout ailleurs ce sont des icônes lucide. #1 règle le cas des flèches ; les `+`/corbeilles de #15 doivent
   suivre (`Plus`, `Trash2`, `GripVertical`, taille 12-13, `strokeWidth 2`).

---

## Les 3 idées visuellement les plus risquées

1. **#9 — le conteneur bleu translucide.** C'est la seule idée qui **casse un langage existant** : bleu =
   niveau 3 « Sous-partie ». Remplissage translucide quasi invisible en clair, boueux en sombre, saturé dès la
   deuxième imbrication, et aucune teinte libre pour choisir un autre bleu. La structure (filet 3 px + libellé +
   indentation) porte la même information sans coût.
2. **#5 — la toolbar haute avec switch animé.** Elle peut faire perdre plus de place qu'elle n'en fait gagner
   (150-250 px permanents au lieu de 0) et, si le switch change la hauteur, elle déplace le texte sous les yeux
   de quelqu'un en train d'écrire — exactement ce que la règle anti-décalage de l'app interdit. Ne pas la
   spécifier en hauteur fixe et en `sticky`, c'est garantir une régression perçue.
3. **#15 — l'aperçu live du drag de lignes/colonnes.** Trois risques cumulés : le HTML5 DnD ne peut pas tenir la
   promesse d'aperçu (animation mensongère), le déplacement de colonnes tente naturellement d'animer les largeurs
   (reflow du texte), et l'affichage permanent des « + » et corbeilles transforme la grille en clôture
   pointillée. C'est la plus grosse dépense de la liste pour le plus petit gain de lisibilité.

**Mention spéciale (4ᵉ, juste derrière)** : #1 dans sa version « tooltip aux couleurs de la carte ». Non
soutenable en l'état (flèche non teintable, chrome neutre dans toute l'app) et, appliqué aux 4 flèches, il
donnerait quatre bulles de quatre couleurs différentes au survol d'un même écran — le contraire d'une aide.
