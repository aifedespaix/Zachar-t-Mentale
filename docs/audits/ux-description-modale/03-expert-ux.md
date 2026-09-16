# Audit UX — modale de description

**Persona : expert UX** (parcours, charge cognitive, découvrabilité, coût d'interaction).
**Angle :** combien de gestes, quelle découvrabilité, quels conflits de modèle mental, quels cas
limites (dernier bloc supprimé, bloc vide, description vide, carte sans parent/enfant, tableau 1×1).
**Règle de cet audit :** aucune ligne de code écrite, aucun autre fichier touché.

## Ce qui a été lu (pas de jugement à l'aveugle)

`src/content/DescriptionDialog.tsx` (modale, `NavArrow`, autosave, undo/redo local,
`ShortcutsPanel`, `ConfirmOverlay`) · `src/content/BlockEditor.tsx` (blocs, gutter, menu de type,
footer par bloc, drag&drop, « + Ajouter un bloc ») · `src/content/MathFieldEditor.tsx` ·
`src/content/MathPalette.tsx` · `src/content/descriptionHistory.ts` · `src/types/cardBlock.ts` ·
`src/types/card.ts` (hiérarchie `parentId`/`level`/`order`, `canReceiveChildren`) ·
`src/content/DescriptionDialog.test.tsx` · `src/content/BlockEditor.test.tsx`.

## Limites de l'entrée (à savoir avant de lire les verdicts)

- **#7 et #17 : aucun texte reçu** (idées vides dans la liste transmise) → verdict fondé sur le
  titre seul, à reprendre si le texte existe.
- **#5 (« right/left. »), #6 (« WYSIWYG »), #16 (fin de phrase coupée), #18 (fin de phrase coupée)** :
  texte partiel. Je juge ce qui est lisible et je signale l'incertitude dans l'item.

## Verdict global

La modale est déjà le produit d'instincts corrects et coûteux à obtenir : les outils sont **sur** la
cible (« nothing acts on a block other than the one it is drawn on », `BlockEditor.tsx:273-284`),
l'autosave n'a que des sorties délibérées, l'undo est propre à la description, le dernier bloc est
indestructible, une description vide n'est pas atteignable. Sur les 18 idées, **4 sont des bugs
réels et bien vus** (#11, #12, #14, et le fond de #18) : ce sont les seules à traiter en priorité.
Le reste se partage entre du polish légitime (#1 hover, #2 animation, #13 boutons, #15 placement)
et **trois régressions structurantes** (#3, #4, #5) plus **une fausse bonne idée lourde** (#9/#10).
Deux idées (#5, #13) supposent l'invention d'une « toolbar du haut » qui n'existe pas aujourd'hui :
cette décision doit être prise **une fois**, explicitement, et non par accumulation.

---

## Item par item

### #1 — Icône seule + tooltip aux couleurs de la carte cible + hover animé — ⚠️

L'icône seule **régression** : ce sont les mots « Précédent / Parent / Sous-partie » qui
désambiguïsent quatre flèches collées aux bords, et la géométrie a été choisie exprès pour ne pas
avoir à les décoder (`NAV_POSITION`, `NAV_RELATION`). Tooltip aux couleurs de la cible : ✅ bonne
idée (la couleur = « quelle carte » partout ailleurs) — mais un tooltip **hover only** est
inaccessible au clavier et au tactile : il doit aussi s'ouvrir au focus. Hover animé : ✅ à faire,
les pilules n'ont aujourd'hui **aucun** état hover ni transition, alors que les touches de la
palette en ont (`MathPalette.tsx:333`) — incohérence à corriger.

### #2 — Animer les déplacements de blocs — 🏗️

Bon objectif, vrai coût caché : les blocs sont montés avec `key={index}` (`BlockEditor.tsx:511`) et
`CardBlock` **n'a pas d'identifiant**. Animer correctement exige une identité stable ; sans elle on
anime le mauvais élément (React réutilise la position, pas le contenu). Ajouter un `id` au format
persisté serait un changement de fichier pour un effet visuel : la bonne voie est une **clé locale
non persistée** dans l'état de l'éditeur. Durée 150–250 ms, ease-out, et respect de
`prefers-reduced-motion`.

### #3 — `Entrée` = ligne, `Ctrl+Entrée` = bloc, `Tab` = changer le type — ❌

L'inversion perd ; `Tab` est à rejeter. Ma version complète en « Recommandations ». Le point dur :
le panneau documente « Entrée = Nouveau bloc » et **un test l'encode**
(`DescriptionDialog.test.tsx:286-287`) ; ce n'est donc pas une convention à inverser, c'est un
contrat à réparer là où il est déjà faux (champ titre, cellules de tableau).

### #4 — Le nouveau bloc hérite du type du bloc au-dessus — ❌

Le coût est **asymétrique** : un bloc texte mal deviné se répare en 2 frappes (`$$`,
`BlockEditor.tsx:990`) ; un bloc formule mal deviné avale la prose en LaTeX et coûte ~4 gestes plus
la re-saisie. Et l'héritage est **indéfini** au-dessus d'une image (aucun champ texte, aucun
handler `Entrée`, `ImageBlockField:1130`) ou d'un tableau (`Entrée` dans une cellule ajoute une
**ligne**, `TableCellField:1400`) : les exceptions mangent la règle.

### #5 — Symboles en toolbar du haut, switch animé selon le focus — ❌

Régression du modèle que l'éditeur revendique en tête de fichier : le panneau latéral a été
**supprimé** pour ça. Trois coûts : (1) « sur quel bloc j'agis ? » redevient un **état invisible**,
(2) le trajet œil→main passe de 0 à plusieurs centaines de pixels à chaque symbole dans une modale
de 94 vh, (3) les touches changent de place d'un bloc à l'autre → plus de mémoire spatiale, qui est
la seule chose qui rend une palette rapide. Cas « je clique sans focus » traité en
« Recommandations ».

### #6 — WYSIWYG (texte reçu : un seul mot) — ⚠️

Idée non exploitable telle quelle. La lecture plausible (« taper et voir le rendu dans le même
champ ») est **déjà** la direction du code : MathLive rend le champ identique au résultat, et
l'aperçu séparé sous la formule a été supprimé. Le seul écart réel est celui décrit en **#11**.

### #7 — Focus automatique après changement de type au clic — ✅

Cohérent, peu coûteux, testable, et symétrique du `pendingFocusSelector` déjà utilisé pour les
insertions (`BlockEditor.tsx:369-375`). Une réserve : ne pas voler le focus si l'utilisateur a
cliqué le menu **au clavier** puis veut enchaîner — le focus doit aller au premier champ du bloc
qui vient d'être converti, jamais au-delà.

### #8 — Bouton « Question » qui ajoute un en-tête bleu clair où taper la question — ⚠️

Acceptable **si et seulement si** ce n'est pas un nouveau type persisté et pas un conteneur (voir
#9/#10). Le risque : une couleur qui signifie « question » dans l'app mais rien dans le PDF, XMind,
le quiz et le miroir texte — une décoration qui ne survit pas à la sortie. Si le besoin est
typographique, il se règle avec le balisage existant ; si la question doit être adressable, elle
doit être une **carte**.

### #9 — Une question est un bloc parent contenant plusieurs blocs — ❌

Fausse bonne idée. Un conteneur imbriqué crée une **seconde hiérarchie** que rien d'autre ne voit :
un bloc n'a ni `id`, ni `level`, ni `parentId`, il ne peut pas être cible d'une flèche
(`onNavigate(cardId)` ne prend que des identifiants de cartes), ni entrer dans le quiz, le
breadcrumb, la palette de niveaux ou l'export. Le modèle de l'app dit déjà « une carte question
avec des enfants » — et cette version-là marche partout. Ma version en « Recommandations ».

### #10 — « Une description peut contenir soit des blocs, soit des blocs parents, et les organiser » — ❌

Même refus que #9, plus le mot « organiser » : réordonner **à travers** les niveaux d'imbrication
transforme l'éditeur en éditeur d'arbre (profondeur, indentation, repli, drag inter-niveaux) dans
une modale, et les index qui portent tout l'éditeur (`moveBlock(from,to)`, `data-row-index`,
`textFieldAt`, `activeIndex`) cessent d'être un espace valide. Contradiction directe avec
`canReceiveChildren` (`card.ts:123`).

### #11 — Bug : on voit deux champs de formule (texte + visuel) — ❌ bug réel, cause identifiée

Ce ne sont pas deux champs dupliqués : c'est la **branche de repli** de `MathFieldEditor`, qui
affiche côte à côte le `<textarea>` LaTeX **et** l'aperçu. Elle est choisie **une fois au montage**
via `useState(() => loaded)` (`MathFieldEditor.tsx:103`) : le premier bloc formule de la session
monte avant que MathLive (~5,7 Mo) soit chargé, et ne se met **jamais** à niveau. D'où le second
symptôme observé : passer à texte puis revenir à formule **remonte** le composant, `loaded` vaut
alors `true`, et le WYSIWYG apparaît. Correctif en annexe.

### #12 — Bug : le champ formule d'une cellule ne prend pas la largeur de la cellule — ❌ bug réel

La branche texte utilise `FIELD_STYLE` (`width: 100%`, `BlockEditor.tsx:949`) ; la branche
WYSIWYG rend un `<div ref={hostRef} data-testid="math-field" />` **sans aucun style**
(`MathFieldEditor.tsx:189`). Dans la rangée flexible de la cellule (`display:flex`, `min-width:0`),
ce div est un élément flex à base `auto` et `flex-grow: 0` : il se dimensionne sur son contenu au
lieu de remplir la cellule. Correctif en annexe.

### #13 — Boutons undo/redo en icônes dans la toolbar du haut — ⚠️

Le besoin est réel (aujourd'hui l'undo n'existe **que** au clavier, aucun bouton nulle part), mais
deux obstacles : `descriptionHistory` n'expose **aucun** `canUndo`/`canRedo` — l'état `disabled`
demande une nouvelle API ; et surtout `undo()` de la modale **checkpointe la frappe en cours comme
une seule étape** (`DescriptionDialog.tsx:194-203`) : un bouton visible invite à un undo « lettre à
lettre » qu'il ne fera pas. Un bouton qui ment est pire qu'une absence de bouton. « Toolbar du
haut » : elle n'existe pas encore (l'en-tête porte fil d'Ariane + titre + croix).

### #14 — En tableau, le menu de droite dit « Image » au lieu de « Tableau » ; y déplacer +ligne/+colonne — ✅ puis ⚠️

**Bug confirmé, une ligne de code :** `const current = kind === 'math' ? 'Formule' :
kind === 'text' ? 'Texte' : 'Image'` (`BlockEditor.tsx:799`) — tout ce qui n'est ni maths ni texte
tombe sur « Image ». Un tableau annonce donc « Image » (l'icône, elle, est correcte), et son libellé
accessible aussi. Aucun test ne couvre ce cas (les tests n'exercent que texte/formule). Déplacer
« + ligne / + colonne » dans la barre de droite : ⚠️ on gagne de la place mais on **perd le footer
contextuel**, seule surface qui explique les `+` entre cellules et le « Aa / ∑ » par cellule.

### #15 — Bien placer les `+` de lignes/colonnes + drag/drop lignes/colonnes avec aperçu — ⚠️

À moitié déjà fait : les `+` existent à **chaque** frontière, y compris après la dernière ligne et
dernière colonne, et ils insèrent « après la ligne/colonne i » (`addTableRow/Column(block, i)`).
Ce qui manque vraiment, c'est le **avant le premier** (le coin haut-gauche et la gouttière du haut
sont des `<div />` vides) et le fait que le `+` est dessiné **au-dessus de** la colonne au lieu
d'être **sur la frontière**. Le drag de lignes/colonnes avec aperçu live : chantier réel — les
cellules sont des champs de saisie, un drag qui démarre sur du texte sélectionné est un conflit de
cible direct, et le drag de blocs existant (poignée dédiée, `BlockGutter`) doit rester
distinguable.

### #16 — Ajouter « image » au choix formule/texte (barre du bloc, et fin de phrase coupée) — ❌

Une image ne peut pas accueillir le texte du bloc : `convertBlock` **refuse** déjà de convertir une
image pour ne pas perdre la référence de fichier (`BlockEditor.tsx:75`), et le déclencheur est
désactivé sur une image — l'entrée de menu serait donc une **porte à sens unique**, contre la règle
« changer de mode ne détruit jamais de contenu ». Sur une cellule de tableau, c'est encore plus
lourd : `TableCell = string | { latex }` ne peut pas porter d'asset (format, PDF, quiz). Si le
problème est la découvrabilité de l'insertion d'image, la réponse est le placement de l'action
existante, pas la sémantique de conversion.

### #17 — Tooltips partout plutôt que `title` — ✅ (idée vide, jugement sur le titre)

Objectif légitime — `title` a un délai d'apparition long, ne s'ouvre pas au focus, et son rendu
n'est pas thémable. Mais « partout » est un chantier : il faut un composant unique (Radix en a un),
un déclencheur au **focus** autant qu'au survol, et un `aria-label` conservé sur chaque contrôle
(un tooltip ne remplace pas un nom accessible). À faire par lots, en commençant par la modale.

### #18 — Flèche absente → bouton `+` pour créer le frère/enfant manquant, focus sur le titre — ⚠️

Le besoin est réel (rien, aujourd'hui, n'explique ni ne comble une flèche absente), la solution est
dangereuse : **même emplacement, deux métiers** (naviguer / créer), donc une action imprévisible ;
après création l'affordance **disparaît** (le `+` redevient une flèche) ; et la création n'a
**aucun undo local** — l'undo de la modale est celui de la description, pas du document
(`descriptionHistory.ts:4-21`) : une carte vide créée par erreur reste dans la carte mentale. Le
focus sur le titre n'agit que si l'hôte passe `onRenameTitle` ; sinon le champ est `readOnly`
(`DescriptionDialog.tsx:352`) et l'utilisateur tape dans le vide — exactement le bug que la modale
a été construite pour corriger.

---

## Les 3 conflits de modèle mental les plus graves

1. **#3 contre le contrat déjà écrit et déjà testé.** Le panneau affirme « Entrée = Nouveau bloc »
   et un test l'encode. Or c'est **déjà** faux dans deux surfaces sur quatre : dans le titre,
   `Entrée` valide le renommage (`:355-361`) ; dans une cellule, `Entrée` ajoute une ligne
   (`:1400`). #3 ajoute un troisième monde au lieu de réparer les deux qui mentent.
2. **#5 contre la règle fondatrice de l'éditeur.** « Everything the user needs is on the block they
   are working on » est la raison pour laquelle un panneau de 280 px a été supprimé
   (`BlockEditor.tsx:277-284`). Remonter les outils défait ce choix et remplace la proximité absolue
   (0 px) par une course de plusieurs centaines de pixels par symbole.
3. **#8/#9/#10 contre « une carte est un nœud ».** `canReceiveChildren` interdit les enfants aux
   cartes de niveau 4 et aux cartes volantes (`card.ts:123`). Un conteneur de blocs aurait des
   règles parallèles et contradictoires, et une hiérarchie que ni les flèches, ni le quiz, ni
   l'export ne peuvent lire.

**Conflit secondaire (#18)** : une même position qui tantôt navigue tantôt crée, avec une mutation
de document sans undo local.

## Parcours à risque

Marie, 4e, écrit la définition de Pythagore dans la modale (le caret est dans le bloc 1).

1. Sous **#3**, elle veut ajouter une formule : le panneau dit `Ctrl+Entrée`, ses doigts vont sur
   `Entrée` → elle obtient un **saut de ligne dans le même bloc**. Elle appuie sur `Tab` « pour
   passer au champ suivant » → le type du bloc change et sa prose part en LaTeX. Récupération :
   `Ctrl+Z` — par chance, parce que l'undo local checkpointe la frappe en cours.
2. Sous **#5**, elle a cliqué le titre entre-temps : elle clique un symbole en haut, et l'insertion
   part **à la fin du dernier bloc actif**, pas là où elle regardait ; ou les touches sont
   désactivées (`field === null`, `MathPalette.tsx:276`) et le clic ne fait rien. Dans les deux cas,
   rien à l'écran ne dit sur quel bloc la barre agit.
3. Sous **#18**, elle cherche la flèche « suivant » absente, tombe sur le `+` qui occupe le même
   emplacement : une carte sœur vide apparaît dans la carte mentale. Le focus va sur son titre, qui
   est `readOnly` si l'hôte n'a pas passé `onRenameTitle` : elle tape, rien ne se passe. Elle ferme,
   la carte vide reste, et `Ctrl+Z` **ne la retire pas**.

**Coût en gestes (définition de 3 blocs, 4 symboles) :** aujourd'hui ~2 `Entrée` + 1 clic par
symbole sans trajet, tout au clavier possible ; sous #3, +1 modificateur par bloc ; sous #5,
4 trajets de plusieurs centaines de pixels ; sous #4, −2 frappes au mieux et +4 gestes de
réparation au pire.

## Recommandations qui remplacent celles du demandeur

**#3 — ma version.** Gardez `Entrée` = nouveau bloc, `Maj+Entrée` = retour à la ligne. La raison est
structurelle : « the block list IS the line breaks » (`cardBlock.ts:29-33`). Ajouter `Ctrl+Entrée`
**en plus** ne coûte rien ; en faire le seul chemin ajoute un modificateur au geste le plus fréquent.
**`Tab` : ne pas y toucher.** Consommer `Tab` — le seul moyen d'avancer le focus — pour **muter le
document** rend inatteignables au clavier le gutter, le bouton de type, la palette et les cellules,
et constitue un piège clavier au sens **WCAG 2.1.2** (avec 2.4.3 sur l'ordre de focus). Alternative :
gardez le bouton de type comme seule vérité visible, et offrez une **palette `/` sur un bloc vide**
(n'agit que si le bloc est vide, donc ne peut jamais manger de prose). Corollaire obligatoire :
**rendre le `ShortcutsPanel` contextuel** (Entrée sur le titre = valider ; dans une cellule = ligne ;
ailleurs = nouveau bloc) — sinon le panneau continue de mentir deux fois sur quatre. Et bordez
`endsWith('$$')` (`:990`) qui convertit **toute la phrase** si elle finit par `$$` : à limiter au
bloc vide ou à `$$` seule sur sa ligne.

**#5 — ma version.** Gardez le footer sur le bloc. Si le problème est qu'il sort de l'écran dans une
longue description, la réponse est le **scroll** (amener le bloc actif entièrement en vue), pas une
seconde copie des outils : deux palettes identiques posent la question « laquelle j'utilise ? ».
Si la barre haute est retenue malgré tout, alors (a) elle doit **nommer sa cible** (« Bloc 2 —
Formule »), (b) **surligner ce bloc**, (c) ne jamais exécuter d'insertion si aucun bloc n'est actif —
un état désactivé explicite vaut mieux qu'une insertion au mauvais endroit.

**#9 — ma version.** Pas d'enveloppe. Par ordre de préférence : (1) « Question 2 » en première ligne
d'un bloc texte — zéro modèle nouveau, exporté partout ; (2) si une question doit être adressable
(quiz, description propre, enfants), une **vraie carte enfant** créée par une commande explicite
« Nouvelle carte question », titre pré-rempli `Question N`, qui ouvre la modale sur elle — elle
participe aux niveaux, à la palette, aux flèches, au quiz et à l'export ; (3) un bloc « section »
non conteneur, **seulement** quand quiz et export sauront le lire.

**#11 — correctif.** Deux options, dans l'ordre : (a) **précharger** MathLive à l'ouverture de la
modale quand le brouillon contient déjà un bloc formule (et au moment de la conversion `$$`), pour
que le premier bloc formule monte avec `loaded === true` ; (b) à défaut, ne pas laisser la branche de
repli ressembler à deux champs concurrents : un seul champ LaTeX, l'aperçu **dans** le même cadre,
et une mention explicite du mode temporaire.

**#12 — correctif.** Donner au conteneur du champ WYSIWYG la largeur qu'il doit occuper :
`style={{ flex: 1, minWidth: 0, width: '100%' }}` sur le `<div ref={hostRef} data-testid="math-field">`
de `MathFieldEditor`, pour que la cellule formule se dimensionne exactement comme la cellule texte.

**#14 — correctif.** Nommer le type depuis le type réel (`kind === 'table' ? 'Tableau' : …`) au lieu
d'un `else` qui signifie « Image », et ajouter le test manquant (le libellé et l'`aria-label` d'un
bloc tableau).

**#15 — correctif minimal.** Ajouter le `+` manquant **avant la première** ligne et **avant la
première** colonne, et dessiner les `+` **sur** la frontière (entre i et i+1) plutôt qu'au-dessus de
la colonne i ; garder le footer « Tableau » qui explique la règle.

**#18 — ma version.** Une position = un sens : les flèches restent des flèches. « Créer une carte
sœur après celle-ci » va dans le menu contextuel de la carte, là où la création vit déjà, avec
l'undo **du document** derrière. Et pour le vrai manque (pas de flèche enfant sur une carte de
niveau 4), ajoutez une **explication** — « Niveau 4 : pas de sous-partie » — pas un bouton de
création.

## Annexe — cas limites vérifiés

| Cas | État actuel | Verdict |
| --- | --- | --- |
| Dernier bloc supprimé | `removeAt` refuse à 1 (`BlockEditor.tsx:461`) et la corbeille est masquée (`count > 1`) | ✅ cohérent : on ne peut pas atteindre zéro bloc |
| Bloc vide | validé, `normalizeContent` l'écarte à l'enregistrement s'il est resté vide | ✅ |
| Description vide | modale ouverte sur un bloc texte vide (`seedFrom`) ; la suppression de la description passe par l'overlay de confirmation et **ferme** la modale | ✅, mais « vider sans fermer » n'existe pas |
| Carte sans parent / sans enfant | la flèche n'existe simplement pas (`NavArrow` retourne `null`, test `:355-366`) | ✅ pour le rendu, ⚠️ aucune explication du **pourquoi** |
| Tableau 1×1 | `removeTableRow/Column` refusent à 1 ; réduction possible seulement via « Transformer le tableau en texte » | ⚠️ sans explication visible |
| Repli MathLive | ⚠️ voir #11 |
