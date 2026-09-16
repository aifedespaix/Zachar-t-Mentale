# Audit a11y & mouvement — modale de description (18 idées)

**Auditeur** : persona unique « expert accessibilité (a11y) et mouvement/animation ».
**Périmètre lu** : `src/content/DescriptionDialog.tsx`, `src/content/BlockEditor.tsx`,
`src/content/MathFieldEditor.tsx`, `src/content/MathPalette.tsx`,
`src/components/ui/tooltip.tsx`, `src/index.css`, plus greps globaux sur `src/**`.
**Statut** : audit statique (lecture seule). Aucun fichier du dépôt modifié hormis ce rapport.

Méthode de comptage : `grep` sur `src/**/*.tsx` (donc lignes, pas AST JSX), puis relecture
de chaque site pour classer. Les nombres ci-dessous sont des occurrences de lignes, pas des
éléments JSX uniques — c'est dit, donc à ne pas citer comme un décompte d'AST.

---

## Verdict global

La liste d'idées n'est **pas neutre** : elle contient trois régressions dures (#3, #13, #15),
une fausse bonne idée sur les tooltips (#1/#17) et une famille d'animations non couvertes par
le garde-fou `prefers-reduced-motion` existant (#2, #5, #15).

Le paradoxe central : le code actuel est **discipliné** (aucun bouton icône-seule ne repose sur
`title` seul, les contrôles de drag sont doublés au clavier, `role="group"`/`role="status"` sont
déjà employés, un utilitaire de contraste WCAG existe). Plusieurs idées de la liste
**défont** cette discipline au nom du confort visuel.

Ce qui reste utilisable et non-nuisible : #4, #10, #12, #16 (sous conditions), #7 (sous conditions).
Ce qui est à retravailler avant toute implémentation : #1, #3, #5, #6, #9, #11, #13, #14, #15, #17, #18.

---

## Comptage `title=` vs `aria-label`

| Mesure (grep, `src/**/*.tsx`) | Occurrences |
| --- | --- |
| Lignes contenant `aria-label` | **115** |
| Lignes contenant `title=` | **53** |
| … dont props de composants nommées `title` (SettingsSection, NameDialog, ConfirmDeleteDialog, RecallDialog, ExportDialog, tests) | **31** |
| … dont vrais attributs HTML `title` | **22** |
| … attributs `title` posés sur un contrôle portant **aussi** un `aria-label` | **16** |
| … attributs `title` sur un non-contrôle (span de chemin `App.tsx:437`, chemin de log `SyncSettingsPanel.tsx:364`, bouton dont le nom vient de son texte `FileTreeRow.tsx:721`, `div` enveloppant un item de menu désactivé `FileTreeRow.tsx:799`, `role="status"` `FileSidebar.tsx:628`, label de niveau `QuizConfigModal.tsx:112`) | **6** |
| **Boutons icône-seule reposant sur `title` sans `aria-label`** | **0** |

Les 16 doubles : `BlockEditor.tsx` lignes 580/581, 615/616, 703/704, 759/760, 805/806,
1278/1279, 1288/1289, 1373/1374, 1383/1384, 1468/1469 ; `DescriptionDialog.tsx` 288/289 et
532/533 ; `LanguageHelpPalette.tsx` 218/219 ; `MathPalette.tsx` 283/284 ;
`FileSidebar.tsx` 742/754 ; `FileTreeRow.tsx` 681/682.

**Conclusion du comptage** : le motif « mauvais » (`title` seul) est **absent** du code pour les
contrôles. Le risque de #1/#17 n'est donc pas de corriger un existant : il est **d'introduire**
un motif dégradé (nom accessible porté par le tooltip) dans un code qui ne l'a pas.
Deux exceptions à surveiller, pré-existantes et non introduites par la liste :
`FileTreeRow.tsx:798-808` (le `title` « Publiez cette carte… » sur un `div` non focusable est
invisible au clavier et au lecteur d'écran) et `FileSidebar.tsx:619-631` (un `role="status"` dont
le détail conflits/erreurs n'existe que dans `title`).

---

## Item par item

1. ❌ **Icône seule + tooltip teinté.** (a) Si le texte de destination disparaît au profit du
   tooltip, l'information n'est plus accessible au clavier : le `title` natif
   (`DescriptionDialog.tsx:533`) n'apparaît ni au focus ni sur Windows au clavier. Le
   `aria-label` existe déjà (`:532`) — il est la seule raison pour laquelle l'état actuel reste
   exploitable ; le supprimer serait la régression. (b) ⚠️ **2.5.3** est déjà violé aujourd'hui
   dans le cas `manyChildren` : le texte visible est « 3 sous-parties » (`:525`) alors que le nom
   accessible est « Aller à « <titre du 1er enfant> » » (`:532`) — le nom ne contient pas le
   libellé visible, et la relation (« Parent », « Suivant »…) n'est jamais annoncée. (c) Le
   tooltip « fond/bordure/texte de la carte cible » n'a **aucune garantie de contraste** : rien
   n'empêche `bg` et `text` de venir du même `TitleChipColors`. (d) L'animation hover est à
   doubler d'un `:focus-visible` équivalent (modèle à copier : `index.css:344-355`).
2. ⚠️ **Animer le déplacement des blocs.** Deux exigences : l'animation ne doit pas être le seul
   canal qui dit « où va le bloc » (le résultat doit être annoncé, 4.1.3), et elle doit être
   neutralisée sous `prefers-reduced-motion: reduce` (2.3.3). Or le garde-fou existant ne couvre
   **pas** les transitions de nœuds React Flow : `.react-flow__node { transition: transform 250ms }`
   (`index.css:248-250`) — c'est exactement le glide qu'une telle animation réutiliserait.
3. ❌ **`Tab` = changer le type du bloc.** `Tab` est le seul moyen d'atteindre les contrôles ;
   lui donner un effet qui **mute le document** casse 2.1.1 (Keyboard) et 2.1.2 (No Keyboard Trap :
   on ne peut plus traverser l'interface sans effet de bord). Le test
   `src/content/DescriptionDialog.test.tsx:318-326` documente explicitement que « les touches
   restent atteignables au `Tab` » — c'est la palette de symboles qui devient inatteignable.
   Le défaut global `card.addChild = Tab` (`src/types/commands.ts:231-235`, commentaire
   `MindMapCanvas.tsx:472` « Tab, Tab, Tab builds a branch ») rend le même raccourci porteur de
   deux sens selon le contexte (3.2.4). `Enter` = ligne / `Ctrl+Enter` = bloc contredit en plus
   `card.editDescription = Mod+Enter` (`commands.ts:270-274`) et le panneau d'aide de la modale
   lui-même (`DescriptionDialog.tsx:584-585`, 3.3.2). La garde `removeAt`
   (`BlockEditor.tsx:460-461`, `blocks.length <= 1`) n'est pas cassée par #3, mais elle reste la
   seule protection : ne pas la retirer. **Règle : jamais de `Tab` nu pour muter.**
4. ✅ **Héritage du type de bloc.** Neutre a11y. Réserve : un nouveau bloc formule s'appelle
   « Formule du bloc N (LaTeX) » au premier bloc d'une session et « Formule du bloc N » ensuite
   (3.2.4) — #4 amplifie cette instabilité ; annoncer l'insertion (4.1.3).
5. ⚠️ **Palette de symboles déplacée dans une toolbar + slide.** Le slide est un déclencheur
   vestibulaire : à gater (2.3.3/2.2.2). Surtout, le lien palette ↔ bloc actif devient purement
   visuel : le `role="group"` doit nommer la cible (« Symboles mathématiques — bloc 3 ») sinon
   1.3.1 est violé. Conserver la garantie de contraste déjà posée une fois pour toutes
   (`MathPalette.tsx:175-181`, `color: var(--foreground)`), la liste de langues
   (`LanguageHelpPalette.tsx:150-158`) et l'insertion au caret (`MathFieldEditor.tsx:120-134`).
6. ⚠️ **`Enter` = saut de ligne dans le champ formule.** `MathFieldEditor.tsx:163-167` fait
   aujourd'hui l'inverse (Enter = nouveau bloc, `Shift+Enter` laissé à MathLive). Conséquences :
   le `aria-label` du champ (`MathFieldEditor.tsx:152`) ne dit rien du clavier et l'aide de la
   modale (`DescriptionDialog.tsx:584-585`) devient fausse → 3.3.2. Exiger un `aria-describedby`
   portant l'indication de touche, mis à jour dans la même livraison. Point non vérifié : un saut
   de ligne dur dans `value` (LaTeX) pourrait ne pas survivre à l'aller-retour MathLive.
7. ⚠️ **Focus après bascule formule↔texte au clic.** Déplacer le focus est correct (l'utilisateur
   vient d'agir) **à condition** que la cible existe après commit : réutiliser le mécanisme déjà
   présent (`BlockEditor.tsx:340-344`, `pendingFocusSelector`) plutôt qu'un `focus()` immédiat
   (sinon focus perdu sur `body`). Ne jamais déplacer le focus sur un re-render non déclenché par
   l'utilisateur. Annoncer le nouveau type (4.1.2/4.1.3), puisque le nom accessible du champ change.
8. ⚠️ **Bouton « Question » + champ header en texte bleu clair.** « Bleu clair » comme unique
   signal = 1.4.1 (Use of Color) : il faut un marqueur programmatique (rôle de titre ou
   `aria-label`/nom de groupe). Le texte bleu clair sur fond bleu translucide doit être **mesuré**
   ≥ 4.5:1 (1.4.3) — l'outil existe dans le dépôt (`src/colors/contrast.ts:34` `oklchWcagContrast`).
9. ⚠️ **Bloc « question » conteneur.** Sans `role="group"` + nom accessible (ou `fieldset`/`legend`),
   la relation parent/enfants est purement visuelle : 1.3.1. Le motif est déjà là
   (`BlockEditor.tsx:1185-1188`, `DescriptionDialog.tsx:569`, `MathPalette.tsx:168` et `:192`,
   `LanguageHelpPalette.tsx:150-158`). Nommer chaque groupe (dérivé de son champ header), garder
   les noms propres des enfants, et conserver une voie clavier pour entrer/sortir un bloc du
   groupe (sinon 2.5.7).
10. 🏗️ **Blocs OU blocs parents.** Neutre en soi, à trois conditions : le conteneur est nommé (#9),
    l'ordre DOM reste l'ordre de lecture, et les projections en texte plat
    (`blocksToPlainText` → options de quiz, note XMind, PDF) aplatissent correctement les groupes
    — sinon 1.3.1/1.1.1. **Projection des groupes non vérifiée** dans cet audit.
11. ⚠️ **« Deux champs visibles au chargement » — non reproduit par lecture statique.**
    `MathFieldEditor.tsx:188` renvoie **soit** le `fallback`, **soit** le `<math-field>`, et
    `:103` (`useState(() => loaded)`) fige le choix au montage : exactement **un** contrôle est
    monté. À confirmer par une capture dans l'app. Le défaut a11y que je **peux** confirmer est
    l'alternance des noms pour la même valeur : « Formule du bloc N » (`BlockEditor.tsx:1098`) vs
    « Formule du bloc N (LaTeX) » (`:1105`), et idem en cellule de tableau (`:1432` vs `:1435`) →
    3.2.4. Si deux contrôles coexistaient réellement : deux arrêts de tabulation et deux noms pour
    une valeur = 1.3.1/4.1.2, à corriger par un seul contrôle ou un groupe nommé.
12. ⚠️ **Cellule « formule » qui ne prend pas la largeur.** Visuel, mais deux effets a11y : une
    zone qui défile doit rester atteignable au clavier et nommée (2.1.1), et l'anneau de focus ne
    doit pas être rogné par le conteneur (2.4.11, AA 2.2). À noter ici, hors sujet mais adjacent :
    les poignées `+`/corbeille du tableau sont **18×18 px** (`BlockEditor.tsx:1340-1351`) avec
    `gap: 1` (`HANDLE_ROW`, `:1332-1338`) → **2.5.8 (Target Size, Minimum)** : 24×24 requis, et
    l'exception d'espacement ne s'applique pas puisque les disques de 24 px se recouvrent.
13. ❌ **Undo/redo en icônes avec « disabled » stylé.** Impossible à faire honnêtement en l'état :
    `src/content/descriptionHistory.ts:60,68` — `undoDescription`/`redoDescription` **mutent**
    l'index et renvoient `null`, il n'existe **aucun** `canUndo`/`canRedo` à lire. Un bouton grisé
    par `opacity` mais non `disabled` est un mensonge pour un lecteur d'écran (4.1.2) et un arrêt
    de tabulation inutile (2.4.3). De plus `src/hooks/useGlobalShortcuts.ts:102`
    (`if (isModalOpen()) return`) rend tous les raccourcis globaux inertes dans la modale : #13 ne
    peut pas passer par le registre de commandes (`CommandButton`/`ShortcutHint`) sans changement.
    Exiger : un *peek* non mutant (`canUndoDescription`/`canRedoDescription`), un vrai attribut
    `disabled`, un `aria-label` nommant l'action **et** le raccourci (« Annuler (Ctrl+Z) »), et
    l'annonce du résultat dans une région live (4.1.3).
14. ⚠️ **Bug « image » au lieu de « tableau » + déplacement des actions.** Le bug est réel et son
    impact est un **nom accessible faux** : `BlockEditor.tsx:799`
    (`kind === 'math' ? 'Formule' : kind === 'text' ? 'Texte' : 'Image'`) — pour `kind === 'table'`,
    le bouton affiche le mot « Image » alors que l'icône est `Table2` (`:813`) et que l'`aria-label`
    annonce « Type du bloc N : Image » (`:805`) → un lecteur d'écran décrit un tableau comme une
    image (4.1.2, 1.3.1). Second point : le footer du tableau (`TableFooter`, `:910-938`) est
    aujourd'hui la voie **découvrable, large et nommée** ; le supprimer au profit des poignées de
    18 px est une régression (2.5.8, 2.1.1, 3.3.2), sauf à garder des contrôles ≥ 24 px, nommés
    « Ajouter une ligne/colonne au tableau N ».
15. ❌ **Déplacement lignes/colonnes par drag + aperçu live.** Le drag HTML5 (`draggable`,
    `onDragOver`, `dataTransfer`, `BlockEditor.tsx:700-718`) n'a **aucun équivalent clavier**
    (2.5.7, Dragging Movements, AA 2.2). Pour les blocs, l'exigence est **satisfaite** aujourd'hui :
    le grip est doublé par `GutterIcon` monter/descendre (`:719-730`) avec un vrai `disabled`
    (`:761`). Pour les lignes/colonnes, il n'existe que insérer/supprimer (`:1276-1295`,
    `:1371-1390`) : rendre le **réordonnancement** drag-only introduit donc une violation 2.5.7.
    Exiger des boutons « Monter/Descendre la ligne R / la colonne C du tableau N », `Échap` pour
    annuler un drag en cours (2.1.2), des cibles ≥ 24 px (2.5.8), et un aperçu live **gaté** (2.3.3)
    + résultat annoncé (4.1.3).
16. ⚠️ **Ajouter « image » au sélecteur, y compris en cellule.** Une image sans alternative est un
    échec 1.1.1 dans **toutes** les projections — le code le dit lui-même
    (`BlockEditor.tsx:1175-1178` : l'`alt` alimente les options de quiz, la note XMind et le PDF).
    Donc : champ alt obligatoire pour une cellule-image, troisième état à refléter dans le nom du
    bouton de type (`:1468`), et cibles suffisantes si deux contrôles cohabitent dans une cellule.
17. ✅ **Direction bonne, règles strictes.** Vérifié dans Radix : le trigger pose
    `aria-describedby` quand le contenu est ouvert et l'ouvre sur `onFocus`
    (`node_modules/@radix-ui/react-tooltip/dist/index.mjs:186` et `:208-211`), et le contenu porte
    `role="tooltip"` (`:347`) — un tooltip Radix **est** donc accessible au clavier, contrairement
    à `title`. Mais **deux défauts de configuration** dans `src/components/ui/tooltip.tsx` :
    `disableHoverableContent = true` (`:7` et `:14`) fait disparaître le contenu dès que le
    pointeur le survole → échec **1.4.13 (Content on Hover or Focus)**, critère « Hoverable »,
    dès qu'un tooltip porte une information (et le test `tooltip.test.tsx` l'affirme comme
    comportement voulu) ; `delayDuration = 0` (`:6`) ouvre instantanément. Enfin `z-50` (`:44`)
    est **égal** au `zIndex: 50` de la modale (`DescriptionDialog.tsx:265`) : risque
    d'empilement/occlusion à vérifier dans l'app (non vérifié ici). Règle : `aria-label` toujours,
    le tooltip ajoute le raccourci ou la raison **jamais** le nom ; tooltip informatif →
    `disableHoverableContent={false}` ou contenu réellement dans le DOM ; `Échap` ferme (Radix le fait).
18. ⚠️ **Focus auto sur le titre après création.** Acceptable (l'utilisateur vient d'agir : ce
    n'est pas un vol de focus, 3.2.1 n'est pas en cause), mais cinq pièges : (a) **un seul**
    auto-focus doit gagner — la modale annule déjà celui de Radix (`DescriptionDialog.tsx:248`) et
    `BlockEditor` met le caret dans le premier champ quand `autoFocusField` (`:347-362`) : #18 doit
    trancher entre les deux, pas empiler ; (b) quand `onRenameTitle` est absent, le champ titre est
    `readOnly` (`:352`) mais reste focusable : y poser le focus est une impasse annoncée
    « Titre de la carte, lecture seule » (2.1.1/2.4.3) → n'auto-focus que s'il est éditable ;
    (c) le « + » qui crée le frère manquant ne doit **pas** réutiliser `aria-label="Aller à « X »"`
    (naviguer vs créer) : nommer l'action de création (3.2.4/2.5.3) ; (d) si la carte créée est
    hors écran, le focus ne doit pas être masqué (2.4.11) et un lecteur d'écran n'apprend rien →
    annonce live (4.1.3) ; (e) conserver le bon motif actuel : `NavArrow` disparaît quand la cible
    n'existe pas (`:520`) au lieu d'un bouton grisé mort.

---

## Violations WCAG que la liste introduirait

| Critère | Nom | Items |
| --- | --- | --- |
| 1.1.1 (A) | Non-text Content | #16 |
| 1.3.1 (A) | Info and Relationships | #5, #9, #10, #11, #14 |
| 1.4.1 (A) | Use of Color | #1, #8 |
| 1.4.3 (AA) | Contrast (Minimum) | #1, #8 |
| 1.4.11 (AA) | Non-text Contrast | #1 (bordures), #15 (poignées) |
| 1.4.13 (AA) | Content on Hover or Focus | #1, #17 (via `disableHoverableContent`) |
| 2.1.1 (A) | Keyboard | #3, #6, #13, #14, #15 |
| 2.1.2 (A) | No Keyboard Trap | #3 (`Tab` mutant), #15 (`Échap` pendant un drag) |
| 2.2.2 (A) | Pause, Stop, Hide | #2, #5, #15 (mouvement automatique/infini) |
| 2.3.3 (AAA) | Animation from Interactions | #1, #2, #5, #15 |
| 2.4.3 (A) | Focus Order | #11, #13, #18 |
| 2.4.11 (AA, 2.2) | Focus Not Obscured (Minimum) | #12, #18 |
| 2.5.3 (AA) | Label in Name | #1 (déjà violé aujourd'hui), #18 |
| 2.5.7 (AA, 2.2) | Dragging Movements | #15 (et #9/#10 si le drag devient le seul chemin) |
| 2.5.8 (AA, 2.2) | Target Size (Minimum) | #14, #15 (+ existant : poignées 18 px) |
| 3.2.4 (AA) | Consistent Identification | #3, #4, #11, #18 |
| 3.3.2 (A) | Labels or Instructions | #3, #6, #14 |
| 4.1.2 (A) | Name, Role, Value | #13, #14, #16 |
| 4.1.3 (AA) | Status Messages | #2, #4, #7, #13, #15, #18 |

Note de rigueur sur 2.2.2 : honorer `prefers-reduced-motion` n'est pas, à la lecture stricte,
un « mécanisme pour mettre en pause » fourni par la page. Les animations infinies existantes
(`.card-node--reparent-target` 900 ms, `.reparent-ghost-edge path` 600 ms linéaire) sont
neutralisées nulle part ; les citer comme points 2.2.2 est une lecture stricte, à arbitrer.

---

## Règles à imposer

### Tooltips (règle générale, #1 et #17)
1. Un tooltip **n'est jamais** un nom accessible. Tout contrôle doit garder `aria-label` (ou un
   texte visible) ; le tooltip ne transporte que le raccourci, l'état ou la raison du refus.
2. Interdit : remplacer le texte visible d'un `NavArrow` par un tooltip sans que le nom contienne
   à la fois la relation et la destination (« Parent : « Titre » »), sinon 2.5.3.
3. Tooltips informatifs (conflits de synchro, raison de désactivation) : contenu lisible au
   pointeur sans qu'il disparaisse (`disableHoverableContent={false}`) ou texte réellement dans le
   DOM ; `Échap` ferme (Radix) ; `z-index` strictement supérieur à celui de la modale.
4. Un tooltip teinté aux couleurs d'une carte est **accepté seulement** si le texte ne vient pas
   de la même palette : fond teinté + texte neutre, **ou** vérification programmatique
   (`src/colors/contrast.ts` : `oklchWcagContrast` ≥ 4.5:1, sinon `pickReadableTextColor`).
5. Toute règle `:hover` doit avoir un jumeau `:focus-visible`/`:focus-within` (modèle :
   `index.css:344-355`).

### Conteneurs (#9, #10)
- Un conteneur est un groupe nommé : `role="group"` + `aria-label` (ou `fieldset`/`legend`) ;
  les enfants gardent leurs propres noms. Jamais de hiérarchie purement visuelle (bordure/fond).
- Un groupe vide porte une alternative textuelle ; l'ordre DOM **est** l'ordre de lecture ; les
  projections texte plat (quiz/XMind/PDF) doivent aplatir correctement les groupes.
- Un conteneur doit rester franchissable au clavier (sortir un bloc du groupe sans souris).

### Mouvement (#2, #5, #15 et tout hover animé)
- Garde-fou **global** à ajouter dans `src/index.css`, dans un
  `@media (prefers-reduced-motion: reduce)` : `.react-flow__node` (transition `transform`,
  ligne 248-250), `.card-node--reparent-target` (animation 900 ms), `.reparent-ghost-edge path`
  (animation 600 ms), `.quiz-frame__progress-fill` (largeur 260 ms), et les utilitaires
  d'entrée/sortie Radix (`data-open:animate-in`, `data-closed:animate-out`) qui viennent de
  `tw-animate-css` — vérifié : ce paquet ne contient **aucun** `@media` (grep sans résultat sur
  `node_modules/tw-animate-css/dist`), donc rien n'est gaté aujourd'hui.
- Framer Motion / `motion` v13 (`package.json:38`) a `reducedMotion: "never"` par défaut
  (`node_modules/framer-motion/dist/cjs/index-BuO47Yrm.js:41`) : les `whileHover`/`whileTap` de
  `CardNode.tsx:191-193` tournent malgré le réglage système. Monter
  `<MotionConfig reducedMotion="user">` à la racine, ou utiliser `useReducedMotion()`, exporté par
  `motion/react` — vérifié : `node_modules/motion/dist/react.d.ts` fait
  `export * from 'framer-motion'`, et `framer-motion/dist/cjs/index.js:3828` exporte
  `useReducedMotion` (le défaut `"never"` est à `framer-motion/dist/cjs/index-BuO47Yrm.js:41`).
- Aucune animation ne doit être le **seul** canal d'une information (destination, résultat,
  insertion) : doubler par une annonce (4.1.3) et/ou un état focusable.
- Le slide horizontal entre blocs (#5) et l'animation de réordonnancement (#2) sont les deux
  déclencheurs vestibulaires les plus nets de la liste : gatés obligatoirement, et jamais en
  boucle.
- Les animations infinies décoratives ne sont pas pausables : les limiter, ou accepter la lecture
  stricte 2.2.2 comme point ouvert.

### Drag & clavier (#15, #2, #9)
- **Règle absolue** : aucune opération n'existe en drag-only (2.5.7). Chaque geste de drag doit
  avoir un équivalent clavier, nommé et atteignable.
- Blocs : l'existant est conforme (grip + monter/descendre). Ne pas le retirer.
- Lignes/colonnes : boutons « Monter/Descendre », `Échap` annule, cibles ≥ 24×24 px, résultat
  annoncé.
- Un contrôle purement focusable sans action (grip `draggable` sans `onClick`,
  `BlockEditor.tsx:700-718`) doit au minimum le dire : son `aria-label` actuel
  (« Déplacer le bloc N ») n'annonce pas le geste, seul le `title` le fait — inaccessible au
  clavier. Soit le grip devient une vraie commande clavier, soit il sort de l'ordre de tabulation.

---

## Ce qui est déjà bon dans le code (à ne pas casser)

- **Tooltip Radix correctement câblé** : `aria-describedby` pendant l'ouverture, ouverture au
  focus, `role="tooltip"` — vérifié dans `node_modules/@radix-ui/react-tooltip/dist/index.mjs`
  (`:186`, `:208-211`, `:347`). Le motif est déjà appliqué partout avec le nom accessible :
  `CommandButton.tsx:81` + `:75-97`, `CardNode.tsx:179` + `:175-216`, `FileSidebar.tsx:71-87`.
- **Aucun bouton icône-seule ne repose sur `title`** (comptage ci-dessus) : 115 `aria-label`
  contre 22 attributs `title` réels, dont 16 en doublon volontaire.
- **L'aide clavier est visible et honnête** : `ShortcutsPanel` à `role="group"`
  (`DescriptionDialog.tsx:566-613`), bouton « Raccourcis » avec `aria-expanded` (`:434`),
  défilement dans le flux plutôt qu'en overlay.
- **Focus initial maîtrisé** : annulation de l'auto-focus de Radix (`:248`) + caret en fin de
  texte existant (`BlockEditor.tsx:357-361`), et restauration transactionnelle du caret
  (`:331-344`).
- **Drag doublé au clavier** (2.5.7 satisfait) et **vrai `disabled`** sur `GutterIcon`
  (`BlockEditor.tsx:761`) ; `aria-disabled` + `pointerEvents: none` sur les boutons de bord
  (`CardNode.tsx:180`, `:204`).
- **Le garde `prefers-reduced-motion` existe et est utilisé** : `index.css` lignes 324, 725, 804,
  1137, 1280 ; `src/utils/prefersReducedMotion.ts` ; `src/theme/circularReveal.ts:9-24` ;
  `CardDetailPanel.tsx:201/214/367` ; `FileSidebar.tsx:477`. C'est une base saine — il ne manque
  que les cibles listées plus haut.
- **Outillage de contraste WCAG déjà présent** : `oklchWcagContrast` et `pickReadableTextColor`
  (`src/colors/contrast.ts:34,51`), avec tests (`contrast.test.ts`).
- **Vocabulaire ARIA déjà en place** : `role="group"` nommé (8 sites), `role="status"` /
  `role="alert"` (≈40 sites), `aria-pressed` sur les largeurs d'image
  (`BlockEditor.tsx:1196`), `role="separator"` + `aria-valuenow/min/max` + `onKeyDown` sur les
  poignées de redimensionnement (`FileSidebar.tsx:740-754`), `role="radiogroup"`
  (`QuizConfigModal.tsx:156`).
- **La garde `removeAt`** (`BlockEditor.tsx:460-461`) et le fait qu'un `NavArrow` sans cible
  disparaisse (`DescriptionDialog.tsx:520`) : deux protections sobres à conserver.
- **`:hover` + `:focus-within` appariés** sur la pastille de titre (`index.css:344-355`) : le
  modèle à généraliser plutôt que le motif « hover seulement ».

---

## Ce que je n'ai pas pu vérifier (à ne pas présenter comme acquis)

1. Le tour d'origine et les 18 idées ne m'étaient pas visibles : ce rapport juge la **liste
   verbatim** fournie par l'agent parent. Toute idée non listée n'est pas couverte.
2. #11 : le « double champ visible » n'est **pas reproduit** par lecture statique
   (`MathFieldEditor.tsx:103,188` = un seul contrôle). Capture d'écran ou repro nécessaire.
3. L'empilement effectif tooltip (`z-50`) vs modale (`zIndex: 50`) : risque d'occlusion non
   confirmé sans exécution.
4. La survie d'un saut de ligne dur dans la valeur LaTeX de MathLive (#6).
5. L'aplatissement des blocs parents dans `blocksToPlainText` / exports (#10).
6. La version de MathLive et son exposition ARIA propre du `<math-field>` (rôle, annonce des
   positions) : non inspectée.
7. 2.2.2 « mécanisme de pause » vs respect de `prefers-reduced-motion` : arbitrage de doctrine,
   signalé comme tel.
