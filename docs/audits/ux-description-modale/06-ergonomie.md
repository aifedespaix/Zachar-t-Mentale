# Audit ergonomie — mécanique du geste (modale de description)

Persona unique : expert en ergonomie / interaction design (Fitts, Hick, Miller, coût moteur,
cibles, distances, charge motrice, réversibilité). Aucun code modifié : lecture seule.

Modèle chiffré utilisé partout ci-dessous — **estimation**, forme de Shannon :

```
MT ≈ 200 + 150 · log2(D/W + 1)   (ms)
```

`a = 200 ms` (temps de décision + clic), `b = 150 ms/bit`. Les valeurs absolues sont
approximatives ; ce sont les **écarts** entre deux variantes qui portent l'argument.

Géométrie de référence, calculée depuis le code (`DescriptionDialog.tsx:260-276, 380-396`) :

| Grandeur | Valeur | Source |
| --- | --- | --- |
| Modale (fenêtre 1920×1080) | 1600 × 1015 px | `min(1600px,96vw)`, `min(94vh,1180px)` |
| Colonne de travail | 1080 px centrée | `maxWidth: 1080` (`:385`) |
| Marge morte | **260 px de chaque côté** | (1600−1080)/2 |
| En-tête | ≈ 93 px | padding `16px 56px 14px 20px` + chip |
| Pied de modale | ≈ 52 px | padding `10px 16px` + `Button` h-8 |
| Zone d'édition | ≈ 850 px de haut | 1015 − 93 − 52 − 20 |
| Rendement de surface | **1080×850 / 1600×1015 ≈ 56 %** | — |

Repères externes : Apple 44×44, Material 48 dp, **WCAG 2.5.8 (AA) 24×24** CSS px minimum.

---

## Verdict global

Le **cœur** de la modale est ergonomiquement solide : le pied d'outils collé au bloc actif
(`BlockEditor.tsx:591-601`) rend la distance palette↔caret **invariante** (45–70 px ⇒ ≈ 390 ms)
et le `preventDefault` sur `mousedown` (`MathPalette.tsx:288`) conserve le caret, donc le retour
coûte **0 ms**. Idem : autosave 600 ms, sortie non accidentelle (`onInteractOutside` annulé),
suppression de description confirmée.

La **périphérie** est fragile, sur trois familles :

1. cibles de manipulation fine à **18–30 px** (dont une destructive à 18×18 collée à 1 px d'une
   autre) ;
2. navigation aux 4 bords **hors cadre** (`-18px`), avec 590→930 ms de trajet selon la flèche ;
3. **ambiguïté** du drop et **décalage d'une demi-cellule** des `+` de tableau.

Sur les 18 idées : **4 progrès réels** (#2, #4, #7, #17), **6 à conditionner**, **5 régressions ou
refus** (#1, #3-Tab, #5, #13 tel quel, #18 ; plus #16-cellule et #14 dans leur forme stricte).

---

## Mesures de cibles

| Élément | Taille actuelle | Reco | Verdict (44 / 48dp / 24) |
| --- | --- | --- | --- |
| `NavArrow` pilule | h **30**, larg. ≤168 (latéral) / ≤260 (haut-bas) | h 40, rentrée à ±4 px | ⚠️ < 44 ; hauteur limitante |
| Croix « Fermer » | **30×30** (`:298-299`) | 40×40 | ⚠️ < 44 |
| Fermer les raccourcis | **26×26** (`:598-599`) | 32×32 | ⚠️ |
| `GHOST_BUTTON` (menu de type, « → tableau ») | **30×26** (`:634-635`) | h 32 | ⚠️ < 44 ; OK 24 |
| Poignée de drag | **24** larg. × 26 haut (`:715`) | 32×32 | ⚠️ |
| `GutterIcon` (monter/descendre/supprimer) | **24×24**, `gap: 2` (`:764-767`) | 32×32, écart ≥ 8 | ⚠️ |
| `CELL_BUTTON` (Aa/∑ par cellule) | **28×30** (`:1219-1220`) | 32×32 | ⚠️ |
| `HANDLE_BUTTON` « + » tableau | **18×18** (`:1343-1344`) | 28–32 | ❌ < 24 : **échec WCAG 2.5.8** ; exception d'espacement inapplicable (2×18+1 px = 37 px, centres à 19 px < 24) |
| `HANDLE_BUTTON` corbeille ligne/colonne | **18×18**, à **1 px** du « + » | idem + séparation | ❌ **critique** : destructive, sous-dimensionnée, adjacente |
| Pas de largeur d'image (160…640) | ≈ **35×17** (`:1199`) | h 24–28 | ⚠️ 17 px de haut |
| Touches palette maths | **46×44** / 70×52 (`MathPalette.tsx:317-318`) | ✅ | ✅ conforme 44 |
| Touches caractères spéciaux | minW **40** × h **38** (`LanguageHelpPalette.tsx:229-230`) | 44×44 | ⚠️ 38 < 44 |
| Boutons langue (drapeaux) | ≈ **30** h (`padding 5px 11px`) | 36–40 | ⚠️ |
| `Button` design system (pied) | default `h-8` = **32** | 36 | ⚠️ conforme WCAG |
| `ADD_BUTTON` | ≈ 30 h, pleine largeur | ✅ | ✅ |

### Distances champ ↔ contrôles (1920×1080)

| Trajet | D | W | MT (est.) |
| --- | --- | --- | --- |
| champ → **pied du même bloc** (palette) | 45–70 px | 44 | **≈ 390 ms**, retour **0** (caret conservé) |
| champ → **menu de type** (bord droit de la colonne) | ≈ 523 px | 70 | **≈ 660 ms**, A/R ≈ 1,3 s |
| champ → flèche **haute** | 153 px | 30 | ≈ 590 ms |
| champ → flèche **basse** | 850 px | 30 | **≈ 930 ms** |
| champ → flèches **gauche/droite** | ≈ 846 px | 120 (pilule) → 40 (icône 30) | 650 → **870 ms** (+220 ms) |
| champ → **croix** | 782 px | 30 | ≈ 885 ms |

Deux constats de géométrie :

* les **4 flèches ne sont pas équidistantes** : 590 → 930 ms, soit **340 ms d'écart** (facteur 1,6)
  entre quatre contrôles lus comme un seul groupe. Le geste le moins cher est le haut, le plus cher
  le bas ;
* elles vivent à `-18px` (`:483-488`), donc **à cheval sur le bord visible** : la moitié de la
  cible est au-dessus de l'overlay sombre, et le geste franchit une frontière visuelle du cadre.
  À 96vw, sur une fenêtre de 1024 px la marge n'est que de 20,5 px : la flèche touche le bord de
  l'écran (et sur les bords haut/bas, la barre des tâches).

---

## Item par item

**1. Flèches en icône seule + tooltip coloré, animation de survol** — ❌ régression.
La pilule publie sa destination **à 800 px** (lecture parafovéale pendant le trajet) ; l'icône
déplace l'information **après** le geste. Coût : cible effective 120 → 40 px ⇒ ID 3,0 → 4,46 bits
⇒ **650 → 870 ms** (+220 ms) ; puis coût de Hick (2–4 icônes identiques ⇒ 1–2 bits, ≈ 150–250 ms)
et **délai de survol**. Point vérifié : `NavArrow` utilise `title=` **natif** (`:533`, ~500–1500 ms
selon navigateur, non stylable, absent du clavier/tactile), pas le `Tooltip` Radix du repo
(`tooltip.tsx:6`, `delayDuration = 0`, mais `Portal` en `z-50` alors que le contenu de la modale est
en `zIndex: 50` : empilement à tester). Total ≈ **0,65 s aujourd'hui → ≈ 1,9 s** par navigation.
Le tooltip coloré selon la carte cible est en revanche une **bonne** idée : il conserve l'identité
chromatique, qui est le canal déjà utilisé partout ailleurs. **Compromis retenu** : garder la
pilule, la réduire à *mot de relation + 8 caractères* (≈ 90 × 40 px, rentrée à ±4 px **dans** le
cadre), tooltip Radix instantané en canal redondant, et réduction à l'icône seulement **après** la
première visite de la session. L'animation de survol doit être ≤ 120 ms et ne rien retarder : elle
confirme la cliquabilité **après** l'arrivée, elle ne la révèle pas **avant**.

**2. Animation de déplacement des blocs** — ✅ le meilleur item de la liste.
Le drop n'est pas un problème de Fitts (la ligne entière, ~1080 × 60–200 px, est une cible
énorme) mais d'**ambiguïté**. `moveBlock` (`:120-126`) = `splice` : déposer sur la ligne *i* vaut
« après *i* » en descendant et « avant *i* » en montant — **la même position visuelle donne deux
résultats**. L'existant (`:537`) est un simple `outline: 2px dashed` avec `outlineOffset: 2`, sans
aucune transition : il dit « cette ligne est visée », pas « voici l'ordre final », et son bord est
décalé d'une demi-ligne (≈ 40–90 px) du point d'insertion réel. L'animation doit montrer :
(a) un **vide de la hauteur exacte du bloc** qui s'ouvre à l'index d'arrivée, les autres blocs
glissant en 150–200 ms (ease-out) — c'est la vitesse « classique » d'une bonne UX ;
(b) le bloc en vol en **suivi 1:1 sans easing** (règle de la manipulation directe : seule la
*disposition* s'anime, jamais l'objet sous le curseur), `scale 1.02` + ombre, offset aligné sur le
drag image (24,18, cohérent avec la poignée 24×26) ;
(c) la position d'origine **refermée**, pour que la hauteur totale reste le retour d'information ;
(d) **demi-bloc haut = avant / demi-bloc bas = après**.
Gain : cible effective 2 px → ≈ 80 px ⇒ ID 6,66 → 1,8 bits, **≈ 700 ms par dépôt**, plus la classe
entière des re-drags ratés (2–4 s).

**3. Raccourcis : Entrée = ligne, Ctrl+Entrée = bloc, Tab = type** — ❌ sur le fond, ⚠️ sur la forme.
Faits : dans la modale `Entrée` = **nouveau bloc** (`AutoGrowTextarea:1056-1060` →
`insertBlockAfter`), `Maj+Entrée` = retour à la ligne ; sur le canvas `Entrée` = `addSiblingBelow`,
`Maj+Entrée` = `addSiblingAbove`, `Tab` = `addChild`, et `Mod+Entrée` = `card.editDescription`
(`commands.ts:270-274`) — donc **l'item inverse des conventions déjà prises dans l'app même**.
De plus `useGlobalShortcuts.ts:102` (`if (isModalOpen()) return`) rend les raccourcis globaux
inertes dans la modale : la liaison est techniquement libre, mais **sémantiquement occupée**.
Deux refus nets :
* **`Tab` = changement de type : refus catégorique.** Tab est le seul moyen de parcourir la modale
  au clavier (WCAG 2.1.1 accessibilité clavier, 2.4.3 ordre de focus) ; le détourner casse la
  navigation complète d'une modale à ~40 cibles. Utiliser un accord non conflictuel (`Alt+T`).
* **`Ctrl+Entrée` = accepter/ajouter un bloc : collision** avec le geste qui a *ouvert* cette
  modale (`Mod+Entrée`). Préférer `Alt+Entrée`.
Sur le fond : `Maj+Entrée` sert déjà le « aller à la ligne » dans un bloc. Le vrai manque n'est pas
le raccourci, c'est **#4 + #7** (voir plus bas). Si la paire #3+#6 est adoptée, elle doit l'être
**partout, canvas compris**, sinon la même touche aura deux sens selon la surface. Tout nouveau
raccourci doit apparaître dans `ShortcutsPanel` (`DescriptionDialog.tsx:584-589`), seule table de
correspondance consultable.

**4. Le nouveau bloc garde le type du bloc au-dessus** — ✅ gain net, à cadrer.
Vérifié : `insertBlockAfter(index, { kind: 'text', text: '' })` (`:561`) et `append({kind:'text'})`
(`:608`) créent **toujours du texte**. Coût actuel pour écrire une suite de formules : par ligne,
ouvrir le menu de type (≈ 660 ms de trajet) + choisir (≈ 300 ms) + reprise du focus (#7) ≈ **1 s** ;
pour 8 lignes, **≈ 8 s** et 8 allers-retours souris de 523 px, pour un résultat que l'utilisateur
connaît d'avance. Cadrage : n'hériter que de `text`/`math`. Un `table` ou un `image` ne doivent
**pas** s'hériter (une table vide imposée est un coût, pas un service) — et dans une table, `Entrée`
ajoute déjà une **ligne** (`:1400`), donc le cas est résolu.

**5. Palette en toolbar haute suivant le focus + slide** — ❌ régression de geste répété.
Le pied collé au bloc a une distance **invariante** (45–70 px, ≈ 4,0 s pour 10 insertions) ; une
barre haute est **O(n)** : bloc 1 ≈ 60–100 px, bloc 4 ≈ 330 px, bloc 6 ≈ 510 px, plus 200–400 px
horizontaux pour atteindre la bonne touche ⇒ 600–750 ms par insertion ⇒ **6,5–7,5 s pour 10
symboles (+60 à 85 %)**, avec perte de la mémoire motrice à chaque défilement et rupture du lien
« cette palette écrit dans **cette** formule ». Le `slide right/left` ajoute un défaut propre :
**les cibles bougent pendant 200–300 ms**, et un clic qui tombe pendant le mouvement se trompe de
touche (effet de cible mobile : +100–200 ms et taux d'erreur supérieur) — si animation il y a,
≤ 120 ms, en fondu, et jamais sur du contenu interactif ; respecter `prefers-reduced-motion`.
En revanche le vrai défaut du pied actuel est ailleurs : il n'existe **que sur le bloc actif**
(`:591`), donc son apparition/disparition déplace tout ce qui suit de **≈ 120–190 px** (palette
maths ≈ 3 groupes de 52 px, caractères ≈ 120–160 px) **au moment même du `onMouseDown`** qui change
de bloc actif (`:515`) ⇒ la cible peut bouger sous le curseur entre `mousedown` et `click`
(échec silencieux : « je clique et rien ne se passe »). Correction : garder l'attache au bloc mais
en `position: sticky; bottom: 0` (ou hauteur réservée) ⇒ distance O(1) **sans** layout shift.

**6. Formule WYSIWYG : Entrée = nouvelle ligne** — ⚠️ à conditionner avec #3 (paire cohérente en
interne, incompatible avec `Entrée` = bloc frère du canvas). Aujourd'hui `Entrée` dans une formule
déclenche `onEnterBlock` (`MathFieldEditor.tsx:163-167`) et `Maj+Entrée` est laissé à MathLive.
Recommandation : garder **`Entrée` = nouveau bloc** et **`Maj+Entrée` = nouvelle ligne** (dans une
formule : insérer `\\`), identique partout. Une rupture « `Entrée` fait un bloc en texte mais une
ligne en formule » coûte à chaque frappe un arbitrage (Miller) et fabrique des blocs parasites.

**7. Focus auto après changement de type** — 🏗️ oui, sous 4 conditions.
Le champ est **remonté** au changement de type (`textarea` ↔ `MathLive`), donc le focus est perdu :
le restaurer est juste. Risques mesurés :
1. `focus()` sans `preventScroll` fait défiler le conteneur ⇒ le bloc saute sous le curseur ;
   utiliser `focus({ preventScroll: true })` + `scroll-margin`.
2. L'auto-focus de montage pose le caret **en fin de texte** (`:360`, `setSelectionRange(len,len)`) :
   dans une phrase à moitié écrite, l'utilisateur perd son point d'insertion (ré-aim ≈ 1–2 s).
   Préserver l'**offset de caractère**.
3. MathLive se charge en ≈ 50–200 ms (`MathFieldEditor.tsx:69-79`) : focaliser avant qu'il soit
   prêt perd le caret **en silence** ⇒ focaliser sur disponibilité, pas sur le clic.
4. Ne déclencher que sur un changement **initié par l'utilisateur** (jamais sur re-render/debounce) :
   sinon vol de focus pendant la frappe, et composition IME (accents, touches mortes) annulée.

**8. Bouton « Question » (icône + texte) dans la colonne de droite** — ⚠️ bon besoin, mauvaise
place. La colonne droite est déjà un empilement de 2 contrôles de 26 px avec `gap: 4` (`:566`)
≈ 56 px pour un bloc d'une ligne de 60 px ; un troisième contrôle *avec libellé* (≈ 90 × 26) rend la
colonne plus haute que le bloc (min-height poussé) **et** fait varier le bord droit du champ d'un
bloc à l'autre. Recommandation : colonne droite **icône seule, largeur constante 32 px**, et la
création d'une question rejoint la **zone de création** existante (la rangée `ADD_BUTTON` du bas,
`:607-624`) — une zone = un sens.

**9. Question = bloc parent, bordure/fond bleu, enfants en gris** — 🏗️ bonne idée
(chunking : regrouper des réponses sous une question réduit la charge de lecture), mais deux
réserves de surface :
* **deux remplissages imbriqués** (bleu du parent + gris de l'enfant) créent une hiérarchie de
  surfaces sans hiérarchie de contraste garantie en thème sombre ;
* le remplissage bleu entre en concurrence avec le **marqueur de bloc actif** (`:533-535`,
  bordure accent + `color-mix` à 88 % transparent) : dans un parent bleu, « quel bloc est actif »
  peut devenir illisible.
Recommandation : le parent comme **rail gauche de 3 px + bandeau d'en-tête** (pas de remplissage),
les enfants sur le fond normal ; l'état actif garde son propre accent.

**10. « Soit des blocs, soit des blocs parents »** — ❌ refus du **mode exclusif**. Une exclusivité
oblige à décider la nature du document **avant** d'écrire, et impose une conversion pour changer
d'avis : c'est exactement le coût de réversibilité que le reste du fichier évite
(`convertBlock` refuse même l'image pour ne rien détruire, `:68-91`). Autoriser la **coexistence**
(blocs libres + questions), l'organisation étant une affaire d'ordre, pas de mode.

**11. « Les champs formules en affichent deux au chargement »** — ⚠️ ce n'est pas un bug de rendu
mais le **chemin de repli assumé**. `MathFieldEditor` décide **une fois au montage**
(`:103`, `const [showMathField] = useState(() => loaded)`) : le premier bloc formule d'une session
affiche le `fallback` du call site (`BlockEditor.tsx:1099-1125`) = **un textarea LaTeX *et* un
aperçu KaTeX** — littéralement « le format texte + le visuel ». Une fois MathLive chargé, tout
nouveau montage est WYSIWYG (d'où « après un aller-retour texte→formule, c'est correct »).
Coût ergonomique : deux représentations pour une valeur, **deux cibles candidates** (« où est-ce
que je tape ? »), ≈ 44 px + 4 + 22 px ≈ 70 px de hauteur, et l'aperçu est exposé aux lecteurs
d'écran (il n'a que `data-testid`, ni `role` ni `aria-label`) ⇒ la valeur est annoncée deux fois.
Recommandation : une seule zone **saisissable**, l'aperçu en miroir `aria-hidden`, et un indicateur
discret « rendu visuel bientôt disponible » plutôt que deux champs simultanés.

**12. Cellule de tableau en formule : le champ ne prend pas la largeur de la case** — ✅ confirmé
par le code, cause identifiée. Le chemin texte rend un `<input>` avec `width: '100%'`
(`FIELD_STYLE:950-951`) ; le chemin formule rend `<div ref={hostRef} data-testid="math-field" />`
**sans aucun style** (`MathFieldEditor.tsx:189`) : dans la rangée en `display:flex` de la cellule
(`:1425`), cet hôte n'a ni `flex: 1` ni `minWidth: 0`, donc il se dimensionne sur le contenu, pas
sur la colonne `minmax(84px, 1fr)`. Conséquence ergonomique : **affordance fausse** — la case
paraît éditable sur toute sa surface, la cible réelle est plus étroite ; et les deux modes d'une
même cellule n'ont pas la même géométrie, donc la colonne « bouge » selon le type de la cellule.
Correctif ergonomique : l'hôte doit être `flex: 1; min-width: 0`, et le champ `width: 100%`.

**13. Boutons undo/redo en icônes dans la toolbar du haut** — ⚠️ déjà fait, et **inatteignable au
bon moment**. `AppToolbar.tsx:366-367` monte déjà `CommandButton command="edit.undo" icon={Undo2}`
et `edit.redo` + `Redo2`, avec `Tooltip`. Mais quand la modale est ouverte, l'`Overlay` est
`position: fixed; inset: 0; zIndex: 50` (`:237-239`) et couvre toute la fenêtre : la toolbar du haut
est **recouverte** (donc non cliquable), et `useGlobalShortcuts.ts:102` rend de toute façon les
raccourcis globaux inertes. Or c'est **dans la modale** qu'on annule (`descriptionHistory`, `Ctrl+Z`
local, `:213-222`), et le pied de modale n'expose que `Raccourcis`/`Fermer`. Recommandation : les
icônes undo/redo doivent être **dans la modale** (en-tête ou pied), l'état `disabled` étant porté par
la pile `descriptionHistory` — sinon l'item n'apporte rien.

**14. « Tableau » affiché comme « Image » + déplacer ajouter ligne/colonne dans la colonne** — ❌ en
partie. **Le libellé est bien faux** : `BlockEditor.tsx:799`, `const current = kind === 'math' ?
'Formule' : kind === 'text' ? 'Texte' : 'Image'` — un `table` tombe dans le `else` et s'affiche
**« Image »** (avec l'icône `Table2` : le texte et l'icône se contredisent). À corriger, c'est un
mensonge d'état. Mais **retirer le footer du tableau** retire la seule voie **découvrable** :
les libellés « Ajouter une ligne/colonne » (h 28, `:942`) et le texte d'explication
(`:931-935`), alors que les `+` font 18×18 avec `opacity: 0.42` (`:1337`). Refus, sauf si les `+`
passent à ≥ 28 px et qu'une aide reste visible. Le besoin réel est la **découvrabilité**, pas la
relocalisation.

**15. `+` « au bon endroit », aux extrémités, + drag/drop de lignes/colonnes** — ✅ le diagnostic
est juste et j'ai la mesure : `addTableColumn(block, columnIndex)` (`:1280`) insère **après** la
colonne cliquée, mais le bouton est **au-dessus de la colonne**, centré sur elle ⇒ l'insertion
apparaît **décalée d'une demi-cellule** (≈ 42–90 px selon la largeur), et le `+` de la dernière
colonne est visuellement « au milieu », pas à l'extrémité. Idem pour les lignes : `addTableRow(…,
rowIndex)` (`:1375`) insère **sous** la ligne cliquée alors que le `+` est **à gauche, centré**
dessus ⇒ décalage d'une demi-hauteur (≈ 15–20 px). Le modèle « je clique là où je veux la cellule »
est donc une promesse non tenue, ce qui est le pire cas : l'erreur est systématique et invisible.
Le drag/drop de lignes/colonnes avec aperçu direct est un **gain moteur réel** (même famille que
#2 : la place finale visible pendant le geste ; cible 1 px → ~80 px, ≈ 700 ms) — à faire avec la
même règle : suivi 1:1 de l'élément, animation réservée à la disposition.

**16. Ajouter « image » au choix formule/texte (barre du bloc **et** cellule)** — ⚠️/❌.
Vérifié : `convertBlock` **retourne le bloc inchangé** pour `kind === 'image'` (`:88-89`) — l'entrée
de menu serait un **no-op**, c'est-à-dire une affordance fausse, le pire résultat en réversibilité.
De plus, une cellule-image exigerait un nouveau type de `TableCell` (`string | {latex}`), plus le
rendu dans `BlockView` et dans le PDF. Recommandation : pour le **bloc**, une entrée « Image »
reliée au sélecteur existant (`onPickImage`, déjà branché sur le bouton `ADD_BUTTON` du bas) est
acceptable — elle évite de changer de type puis d'insérer ; pour la **cellule de tableau**, refus
(coût de modèle de données très supérieur au bénéfice).

**17. Des tooltips partout au lieu des `title`** — ✅ avantage réel, ⚠️ à ne pas surinterpréter.
`title=` est utilisé massivement (flèches `:533`, croix `:289`, `GHOST_BUTTON`, gouttière,
touches de palette, `HANDLE_BUTTON`, `CELL_BUTTON`) : latence ≈ 500–1500 ms (estimation), non
stylable, **invisible au clavier et au tactile**. Le `Tooltip` du repo (`tooltip.tsx:5-12`) est à
`delayDuration = 0` et se déclenche au **focus** comme au survol : c'est un gain de **latence de
~0,5–1,5 s par survol** et une vraie amélioration d'accessibilité. Trois conditions :
(a) vérifier visuellement l'empilement (Portail `z-50` vs contenu de modale `zIndex: 50`) ;
(b) ne jamais mettre un tooltip sur un libellé déjà visible (`FooterButton`, `ADD_BUTTON` : bruit) ;
(c) un tooltip **n'agrandit pas la cible** — il ne remplace pas le volet « tailles » ci-dessus, et
le contenu au survol doit rester accessible/éliminable (WCAG 1.4.13).

**18. `+` à la place d'une flèche absente (créer le frère/enfant) + focus sur le titre** — ❌ refus.
La présence des flèches dépend des données (`NavArrow` retourne `null`, `:520`) : 0 à 4 contrôles
selon la carte ⇒ **balayage visuel à chaque visite** (≈ 200–400 ms), aucune habitude motrice
possible. Surtout, la **même position porte deux sens** selon la carte : *naviguer* (réversible,
gratuit) ou *créer une carte* (mutation du document, coût de réparation ≈ 3–8 s : annuler,
renommer, supprimer). Comme les deux pilules ont le même style, le même bord et le même coût
apparent, un clic réflexe sur « suivant » quand il n'y a pas de suivant **crée un frère non voulu** :
c'est un piège, pas un raccourci. Recommandation : garder la position **sémantique** (naviguer ou
rien), et mettre la création dans une affordance **toujours présente**, étiquetée
(« Créer le suivant »), de forme différente (pointillés), à **≥ 24 px** des flèches, révélée au
survol/focus de la zone de bord. Le « focus automatique sur le titre » après création : oui
(continuité), avec `preventScroll` (voir #7).

---

## Les 3 gestes les plus coûteux aujourd'hui

1. **Naviguer par les flèches de bord** — 590 à **930 ms** de trajet selon la flèche (810–1150 ms si
   passées en icône), auxquelles s'ajoutent la sortie du cadre visible (`-18px`) et 260 px de marge
   morte par côté. C'est le seul geste dont le coût varie de 1,6× pour des contrôles lus comme un
   groupe.
2. **Manipuler un tableau** — corbeille de colonne/ligne en **18×18 collée à 1 px** d'un `+` : miss
   estimé **4–8 %** (vs 1–2 % à 32 px avec 8 px d'écart) pour une action **destructive** ; et le `+`
   lui-même est **décalé d'une demi-cellule** (42–90 px) de l'endroit où la cellule apparaît.
3. **Écrire une suite de formules** — `Entrée` crée toujours un bloc **texte** (#4) : par ligne,
   ≈ 660 ms de trajet vers le menu de type + ≈ 300 ms de choix + reprise du focus ≈ **1 s** ;
   pour 8 lignes, **≈ 8 s** et 8 allers-retours de 523 px. À quoi s'ajoute le layout shift de
   **120–190 px** du pied actif-only qui peut déplacer la cible sous le curseur (#5).

## Les 3 modifications au plus fort gain réel

1. **#2 complet, plus la correction du modèle de drop** (`avant/après` selon la moitié de ligne,
   vide animé de la hauteur exacte) : ≈ **700 ms** par dépôt et suppression d'une classe entière
   d'erreurs de modèle mental ; c'est aussi la même mécanique que #15 (drag de lignes/colonnes).
2. **La paire #4 + #7** (hériter `text`/`math` + restauration du focus **sans** vol de scroll ni de
   caret) : ≈ **1 s gagnée par ligne**, ≈ 8 s sur une formule de 8 lignes, sans changer de modèle
   mental ailleurs dans l'app.
3. **Plan de cibles + stabilité du pied** : `HANDLE_BUTTON` 18 → 28 (corbeille séparée de ≥ 8 px ou
   révélée au survol), `GutterIcon` 24 → 32, pas de largeur d'image 17 → 28, touches de caractères
   38 → 44, `NavArrow` h 30 → 40 **rentrée dans le cadre**, et pied de bloc en `sticky` pour
   conserver l'invariant « 45–70 px » sans layout shift. À quoi s'ajoute **#17** (tooltips Radix à
   délai 0) : le gain le moins cher de toute la liste, ≈ 0,5–1,5 s par survol.
   Note : réduire la modale de 1600 à 1200 px ne gagne **rien** sur la colonne (1080 centrée) —
   c'est la position des flèches qui compte, pas la largeur du cadre.

## Ce que je refuse, et pourquoi

* **#1 tel quel** (icône seule + tooltip) : +220 ms de moteur, +0,7–1,5 s de décision — l'information
  passe d'**avant** le geste à **après**. Acceptable seulement en icône ≥ 40×40, tooltip Radix à
  délai 0, mot de relation toujours visible.
* **#3-Tab** (type au `Tab`) : détruit la navigation clavier de la modale (WCAG 2.1.1 / 2.4.3), et
  `Ctrl+Entrée` entre en collision avec `Mod+Entrée` = `editDescription`.
* **#5 tel quel** (palette en haut + slide) : transforme une distance O(1) en O(n) (+60–85 % sur un
  usage répété), casse le lien palette↔bloc, et fait bouger les cibles pendant l'animation.
  Seule la variante « pied collant, hauteur stable » est retenue.
* **#10 mode exclusif** blocs *ou* blocs parents : coût de réversibilité (décider avant d'écrire,
  convertir pour changer d'avis).
* **#14 retrait du footer tableau** dans sa forme stricte : supprime la seule voie découvrable
  (libellés + texte d'explication) alors que les `+` restent à 18 px / opacité 0,42. Le libellé
  faux « Image » pour un `table`, lui, doit être corrigé.
* **#16 « image » dans une cellule de tableau** : coût de modèle de données (type de cellule, rendu,
  PDF) très supérieur au bénéfice, et `convertBlock` est déjà un no-op vers `image`.
* **#13 tel quel** (« dans la toolbar du haut ») : les icônes y sont **déjà** (`AppToolbar.tsx:366`)
  et sont **recouvertes par l'overlay** de la modale, donc inutilisables au moment où l'on annule.
* **#18** : jamais de substitution navigation/création à la même position — piège de clic réflexe
  créant une carte non voulue.
* Et de façon générale : **toute animation de drop > 200 ms**, ou qui anime l'élément sous le curseur
  plutôt que la disposition ; **tout nouveau recours à `title=` natif** comme canal d'information.
