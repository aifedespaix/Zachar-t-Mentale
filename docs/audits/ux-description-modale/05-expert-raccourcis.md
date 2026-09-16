# 05 — Expert raccourcis clavier : audit de la modale de description

**Persona unique :** le *power user qui vit au clavier* (Vim/Emacs/Notion/Obsidian/VSCode, connaît les conventions macOS/Windows/Linux, déteste la souris).
**Rôle :** auditeur. Aucun fichier du dépôt n'a été modifié à part celui-ci.
**Question tranchée en priorité :** #3 (`Entrée` = ligne, `Ctrl+Entrée` = bloc, `Tab` = type).

> **Deux réserves de méthode, à lire avant tout.**
> 1. La liste des 18 idées m'a été transmise **verbatim** par l'orchestrateur (section 3). Je traite #3 et #13 à fond, et les autres en une ligne. Certains intitulés sont télégraphiques ; là où je ne peux pas auditer, je l'écris au lieu de deviner.
> 2. Ce que j'affirme des conventions externes : Notion, Word/Google Docs, Obsidian, Bloc-notes, Bear, Slack, Excel. Ce que je n'ai **pas** revérifié : Craft (je me fonde sur son statut d'éditeur par blocs) et la déduplication en aval de `requestAction` (`src/hooks/useCanvasCommands.ts:190-194`). Ces deux points sont signalés dans le texte.

---

## 1. Verdict global

**#3 : refus des trois touches, sans exception.**

Cette application possède un **registre de commandes unique** (`src/types/commands.ts`) : ~50 commandes déclarées une fois, avec `id`, `label`, `defaultBinding`, `scope: 'canvas' | 'global'`, `allowInEditable`, `skipWhenTextSelected`, plus des `aliases`. Les raccourcis sont **remappables par l'utilisateur** (`src/state/useShortcutSettingsStore.ts`, UI dans `src/components/settings/ShortcutSettingsPanel.tsx` + `ShortcutRecorder.tsx`), et il existe **déjà un détecteur de collisions** (`conflictsIn`, `useShortcutSettingsStore.ts:44-57`) affiché dans les Paramètres. Un dispatcher unique écoute en **capture sur `window`** (`src/hooks/useGlobalShortcuts.ts:96-121`). Aucune bibliothèque tierce de hotkeys : le système est maison, cohérent, et c'est lui qu'il faut interroger — pas l'intuition.

Or les trois propositions de #3 :
- **inversent** un raccourci que l'app suit déjà *et documente* (`DescriptionDialog.tsx:584-585`), et qui est la convention des éditeurs par blocs ;
- **réutilisent** un accord déjà pris par la commande qui **ouvre cette modale** (`card.editDescription` = `Mod+Enter`) ;
- **confisquent** `Tab`, déjà pris trois fois (dont un usage MathLive documenté et un test d'accessibilité).

Ce n'est pas une amélioration ergonomique, c'est une régression de convention doublée d'un conflit interne détectable automatiquement par le code existant.

---

## 2. #3 : décision argumentée

### 2.1 « Entrée = ajouter une ligne » : inversion de convention

**État actuel, tel que le code le fait** (`src/content/BlockEditor.tsx`) :

| Emplacement | Handler | Comportement |
|---|---|---|
| `AutoGrowTextarea:1056-1060` | `if (event.key !== 'Enter' \|\| event.shiftKey) return` → `preventDefault(); onEnter()` | Entrée = **nouveau bloc**, Maj+Entrée = retour à la ligne (natif `<textarea>`) |
| `MathBlockField` fallback LaTeX `:1108-1112` | identique | idem pour la voie LaTeX brute |
| `MathFieldEditor.tsx:163-167` (le `<math-field>` MathLive) | `if (event.key !== 'Enter' \|\| event.shiftKey) return` → `preventDefault(); onEnterRef.current?.()` | idem pour le champ WYSIWYG. Le commentaire `:28-32` justifie explicitement : « *Plain Enter — never Shift+Enter, which MathLive's own field keeps for moving between rows of a multi-line construct. A formula is one block, so Enter is the same "new block below" gesture every other field offers* » |
| `TableCellField:1438-1457` | `if (event.key !== 'Enter') return` → `onEnter()` | dans un tableau, Entrée = **nouvelle ligne de tableau** (`addTableRow`, `:1400`) |

Ce comportement est **documenté à l'écran**, en français, dans le panneau de raccourcis :

```
DescriptionDialog.tsx:584  <Shortcut keys="Entrée" label="Nouveau bloc" />
DescriptionDialog.tsx:585  <Shortcut keys="Maj + Entrée" label="Retour à la ligne" />
```

Le commentaire du pied de modale assume la doctrine inverse de celle de #3 (`DescriptionDialog.tsx:430-433`) :

> « *the keyboard is still the fastest way to write a definition, and a shortcut nobody can look up is a shortcut nobody uses.* »

**Confrontation aux conventions nommées :**

| Outil | Modèle | Entrée | Maj+Entrée |
|---|---|---|---|
| **Notion** | éditeur **par blocs** | **nouveau bloc** | ligne dans le bloc |
| **Craft** (non revérifié) | éditeur **par blocs** | **nouveau bloc** | ligne |
| **Word / Google Docs / Obsidian / Bloc-notes** | document **en flux** | nouveau paragraphe | saut de ligne souple |
| **Bear** | document en flux, markdown | nouveau paragraphe | saut de ligne |
| **Slack** | messagerie | **envoyer** | ligne |
| **Excel** | grille | cellule suivante (bas) | — (`Alt+Entrée` = ligne dans la cellule) |

La bonne question n'est pas « quelle est la bonne convention ? » mais **« de quel type d'éditeur s'agit-il ? »**. `BlockEditor` est un éditeur **par blocs** typés (`text` / `math` / `table` / `image`, cf. `CardBlockKind` et le sélecteur de type par bloc, `BlockEditor.tsx:800-831`). Sa convention de référence est donc Notion/Craft, c'est-à-dire **exactement ce qu'il fait déjà**.

**Coût pour l'utilisateur existant.** Le geste appris est écrit noir sur blanc dans la modale (`584`), et il est cohérent avec le reste de l'app : `Enter` et `Shift+Enter` sont **déjà des commandes du canvas** — `card.addSiblingBelow` = `Enter`, `card.addSiblingAbove` = `Shift+Enter` (`src/types/commands.ts:239-253`), donc « la touche Entrée fait apparaître la chose suivante » est une idée installée dans tout le produit. Inverser la sémantique **dans un seul écran** produit un utilisateur qui, ailleurs, appuie sur Entrée en croyant créer un bloc et **fusionne** ou **casse** son contenu. Et aucune des deux mécaniques de dépréciation n'existe : le panneau code les libellés en dur, donc rien ne peut signaler le changement.

**Verdict : ❌. Conserver `Entrée` = nouveau bloc, `Maj+Entrée` = ligne.**

### 2.2 « Ctrl+Entrée = créer un bloc » : collision frontale, et question sans réponse pour `Maj+Entrée`

Trois problèmes, par ordre de gravité.

**(a) L'accord est déjà pris, par le raccourci qui ouvre cette fenêtre.**
`src/types/commands.ts:269-275` :

```
id: 'card.editDescription',
label: 'Modifier la description',
defaultBinding: 'Mod+Enter',     // scope absent ⇒ 'global'
```

Enregistré par `src/hooks/useCanvasCommands.ts:190-194` → `requestAction(selected.id, 'description')`. Donner à `Ctrl+Entrée` le sens « créer un bloc » *à l'intérieur* de la fenêtre qu'il vient d'ouvrir, c'est deux sens pour un accord à quelques centimètres d'écart. Un power user lit ça comme un bug, pas comme un raccourci.

**(b) Que devient `Maj+Entrée` ?** La proposition ne le dit pas. Si `Entrée` devient « ligne », alors `Maj+Entrée` n'a plus de sens disponible : il ne peut pas rester « retour à la ligne » (redondant), et il **ne peut pas** devenir « nouveau bloc » sans entrer en collision avec `card.addSiblingAbove` = `Shift+Enter` en scope canvas (`commands.ts:247-253`) — le détecteur `conflictsIn` le signalerait en rouge dans les Paramètres. La proposition #3 laisse un trou sémantique non spécifié.

**(c) Ailleurs.** `Ctrl+Entrée`/`Cmd+Entrée` : Slack = envoyer, Excel = **remplir toute la sélection** avec la valeur saisie, Notion = (pas de sens « nouveau bloc » de mémoire, non revérifié). Aucune de ces conventions ne dit « créer un bloc ». C'est **mémorable mais faux** : mémorable parce que « modifier/valider », pas parce que « créer ».

**Y a-t-il mieux ?** Non, parce que **rien ne manque** : `Entrée` fait déjà exactement le travail demandé, sur un champ vide comme sur un champ rempli (`onEnterBlock` = `insertBlockAfter(index, { kind: 'text', text: '' })`, `BlockEditor.tsx:561`). Ajouter un accord pour la même action, c'est ajouter une collision gratuite. Si l'intention réelle est « **valider et fermer** », `Échap` existe déjà (documenté `DescriptionDialog.tsx:589`, géré par Radix) et `Mod+Entrée` reste le pire candidat possible puisqu'il veut dire « ouvrir ».

**Verdict : ❌ tel quel.**

### 2.3 « Tab = changer le type de bloc » : anti-pattern, et déjà pris trois fois

**Occupation n° 1 — l'app elle-même.** `src/types/commands.ts:230-237` :

```
id: 'card.addChild',
defaultBinding: 'Tab',
scope: 'canvas',
```

`Tab` a un sens **établi et documenté en commentaire** dans `src/components/MindMapCanvas.tsx:471-473` :

> « *A card you just created is the card you are about to act on: selecting it is what makes **"Tab, Tab, Tab" build a branch**, and what lets Suppr undo a mis-click without reaching for the mouse.* »

C'est la convention des outliners de cartes (MindNode, XMind, FreeMind) : `Tab` = enfant, `Entrée` = frère. La même app, quelques centimètres plus haut dans la hiérarchie, apprend déjà `Tab`.

**Occupation n° 2 — le piège de focus de Radix.** La modale est un `DialogPrimitive.Content` (`DescriptionDialog.tsx:240-277`), donc focus **piégé** dans la fenêtre. Depuis le `<textarea>` d'un bloc, `Tab` est le **seul** moyen d'atteindre au clavier : les boutons de la palette de symboles du pied de bloc, le menu de type, le bouton « Raccourcis », « Fermer ». Ce n'est pas théorique, c'est **testé et commenté** :

- `src/content/MathPalette.tsx:292-302` : « *un `mousedown` n'existe pas au clavier […] Sans ceci, les touches sont atteignables au Tab, s'annoncent avec leur libellé, et ne font rien — le pire des trois états.* »
- `src/content/DescriptionDialog.test.tsx:318-332` : « *inserts a symbol from the palette with the keyboard too, not only with a click* » — l'accessibilité clavier de la palette est un **contrat de test**.

Un `preventDefault()` sur `Tab` dans le champ rendrait ces boutons **inatteignables à la souris aussi bien qu'au clavier** (ils ne sont atteignables qu'au focus clavier / clic), c'est-à-dire exactement ce que **WCAG 2.1.2 « No Keyboard Trap »** interdit : aucune touche ne permet plus de sortir du champ.

**Occupation n° 3 — MathLive.** Le placeholder `#?` est documenté dans le dépôt comme **le taquet de tabulation suivant** :

- `src/content/MathFieldEditor.tsx:12-17` : « *`#0` for the selection, `#?` for the next tab stop* »
- `src/content/MathPalette.tsx:7-8` : « *(`#0` = where the selection lands, `#?` = the next tab stop)* », utilisé par `\frac{#0}{#?}` (`:41`), `#0^{#?}` (`:42`), `#0_{#?}` (`:43`), `\sqrt[#?]{#0}` (`:45`).

Donc **Tab navigue déjà, à l'intérieur d'un `<math-field>`, entre les cases d'une fraction ou d'une puissance venue de la palette**. Intercepter `Tab` au niveau du bloc casserait ce flux (juste après avoir cliqué « Fraction », l'élève veut aller au dénominateur). *Réserve : je déduis ce comportement du vocabulaire « tab stop » employé par le dépôt et des fragments `#?` ; je n'ai pas exécuté MathLive pour le constater.*

**Verdict : ❌. `Tab` est le pire candidat possible.**

### 2.4 Tableau de décision

| Touche proposée | Convention respectée ? | Collisions | Verdict | Alternative recommandée |
|---|---|---|---|---|
| `Entrée` → ajouter une ligne | ❌ inverse Notion/Craft **et** l'app elle-même (`DescriptionDialog.tsx:584`, `BlockEditor.tsx:1057`) | `card.addSiblingBelow` = `Enter` (canvas, `commands.ts:243`) ; contrat du panneau + test `DescriptionDialog.test.tsx:286` | ❌ | ne rien changer : `Entrée` = nouveau bloc |
| `Ctrl/Cmd+Entrée` → créer un bloc | ⚠️ existe ailleurs (Slack = envoyer, Excel = remplir la sélection) mais **jamais** « créer un bloc » | `card.editDescription` = `Mod+Enter` (`commands.ts:274`), c'est-à-dire le raccourci qui **ouvre** la modale | ❌ tel quel | aucune : `Entrée` suffit ; pour « valider/fermer », `Échap` existe |
| `Tab` → changer le type (formule ↔ texte) | ❌ `Tab` = navigation/focus sur toutes les plateformes | `card.addChild` = `Tab` (`commands.ts:235`) ; focus trap Radix ; taquets MathLive `#?` ; contrat de test `DescriptionDialog.test.tsx:318-332` | ❌ | `Ctrl+Maj+M` (défaut) ou `Alt+1`/`Alt+2` ; garder le menu de type par bloc |

### 2.5 Alternatives pour « changer le type de bloc » (2-3, justifiées, collisions vérifiées)

**1) `Ctrl+Maj+M` — recommandée.** Déclarable dans `COMMANDS` (elle doit l'être : c'est ce qui lui donne gratuitement le panneau Paramètres → Raccourcis, le remap, la palette de commandes et la détection de collisions). `Mod+Shift+M` est **libre** : les `Mod+Shift+*` déjà pris sont `N, R, S, E, C, D, T, B, Q, W, Z` (`commands.ts`, passe en revue) ; `Mod+Y` est un *alias* de redo (`:171`). Aucun conflit OS connu (⌘M = réduire la fenêtre, ⌘⇧M libre). Mnémonique acceptable pour la cible « formule » (Math/Mode). Mémorisable, et *non destructif* s'il tombe à côté.

**2) `Alt+1` / `Alt+2` — texte / formule.** Convention « sélecteur de type numéroté » (VS Code : `Alt+1..9` sélectionne un groupe d'éditeurs). **Point technique qui la rend sûre** : `src/shortcuts/keys.ts:79-80` lit les chiffres depuis `event.code` et **ignore le Shift implicite**, précisément parce que « *Digits need Shift on AZERTY* » — le geste est donc identique AZERTY/QWERTY. `AltGr` (Ctrl+Alt sur AZERTY) ne collisionne pas : `bindingFromEvent` exige le seul `Alt` (`:105-106`). Troisième type éventuel (`Alt+3` = image) si #16 passe.

**3) `Ctrl+/` — ou la *slash command* `/` en début de ligne vide.** `Ctrl+Slash` est libre (`PUNCTUATION_NAMES` mappe `/` et `?` sur `Slash`, `keys.ts:44-45`) ; la convention « `/` ouvre un sélecteur de type de bloc » est celle de Notion, et la palette de commandes existe déjà (`app.palette` = `Mod+K`, `commands.ts:442-449`).

**À éviter explicitement :** `Ctrl+E` — sur macOS, `⌃E` est le « fin de ligne » du système de texte Cocoa (héritage Emacs) dans tout champ de saisie, et `file.export` occupe déjà `Mod+E` (`commands.ts:128-134`).

**Et la voie sans raccourci :** le menu de type par bloc existe déjà et est correctement étiqueté (`BlockEditor.tsx:800-831` : `aria-label={\`Type du bloc ${index+1} : ${current}\`}`, `title` explicatif, `DropdownMenu` Radix → navigable aux flèches + `Entrée`). La vraie amélioration de #3 n'est pas une touche, c'est **de ne pas casser ça**.

---

## 3. Item par item (les 18)

Légende : ✅ à garder tel quel · ⚠️ à ajuster · ❌ à refuser · 🏗️ à construire · ❓ intitulé trop télégraphique pour trancher.

1. **Icône seule + tooltip au hover (couleurs de la card cible) + animation** — ⚠️. La règle du dépôt est déjà « tooltips plutôt que `title` » côté app (TODO #17) ; un tooltip doit rester **lisible au clavier** (`:focus-visible`), pas seulement au survol : les boutons `NavArrow` de la modale sont déjà focalisables (`DescriptionDialog.tsx:540-563`).
2. **Animer le déplacement des blocs** — 🏗️. Rien dans le code actuel n'anime la réinsertion (`insertBlockAfter`, `BlockEditor.tsx:378-382`). Exiger `prefers-reduced-motion` (le dépôt utilise déjà des `transition` courtes, ex. `MathPalette.tsx:333`).
3. **Raccourcis Entrée/Ctrl+Entrée/Tab** — ❌. Voir section 2 : inversion de convention, collision avec `Mod+Enter`, et `Tab` déjà pris trois fois.
4. **L'ajout de bloc garde le même type que le bloc du dessus** — ✅ avec réserve. C'est un bon défaut (une suite de formules reste des formules), `insertBlockAfter(index, { kind: 'text', … })` (`BlockEditor.tsx:561`) étant aujourd'hui **en dur sur `text`**. Attention à la table : `TableRow` traite déjà `Entrée` comme « nouvelle ligne », pas « nouveau bloc » (`:1394-1400`).
5. **Palette de symboles déplacée en toolbar, switch animé selon le bloc focus** — ⚠️. Choix de conception contraire à la doctrine écrite du `BlockFooter` (`BlockEditor.tsx:834-841` : « *attached to the block rather than parked in a column […] Nothing on screen acts on a block the user is not looking at* »). Aucun enjeu clavier, mais c'est un revirement assumé à documenter.
6/7. **WYSIWYG : `Entrée` = aller à la ligne / passage formule↔texte par clic avec focus auto** — ❌ pour le `Entrée` (redondant avec #3 et contraire au champ MathLive, `MathFieldEditor.tsx:28-32`) ; ✅ pour le focus auto après conversion (le champ est déjà focalisé par `setActiveIndex` + `focusBlockLater`, `BlockEditor.tsx:378-382` — à vérifier au clic).
8-10. **Blocs « Question » / parents / enfants** — 🏗️. Deux notes clavier : un « bloc parent » implique un niveau d'imbrication, donc un futur `Tab`/`Maj+Tab` d'indentation — **qui entrerait en collision frontale avec `card.addChild` = `Tab`** ; à trancher avant d'implémenter quoi que ce soit de #3.
11. **Bug : deux champs visibles au chargement sur un bloc formule** — ⚠️ hors de mon domaine, mais cohérent avec le fallback : `MathBlockField` rend le `<textarea>` LaTeX **tant que** MathLive n'est pas chargé (`MathFieldEditor.tsx:188`, `showMathField`), donc un état transitoire à deux champs est plausible.
12. **Bug : une case « formule » ne prend pas la largeur de la case** — ⚠️ hors domaine (mise en page `TableCellField`, `BlockEditor.tsx:1424-1460`).
13. **Undo/redo en icônes (couleur/disabled) dans la toolbar** — 🏗️ avec une contrainte dure. Voir section 6.
14. **Bug : la liste des actions affiche « image » au lieu de « tableau »** — ⚠️ hors domaine ; le libellé de type est calculé à `BlockEditor.tsx:875` / `813` — un `kind` mal dérivé expliquerait les deux.
15. **Tableau : « + » entre colonnes/lignes + drag/drop avec aperçu** — ✅ utile, mais le clavier est oublié : `TableFooter` n'offre aujourd'hui que deux boutons (`:911-924`), et le drag/drop sans équivalent clavier est un recul d'accessibilité (prévoir `Alt+↑/↓` pour déplacer une ligne).
16. **Sélecteur formule/texte : ajouter « image »** — ⚠️. `convertBlock` **refuse** déjà explicitement de convertir une image (`BlockEditor.test.tsx:55` : « *refuses to convert an image away, rather than destroying the asset reference* ») ; l'ajouter au sélecteur de **case de tableau** suppose un type de cellule image qui n'existe pas (`TableCell = string | { latex }`, `BlockEditor.tsx:37-39`).
17. **Tooltips plutôt que `title` partout** — ✅, et c'est la condition d'à-propos de #13 : un raccourci doit être **lisible** quelque part (`formatBinding`, `keys.ts:198`).
18. **Bouton suivant/précédent ; sinon « + » qui crée le frère manquant, focus auto sur le titre** — ✅. Les `NavArrow` haut/bas/gauche/droite existent déjà (`DescriptionDialog.tsx:278-281`, `540-563`) et ils reçoivent `prevSibling`/`nextSibling`/`parentTarget`/`childTarget` : la partie « frère manquant » est le complément logique, et le focus auto sur le titre est le comportement attendu après création.

---

## 4. Table de raccourcis que je recommande

| Touche | Action | Justification | Conflit éventuel |
|---|---|---|---|
| `Entrée` | Nouveau bloc (inchangé) | Convention Notion/Craft ; déjà documentée (`DescriptionDialog.tsx:584`) et testée | `card.addSiblingBelow` en canvas — contextes disjoints |
| `Maj+Entrée` | Retour à la ligne (inchangé) | Natif du `<textarea>`, repris à l'identique par le fallback LaTeX | `card.addSiblingAbove` en canvas |
| `Ctrl/Cmd+Maj+M` | Changer le type du bloc (texte ↔ formule) | Libre, mnémonique, remappable si déclarée dans `COMMANDS` | Aucune (`Mod+Shift+M` libre) |
| `Alt+1` / `Alt+2` | Bloc texte / bloc formule | Chiffres lus via `event.code` → identique AZERTY/QWERTY (`keys.ts:79-80`) | `AltGr+chiffre` sur claviers DE/PL reste un binding distinct (`Ctrl+Alt+…`) |
| `Alt+↑` / `Alt+↓` | Déplacer le bloc vers le haut/bas | Aligne l'éditeur sur `card.moveUp`/`card.moveDown` (`commands.ts:284-298`) | Aucun dans un `<textarea>` |
| `Retour arr.` sur bloc vide | Supprimer le bloc, focus au précédent | Convention absolue de tout outliner | Aucun — **non implémenté aujourd'hui** |
| `Ctrl/Cmd+Z` · `Ctrl/Cmd+Maj+Z` | Annuler / rétablir la description | Déjà en place (`DescriptionDialog.tsx:213-222`) | **Piège n° 1** : ne pas confondre avec `edit.undo` global |
| `Échap` | Fermer la modale | Déjà géré par Radix et documenté (`:589`) | Le champ titre réinitialise le brouillon **sans** `preventDefault` (`:355-361`) : les deux actions partent |
| `F1` | Panneau des raccourcis de l'app | Convention existante (`app.shortcuts`, `commands.ts:457-464`) | Aucun |

**Raccourcis qui manquent à un power user, et qui manquent réellement dans le code :**
1. **`Alt+↑/↓` = déplacer le bloc** : le réordonnancement existe par glisser (`DescriptionDialog.test.tsx:226`), mais aucun handler `Alt+Arrow` n'existe dans `src/content` → l'action est **souris-seulement**.
2. **`Backspace` sur bloc vide = supprimer + focus au précédent** : aucun handler `Backspace` dans `src/content`.
3. **Bloc au-dessus** (`Maj+Entrée` en canvas ne peut pas être réutilisé : pris par le retour à la ligne). Candidat : `Alt+Entrée` — à valider (Word/Excel utilisent `Alt+Entrée` pour « ligne dans la cellule », pas pour « insérer au-dessus »).
4. **Sélection multiple de blocs au clavier** : n'existe nulle part. C'est une fonctionnalité, pas un raccourci — à sortir de cette passe.
5. **Panneau `ShortcutsPanel` non exhaustif** : il liste 6 raccourcis alors que `Échap`, `F1` et les flèches de navigation entre cartes (`NavArrow`) ne sont pas décrits.

---

## 5. #13 — undo/redo en icônes : ce qui manque réellement

**Ce qui existe déjà, et qu'il ne faut pas confondre.** `src/components/toolbar/AppToolbar.tsx:366-367` rend :

```tsx
<CommandButton command="edit.undo" icon={Undo2} />
<CommandButton command="edit.redo" icon={Redo2} />
```

avec `canUndo` / `canRedo` **réactifs** côté canvas : `useCanvasCommands.ts:60-61` lit `useCardsStore(s => s.history.past.length > 0)` / `future.length > 0`. Mais cette paire pilote l'**historique global du document** (`src/state/history.ts`, un pas par autosave, intercalé avec toutes les autres modifications de la carte), **pas** l'historique de la description (`src/content/descriptionHistory.ts`, une pile par carte, `MAX_DEPTH = 100`, en mémoire de module, qui **ne survit pas à un rechargement** — commentaire `:15-21`).

**Donc ce qui manque pour #13 n'est pas « des icônes » : c'est une API de lecture de l'historique local.** `descriptionHistory.ts:60-73` n'expose que :

```ts
export function undoDescription(cardId: string): CardBlock[] | null   // MUTE index
export function redoDescription(cardId: string): CardBlock[] | null   // MUTE index
```

Deux conséquences concrètes :
1. **Aucun moyen de savoir si l'on peut annuler sans annuler.** Appeler `undoDescription` pour tester = détruire un cran d'historique et renvoyer l'état précédent. Il manque `canUndoDescription(cardId)` / `canRedoDescription(cardId)` en **lecture seule** (`entry.index > 0` / `index < stack.length - 1`), à côté des mutateurs.
2. **Rien n'est réactif.** `entries` est un `Map` au scope module (`:30`), pas un store : un `useState` dans la modale ne se re-rendrait pas quand `recordDescriptionState` empile un état → les icônes resteraient grises alors que l'undo est disponible. Recommandation : exposer un hook `useDescriptionHistory(cardId)` bâti sur `useSyncExternalStore` (React 19 est dans `package.json`) avec un `subscribe`/`getSnapshot` et un `notify()` appelé depuis `recordDescriptionState`/`undoDescription`/`redoDescription`.

**Branchement recommandé :**
- Deux boutons *ghost* dans le **pied de la modale** (à côté de « Supprimer »), **pas** dans `AppToolbar` : la couleur/`disabled` suit la même règle visuelle que les `CommandButton` (`opacity` + `cursor: default`, comme `BlockEditor.tsx:811`), `disabled={!canUndo}`.
- Câbler sur `undo()` / `redo()` **locaux** (`DescriptionDialog.tsx:194-208`). **Ne jamais** utiliser `<CommandButton command="edit.undo">` : il déclencherait l'undo du document depuis la description.
- Infobulle avec le raccourci **affiché** : oui, sans hésitation. Le dépôt a déjà l'outillage (`ShortcutHint` de `src/components/commands/ShortcutHint.tsx`, `formatBinding` de `src/shortcuts/keys.ts:198`) et la doctrine (« *a shortcut nobody can look up is a shortcut nobody uses* », `DescriptionDialog.tsx:430-433`). Les libellés français corrects viennent déjà de `KEY_LABELS` (`keys.ts:167-195`) : `Enter` → « Entrée », `Tab` → « Tab », `Delete` → « Suppr ». `formatBinding('Mod+Shift+Z')` rend « Ctrl + Maj + Z » (Windows/Linux) ou « ⌘⇧Z » (macOS) — exactement ce que le panneau écrit aujourd'hui à la main.
- **Cohérence des raccourcis associés : oui, cohérents.** `edit.undo` = `Mod+Z`, `edit.redo` = `Mod+Shift+Z` **avec alias `Mod+Y`** (`commands.ts:158-172`), et le handler local de la modale fait exactement la même chose (`:215-218`). Rien à changer au mapping.
- **Si l'on veut rendre ces deux actions remappables** : les déclarer dans `COMMANDS` avec `defaultBinding: null` (sinon `conflictsIn` les signalerait en collision avec `edit.undo`/`edit.redo`, cf. `useShortcutSettingsStore.ts:44-57`), et faire lire le binding effectif par le listener de la modale via `useShortcutSettingsStore.getState().lookup` au lieu du `'z'` codé en dur (`DescriptionDialog.tsx:215`).

---

## 6. Les 3 collisions / pièges que le demandeur n'a pas vus

### Piège 1 — `Ctrl+Z` dans cette modale dépend de **où est le focus** (et peut défaire la carte au lieu de la description)

`isModalOpen()` (`useGlobalShortcuts.ts:61-67`) cherche `[data-slot="dialog-content"][data-state="open"]`. Cet attribut est posé par le `DialogContent` **partagé** (`src/components/ui/dialog.tsx:62`) — que **tous** les autres dialogues du dépôt utilisent (`SettingsDialog`, `CommandPalette`, `NewMindMapDialog`, `NameDialog`, `ExportDialog`, les dialogues de quiz, `CorruptMapDialog`, etc.). `DescriptionDialog` est le **seul** à rendre un `DialogPrimitive.Content` brut (`DescriptionDialog.tsx:240`). **Donc la garde `if (isModalOpen()) return` ne couvre pas cette modale.**

Chaîne d'événements, vérifiée pièce par pièce :
- le dispatcher global écoute en **capture sur `window`** (`useGlobalShortcuts.ts:119`) ;
- `commandAcceptsEvent` ne bloque `edit.undo` que si `isTypingTarget(event.target)` — vrai pour `<input>`, `<textarea>`, `<select>`, `contenteditable` et **`MATH-FIELD` explicitement** (`:13-22`) ;
- **si le focus est sur un *bouton*** de la modale (menu de type, palette de symboles, « Raccourcis », « Fermer », flèches `NavArrow`), `isTypingTarget` est **faux** → `edit.undo` est acceptée ;
- `useCommandRegistry.run` (`src/state/useCommandRegistry.ts:56-61`) la déclenche si `canUndo` (historique du **document**), puis `preventDefault()` **et `stopPropagation()`** (`useGlobalShortcuts.ts:115-116`) ;
- le `stopPropagation()` **empêche l'événement d'atteindre le listener `document` de la modale** (`DescriptionDialog.tsx:220`, phase *bubble*) → l'undo **local** ne s'exécute jamais.

Résultat : `Ctrl+Z` appuyé alors que le focus est sur un bouton de la description **annule la dernière modification de la carte mentale**, pas la dernière frappe dans la description. Le même geste, focus dans le `<textarea>`, fait bien l'inverse. C'est le pire des deux mondes : un raccourci dont le sens dépend d'un détail invisible.

*Conséquence directe pour #3 :* proposer `Ctrl+Entrée` = « nouveau bloc » dans cet écran, c'est empiler un sens de plus sur un accord déjà surchargé — puisqu'ici `Mod+Entrée` reste armé pour `card.editDescription` (`commands.ts:274`, scope global), qui appelle `requestAction(selected.id, 'description')` (`useCanvasCommands.ts:190-194`) sur la carte **sélectionnée**, pas nécessairement celle qu'on édite. Je n'ai pas vérifié la déduplication en aval de `requestAction` (le risque réel est une ré-entrance / un changement de carte en cours d'édition) : **à confirmer**, mais la garde manque, elle, de façon certaine.

### Piège 2 — `Tab` est déjà trois fois pris, et l'un des trois est un **test**

(1) `card.addChild` = `Tab` (`commands.ts:235`), avec le commentaire « *"Tab, Tab, Tab" build a branch* » (`MindMapCanvas.tsx:472`) ; (2) le **focus trap de Radix**, qui fait de `Tab` le seul chemin clavier vers les boutons de la palette — contrat de test `DescriptionDialog.test.tsx:318-332` et commentaire `MathPalette.tsx:292-302` ; (3) les **taquets de tabulation MathLive** (`#?`, `MathFieldEditor.tsx:12-17`). Intercepter `Tab` dans le champ, c'est violer **WCAG 2.1.2**, casser le seul accès clavier à la palette et casser la navigation dans les fractions. Un `preventDefault()` sur `Tab` est un anti-pattern reconnu sur **toutes** les plateformes, indépendamment des goûts.

### Piège 3 — Le panneau de raccourcis **code en dur** ce que le store sait formater, et il existe **deux historiques d'annulation**

`DescriptionDialog.tsx:584-589` écrit à la main `"Entrée"`, `"Maj + Entrée"`, `"Ctrl/Cmd + Z"`, `"Ctrl/Cmd + Maj + Z"`. Aujourd'hui ce n'est pas faux — ces actions de la modale sont des handlers **locaux**, non déclarés dans `COMMANDS`, donc non remappables. Mais :
1. les mêmes libellés sont déjà produits par `formatBinding` + `KEY_LABELS` (`keys.ts:167-205`), qui gère en plus le rendu macOS (⌘⇧Z) ; le panneau affichera « Ctrl/Cmd » sur un Mac au lieu de « ⌘ », ce que fait pourtant tout le reste de l'app via `ShortcutHint` ;
2. `conflictsIn` ne peut pas voir ce `Ctrl+Z` local : quiconque rebinde `edit.undo` verra deux comportements divergents pour la même touche selon l'écran, et l'UI de remap ne le signalera jamais ;
3. c'est exactement le piège que #13 va rencontrer : **deux historiques** (`descriptionHistory.ts` par carte vs `src/state/history.ts` global) et, déjà, **deux paires d'icônes Undo2/Redo2** possibles à l'écran (`AppToolbar.tsx:366-367`, `MindMapCanvas.tsx:835-836`) — sans libellé distinct, l'utilisateur ne peut pas savoir laquelle défait quoi.

**Corollaire de méthode :** toute nouvelle touche de cette modale doit passer par `COMMANDS` + `formatBinding`, sinon elle est invisible pour le remap, pour `conflictsIn` et pour la palette.

---

## 7. Annexe — fiches de preuve

| Fait | Preuve |
|---|---|
| Entrée = nouveau bloc, Maj+Entrée = ligne | `src/content/BlockEditor.tsx:1056-1060`, `:1108-1112` ; `src/content/MathFieldEditor.tsx:163-167` et son commentaire `:28-32` |
| Entrée dans une cellule = nouvelle ligne du tableau | `src/content/BlockEditor.tsx:1394-1400`, `:1438-1457` |
| Raccourcis documentés à l'écran | `src/content/DescriptionDialog.tsx:584-589` + doctrine `:430-433` |
| `Tab` = sous-carte (canvas) | `src/types/commands.ts:230-237` ; `src/components/MindMapCanvas.tsx:471-473` ; test `src/components/MindMapCanvas.shortcuts.test.tsx:167,184,197` |
| `Enter`/`Shift+Enter` = sœur dessous/dessus (canvas) | `src/types/commands.ts:238-253` |
| `Mod+Enter` = « Modifier la description » (ouvre la modale) | `src/types/commands.ts:269-275` ; `src/hooks/useCanvasCommands.ts:190-194` |
| Registre + collisions + remap | `src/types/commands.ts` (en-tête `:1-13`, `COMMANDS`), `src/state/useShortcutSettingsStore.ts:29-57`, `src/components/settings/ShortcutSettingsPanel.tsx`, `ShortcutRecorder.tsx` |
| Dispatcher capture + `isModalOpen()` + `isTypingTarget` (MATH-FIELD) | `src/hooks/useGlobalShortcuts.ts:13-22`, `:61-67`, `:96-121` ; `src/state/useCommandRegistry.ts:56-61` |
| La modale n'a pas de `data-slot` de dialogue | `src/content/DescriptionDialog.tsx:240` vs `src/components/ui/dialog.tsx:62` |
| `Ctrl+Z` local, sur `document`, sans `defaultPrevented` | `src/content/DescriptionDialog.tsx:213-222` |
| Undo local : pas de `canUndo`, non réactif | `src/content/descriptionHistory.ts:28-30`, `:47-73` |
| Undo global : `canUndo`/`canRedo` + icônes existantes | `src/hooks/useCanvasCommands.ts:60-61` ; `src/components/toolbar/AppToolbar.tsx:366-367` ; `src/components/MindMapCanvas.tsx:835-836` |
| AZERTY : chiffres par `event.code`, lettres par `event.key` | `src/shortcuts/keys.ts:10-26`, `:75-109` ; libellés français `:167-205` |
| `$$` convertit **le bloc entier** | `src/content/BlockEditor.tsx:983-995` (`text.endsWith('$$')` → `onChange({ kind: 'math', latex: text.slice(0, -2) })`) : une phrase qui se termine par `$$` (ou un montant) devient une formule, en entier. Test associé : `src/content/DescriptionDialog.test.tsx:219` |
| Contrats clavier de la modale | `src/content/DescriptionDialog.test.tsx:277-288` (panneau), `:318-332` (palette au clavier) |
| Stack : React 19, Radix, `mathlive`, pas de lib de hotkeys | `package.json` |
