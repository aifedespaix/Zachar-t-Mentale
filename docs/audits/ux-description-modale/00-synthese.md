# Synthèse — audit UX des 18 idées d'amélioration de la modale de description

**Date** : 2026-09-16
**Périmètre** : `src/content/DescriptionDialog.tsx` (modale) et `src/content/BlockEditor.tsx` (éditeur, 1490 l.)
**Méthode** : 9 auditeurs indépendants en parallèle, un par persona (les 7 demandés + accessibilité/mouvement), chacun avec lecture directe du code ; puis recoupement par l'agent coordinateur, avec vérification à la main des affirmations décisives.
**Aucun code n'a été modifié.** Les rapports par persona sont dans ce même dossier.

| Rapport | Persona |
|---|---|
| `01-utilisateur-final.md` | Utilisateur final lambda |
| `02-design-ui.md` | Expert design d'interface |
| `03-expert-ux.md` | Expert UX (parcours, charge cognitive) |
| `04-debutant-informatique.md` | Débutant en informatique |
| `05-expert-raccourcis.md` | Power user clavier |
| `06-ergonomie.md` | Expert ergonomie (Fitts, Hick, cibles) |
| `07-eleve-etudiant.md` | Élève/étudiant en cours de maths |
| `08-expert-technique.md` | Expert technique (faisabilité, coût, risque) |
| `09-accessibilite-motion.md` | Accessibilité (WCAG) et mouvement |

> Convention de lecture : ✅ garder · ⚠️ garder en modifiant · ❌ refuser · 🏗️ à décomposer avant de coder.
> Les faits marqués **[vérifié]** ont été recontrôlés dans le code par le coordinateur, pas seulement affirmés par un auditeur.

---

## 1. Verdict en une page

La liste n'est pas « bonne » ou « mauvaise » : elle mélange **trois choses de nature différente**, et c'est ce mélange qui la rend difficile à trancher telle quelle.

1. **Trois vrais bugs** (#11, #12, #14) que tu as correctement repérés à l'usage, avec causes racines identifiées en une ligne de code chacune. Priorité absolue, coût S, aucun débat.
2. **Des gains mécaniques réels et peu risqués** : #2, #4 (encadré), #7, #13, #17, et la première moitié de #15.
3. **Quatre décisions produit déguisées en tâches d'UI** (#3, #5, #6, #8+#9+#10, #16, #18) : chacune **contredit une convention déjà écrite, documentée et parfois testée dans le dépôt**, ou touche le format de fichier. Ce ne sont pas des arbitrages d'implémentation.

**Le résultat le plus important de l'audit n'est dans aucune des 18 idées.** Ton ressenti « la palette de symboles devrait être ailleurs » (#5) pointe vers un vrai problème, mais la cause n'est pas l'emplacement du footer : **les symboles mathématiques (`≤`, `→`, `π`, `∞`) sont inatteignables dans un bloc texte** [vérifié]. `MathPalette` n'est rendu que pour `block.kind === 'math'` (`BlockEditor.tsx:878`) et `languageHelp.ts` ne contient que des groupes de langue et de typographie (accents, ligatures, monnaie, ponctuation) — aucun symbole mathématique. Une définition « prose + un symbole » est donc **structurellement obligée de se découper en plusieurs blocs**. C'est la cause racine de ta gêne, et elle n'est adressée par rien dans la liste. La corriger est plus petit que #5 et rapporte plus.

---

## 2. Verdict des 18 idées

Colonne « consensus » : nombre d'auditeurs ayant jugé l'idée, et sens dominant.

| # | Idée | Verdict | Consensus | Ce qu'il faut retenir |
|---|---|---|---|---|
| 1 | Flèches en icône seule + tooltip coloré + hover | ⚠️/❌ | 8 — partagé | **L'animation hover : ✅ unanime** (les `NavArrow` n'ont aujourd'hui ni état hover ni transition, alors que la palette en a). **L'icône seule : ❌** chez 6/8 — les mots « Précédent/Parent/Sous-partie » sont ce qui distingue 4 flèches collées aux bords, et l'info passe d'*avant* le geste à *après*. **Le tooltip aux couleurs de la cible : ❌** (contraste non garanti + la flèche du tooltip partagé a des classes figées). Compromis : pilule réduite (mot de relation + ~8 caractères du titre), hauteur 30→40 px, rentrée de −18 px à ±4 px, tooltip Radix en canal **redondant**, pastille de couleur du niveau dans le bouton. |
| 2 | Animer le déplacement des blocs | 🏗️ | 8 — ✅ | **L'idée la mieux notée de la liste**, mais elle suppose un prérequis invisible : `CardBlock` **n'a pas d'identifiant** et les blocs sont montés avec `key={index}` (`BlockEditor.tsx:511`) [vérifié] → View Transitions animerait les mauvaises paires. Il faut une clé locale non persistée + FLIP manuel. Le vrai problème n'est pas Fitts mais **l'ambiguïté** : déposer la ligne *i* vaut « après *i* » en descendant et « avant *i* » en montant. Durées : 150–250 ms ease-out, voisins ~180 ms, jamais > 200 ms pour le vol. `prefers-reduced-motion` obligatoire. |
| 3 | `Entrée` ligne / `Ctrl+Entrée` bloc / `Tab` type | ❌ | 9 — contre | **`Tab` : ❌ unanime**, pour trois raisons cumulées : `card.addChild` = `Tab` sur le canvas (`commands.ts:235`), le focus trap Radix, et les taquets MathLive `#?` ; un test verrouille l'accessibilité clavier de la palette (`DescriptionDialog.test.tsx:318`). C'est un **piège clavier WCAG 2.1.2**. **`Ctrl+Entrée` : ❌ déjà pris** par `card.editDescription` = `Mod+Enter` (`commands.ts:270-274`) — c'est le raccourci qui *ouvre* cette modale [vérifié]. **`Entrée` = ligne : ❌/⚠️** — l'app suit la convention outliner (Entrée = nouvel élément) partout ailleurs, y compris sur le canvas. Alternatives proposées : `Ctrl+Maj+M` (recommandée, mnémonique, libre) ou `Alt+1`/`Alt+2` (chiffres lus via `event.code`, donc AZERTY-safe). |
| 4 | Le nouveau bloc hérite du type du dessus | ⚠️ | 6 — accepté sous conditions | Gain réel (3 formules d'affilée sans lâcher le clavier). Trois garde-fous exigés : n'hériter que de `text`/`math` (**jamais** après une image ou un tableau, où `Entrée` a un autre sens), **pas** depuis le bouton « Ajouter un bloc » du bas, et un `placeholder` visible (sinon « vide » et « cassé » sont indiscernables). Coût d'erreur asymétrique : un bloc texte à corriger = 2 frappes (`$$`) ; une formule à corriger = la prose réaffichée en LaTeX. |
| 5 | Symboles en toolbar haute + switch animé | ❌ | 8 — contre | Le footer collé au bloc a une distance **O(1)** (45–70 px, invariante) ; une barre haute est **O(n)** (330–510 px au 6e bloc) soit **+60 à 85 %** sur 10 insertions. Elle rétablit « sur quel bloc j'agis ? » comme état invisible — exactement ce que le commentaire d'en-tête de `BlockEditor.tsx:273-284` dit avoir supprimé en retirant le panneau latéral. **Mais un vrai défaut existe**, et ce n'est pas l'emplacement : le footer n'existe que sur le bloc *actif*, donc il apparaît/disparaît au `onMouseDown` et **déplace 120–190 px de contenu sous le curseur** → la cible peut bouger entre mousedown et click. Correction recommandée : garder le footer attaché au bloc et **réserver sa hauteur** (`sticky bottom` / hauteur fixe), pas le déplacer. |
| 6 | `Entrée` = nouvelle ligne dans une formule | ❌/🏗️ | 6 — contre | **Piège de données vérifié** : un bloc `math` est une ligne *par construction* (`cardBlock.ts:29-33`) et `latexToPlainText` écrase tous les blancs (`blocks.ts:103`) — or c'est cette projection plate qui alimente les options de QCM (`CardNode.tsx:1149/1169`) et les notes d'export. Une formule multi-lignes ne survit pas. Pire, `\begin{cases}` devient `begincases…endcases` dans le miroir (les commandes perdent leur backslash et les accolades sont supprimées). KaTeX traite `\n` en math mode comme une espace : sans `\displaylines`/`aligned`/`cases`, l'utilisateur verra le curseur descendre et **rien changer à l'écran**. Le besoin réel (systèmes, calculs en étapes) se sert avec des **blocs formule consécutifs**. |
| 7 | Focus auto après changement de type au clic | ✅ | 7 — unanime | Petit, gratuit, évident, symétrique du `pendingFocusSelector` déjà en place. Quatre précautions d'implémentation : `focus({ preventScroll: true })`, **préserver l'offset du caret** (ne pas le remettre en fin de texte), attendre que MathLive soit disponible (#11), et ne jamais déclencher sur un re-render (vol de focus / IME). |
| 8 | Bouton « Question » + champ d'en-tête bleu | ⚠️/❌ | 6 — à reformuler | Acceptable **seulement** si ce n'est ni un type persisté ni un conteneur. Deux objections fortes : une **carte est déjà une question** dans le quiz (`RecallDialog` masque le titre, la définition n'est qu'un indice), et « texte bleu clair » échoue le contraste en thème clair. Sur le plan visuel : reprendre la teinte du niveau 3 plutôt qu'un bleu arbitraire. |
| 9 | Une question = bloc parent contenant des blocs | ❌ | 8 — contre | **Fausse bonne idée la plus lourde.** Un conteneur imbriqué crée une **seconde hiérarchie** que rien d'autre ne voit : un bloc n'a ni `id`, ni `level`, ni `parentId` ; il ne peut pas être cible d'une flèche (`onNavigate` ne prend que des `cardId`), ni entrer dans le quiz, le fil d'Ariane, la palette de niveaux ou l'export. Elle contredit `canReceiveChildren` (`card.ts:123`). Et visuellement, **le bleu signifie déjà « niveau 3 — Sous-partie »** dans toute l'app : un conteneur bleu se lira comme une carte de niveau 3. **Contre-proposition constructive en § 4.** |
| 10 | Une description peut contenir des blocs **ou** des blocs parents | ❌ | 3 — contre | Même refus que #9, plus le mot « organiser » : réordonner *à travers* des niveaux d'imbrication transforme la modale en éditeur d'arbre, et les index qui portent tout l'éditeur (`moveBlock`, `data-row-index`, `textFieldAt`, `activeIndex`) cessent d'être un espace valide. |
| 11 | Bug : deux champs visibles sur une formule | ✅ **bug réel** | 9 — unanime, priorité 1 | Cause racine : `MathFieldEditor.tsx:103`, `const [showMathField] = useState(() => loaded)`. `loaded` est un **flag module** (`:44`) mis à `true` en asynchrone (`:69-79`) : le premier bloc formule de la session monte avant que MathLive (~5,7 Mo) soit chargé et **ne se met jamais à niveau**. Le « double champ » est la branche de repli (`BlockEditor.tsx:1099-1124`) : `<textarea>` LaTeX monospace **plus** aperçu KaTeX empilés. L'aller-retour texte→formule **remonte** le composant → `loaded === true` → WYSIWYG. **Correctif conseillé** : précharger MathLive à l'ouverture de la modale quand le brouillon contient déjà une formule (et à la conversion `$$`), pour que le premier bloc formule monte avec `loaded === true` — la crainte du commentaire (remplacer un champ en pleine frappe) disparaît alors au lieu d'être contournée. **Défaut connexe trouvé au passage** : dans le champ LaTeX de secours, `insert()` **appende à la fin** au lieu d'insérer au caret (`:120-129`) → on écrit `x`, on clique `≤`, on obtient `x≤`. **Nuance de précision** (l'auditeur accessibilité n'a pas reproduit un « double contrôle ») : il n'y a bien qu'**un seul contrôle monté** — `MathFieldEditor` retourne *soit* le repli, *soit* le champ. Ce que tu vois comme « deux champs » est **à l'intérieur du repli** : le `<textarea>` LaTeX (source, monospace) **plus** l'aperçu KaTeX rendu juste en dessous. Ta description (« format texte + visuel ») correspond exactement à cette paire, et la disparition après un aller-retour texte→formule s'explique bien par le remontage. Le diagnostic est solide ; seule la formulation « deux champs » mérite d'être lue comme « deux boîtes pour une seule formule ». |
| 12 | En tableau, une case « formule » ne prend pas la largeur | ✅ **bug réel** | 8 — unanime | Cause racine : `MathFieldEditor.tsx:188-189` rend `<div ref={hostRef} data-testid="math-field" />` **sans aucun style**, alors que la branche texte porte `FIELD_STYLE` (`width: 100%`). Dans la rangée flex de la cellule (`display:flex`, `minWidth: 0`), ce div a `flex-grow: 0` et se dimensionne sur son contenu. Correctif : `style={{ flex: 1, minWidth: 0, width: '100%' }}`. Coût S. |
| 13 | Boutons undo/redo en icônes dans la toolbar du haut | ⚠️/🏗️ | 7 — accepté, reformulé | Trois obstacles réels. (a) **Il n'y a pas de toolbar en haut** dans cette modale — la créer est une décision qui doit être prise *une fois* et non par accumulation (#5 et #13 se disputent le haut ; deux bandes = ~140 px de chrome). (b) **Il manque une API, pas des icônes** : `descriptionHistory.ts` n'expose que des **mutateurs** (`undoDescription`/`redoDescription` changent l'`index` et renvoient `null`), l'état est un `Map` au scope module donc **non réactif** → un bouton ne peut pas calculer son `disabled` sans nouvelle API de lecture + `useSyncExternalStore`. Un bouton grisé par style mais pas `disabled` ment. (c) **Le bouton mentirait sur la granularité** : l'undo de la modale checkpointe la frappe en cours par blocs, pas lettre à lettre. Et **ne jamais** réutiliser `<CommandButton command="edit.undo">` : cette commande pilote l'historique **global** du document et est déjà câblée sur les icônes de `AppToolbar.tsx:366-367`. Emplacement recommandé : le **pied** de la modale. |
| 14 | En tableau, le menu dit « Image » ; y déplacer +ligne/+colonne | ✅ (bug) + ❌ (déplacement) | 8 — scindé | **Bug confirmé, une ligne** : `BlockEditor.tsx:799`, `kind === 'math' ? 'Formule' : kind === 'text' ? 'Texte' : 'Image'` — tout ce qui n'est ni maths ni texte tombe sur « Image ». Le libellé faux se propage à l'`aria-label` (`:805`) et au `title` (`:806`), et **aucun test ne couvre ce cas** (seuls texte/formule sont testés). L'icône, elle, est correcte (`Table2`). **Déplacer « + ligne / + colonne » dans la barre de droite : ❌** — le footer est la **seule** surface qui explique les `+` entre cellules et le toggle `Aa`/`∑` par cellule ; le supprimer est une perte sèche de découvrabilité. |
| 15 | `+` au bon endroit + drag/drop des lignes/colonnes | ✅ (1re moitié) + 🏗️ (2e) | 8 — scindé | **Ton diagnostic est juste et le chantier est plus petit que tu ne crois.** [vérifié] Les `+` existent déjà à **chaque** ligne/colonne, mais : ils sont dessinés **au-dessus de la colonne *i*** alors qu'ils insèrent *après* elle (décalage d'une demi-cellule), ils **n'existent pas avant la première** ligne/colonne (les cases de coin sont des `<div />` vides, `:1273` et `:1302`), ils font **18×18 à `opacity: 0.42`**, et la **corbeille destructive est à 1 px** du `+` (échec WCAG 2.5.8 ; 4–8 % de miss estimés). C'est un décalage + un redimensionnement, pas une invention. **Le drag/drop des lignes/colonnes : 🏗️** — le DnD actuel est du **HTML5 natif**, et `setDragImage` fige un **bitmap** : l'aperçu live demandé est **hors de portée** sans réécrire en pointer events (`motion` est déjà là et suffit pour la FLIP). Il faut aussi une alternative clavier (WCAG 2.5.7). Note : `Entrée` dans une cellule ajoute déjà une ligne (`:1400`), souvent plus rapide que la souris. |
| 16 | Ajouter « image » au sélecteur formule/texte | ❌ (conversion) / ✅ (insertion) | 6 — contre | **En conversion : non.** `convertBlock` **refuse déjà** de convertir une image (`:75`) pour ne pas perdre la référence de fichier, et la règle du fichier est « changer de mode ne détruit jamais de contenu ». Une entrée « Image » dans le menu de type serait une **porte à sens unique**. **Dans une case de tableau : non** — `TableCell = string | { latex }` ne peut pas porter d'asset (format, quiz, PDF) : c'est un changement de modèle. **Ce qui manque réellement est la découvrabilité de l'insertion**, qui existe déjà (bouton « Image » en bas + `Ctrl+V`) — donc agir sur le placement, pas sur la sémantique. |
| 17 | Des tooltips plutôt que des `title` partout | ✅ (reformulé) | 9 — pour | L'app a **déjà** une convention Tooltip Radix (`AppToolbar`, `CardNode`, `FileSidebar`, `CardDetailPanel`, `CommandButton`, `MapTypeBadge`…), et `BlockEditor.tsx` + `DescriptionDialog.tsx` sont **précisément les deux seuls fichiers qui ne l'utilisent pas** [vérifié]. « Partout » est le mauvais cadrage : il y a ~15 `title=` réels, dont ~10 interactifs. Quatre pièges : (a) `Title` natif **n'apparaît jamais au focus clavier** → un tooltip ne **remplace pas** un nom accessible, l'`aria-label` reste obligatoire ; (b) le `TooltipProvider` doit être monté (**un seul**, à la racine du dialogue — sinon `delayDuration = 0` sur chaque provider fait clignoter la gouttière ; 300 ms conseillé, 0 ms seulement pour les 4 flèches) ; (c) `TooltipContent` est un `Portal` en `z-50` et le contenu de la modale est en `zIndex: 50` → **égalité**, l'ordre du DOM décide : à vérifier au pixel ; (d) un `<button disabled>` ne reçoit pas les événements → pas de tooltip sur un bouton désactivé sans conteneur `asChild` non désactivé. Et : **pas de tooltip sur un bouton qui porte déjà son libellé** (« Ajouter un bloc ») — c'est du bruit. **Recadrage important** : puisque aucun bouton icône-seule ne dépend aujourd'hui de `title` seul (voir § 3.3), #17 est un chantier de **cohérence**, pas d'accessibilité — et il faut **d'abord** corriger `disableHoverableContent` (WCAG 1.4.13) avant de multiplier les infobulles. |
| 18 | Flèche absente → `+` qui crée le frère, focus sur le titre | ❌ | 8 — contre | **La plus dangereuse de la liste.** Une position qui tantôt navigue tantôt **crée une carte** : la cible disponible varie de 0 à 4 selon la carte, donc aucune habitude motrice possible, et un clic réflexe crée une carte non voulue. Aggravants : la création de cartes est `scope: 'canvas'` et gardée par `locked`/`editable` (`useCanvasCommands.ts`), la modale est `key={cardId}` et se remonte à chaque navigation, et **l'undo local ne la retire pas** (l'undo de la modale est celui de la *description*, pas du document). Enfin le focus sur le titre n'agit que si l'hôte a passé `onRenameTitle` : sinon le champ est `readOnly` et **l'utilisateur tape dans le vide** (`:352`) — exactement le bug que la modale a été construite pour corriger. Contre-proposition : mettre « créer une sœur » dans le **menu contextuel de la carte**, et pour le vrai manque (pas de flèche enfant au niveau 4) afficher une **explication**, pas un bouton. |

---

## 3. Trois défauts présents dans le code, trouvés par l'audit et absents de ta liste

### 3.1 🔴 `isModalOpen()` ne reconnaît pas cette modale — et `Ctrl+Z` change de sens

Trouvé indépendamment par l'auditeur clavier et l'auditeur technique, puis **[vérifié]** par le coordinateur. C'est le défaut le plus grave découvert.

- `useGlobalShortcuts.ts:61-67` définit « une modale est ouverte » par la présence de `[data-slot="dialog-content"][data-state="open"]`.
- Cet attribut est posé par le composant partagé `src/components/ui/dialog.tsx:62`. Or `DescriptionDialog` rend un `DialogPrimitive.Content` **brut** (`DescriptionDialog.tsx:240`), **sans `data-slot`** : c'est le **seul dialogue du dépôt dans ce cas**.
- Le dispatcher global écoute en **capture sur `window`** (`:119`), donc **avant** le handler `Ctrl+Z` de la modale (`document`, phase bulle).

**Conséquence** : quand le focus est dans un champ, `isTypingTarget` sauve la situation (`:77`) et l'undo local fonctionne. Mais dès que le focus est **sur un bouton** — une touche de palette, « Raccourcis », un `+` de colonne, le menu de type — `Ctrl+Z` déclenche `edit.undo`, c'est-à-dire **l'undo du document, pas celui de la description**, et son `stopPropagation()` empêche l'undo local de tourner. Le sens de `Ctrl+Z` dépend donc d'un détail invisible à l'écran.

**Correctif** : deux mots — `data-slot="dialog-content"` sur le `DialogPrimitive.Content` de la modale — plus un test « les raccourcis globaux sont inertes quand la description est ouverte ». **À faire avant #3, #13 et #18**, qui s'appuient tous sur une modale correctement isolée.

### 3.3 🟡 Le tooltip partagé est configuré en violation de WCAG 1.4.13, et #1/#17 ne réparent rien

[Vérifié] `TooltipProvider` pose `disableHoverableContent = true` par défaut (`ui/tooltip.tsx:7,14`). Or le critère **1.4.13 « Content on Hover or Focus »** exige que le contenu apparu au survol soit **« hoverable »** : le pointeur doit pouvoir se déplacer **sur** l'infobulle sans qu'elle disparaisse. C'est une violation, aujourd'hui latente parce que peu de tooltips portent une information indispensable — mais **#17 la généralise** et **#1 la rend critique** (l'infobulle deviendrait le seul endroit où lire la carte de destination). À corriger d'abord si #1 ou #17 sont retenus. Radix câble bien `aria-describedby` et ouvre au focus (donc **le tooltip Radix est accessible au clavier**, contrairement au `title=` natif) : c'est le point positif à conserver.

**Et le constat qui change le cadrage de #17** : l'auditeur accessibilité a compté **115 `aria-label` contre 22 attributs `title` réels, dont 16 en doublon volontaire** (les deux sur le même bouton). Autrement dit : **aucun bouton icône-seule de l'app ne repose aujourd'hui sur `title` seul**. #1 et #17 ne corrigent donc pas un problème d'accessibilité existant — ils risquent surtout d'**introduire** le motif dégradé (un tooltip mis à la place d'un nom accessible) s'ils sont mal exécutés. La valeur de #17 est de la **cohérence visuelle**, pas de l'accessibilité : à traiter comme du polish, pas comme un correctif.

### 3.2 🟠 `--accent` est plus clair que `--border` → l'indicateur de drop est invisible en thème clair

`BlockEditor.tsx:533-537` peint **l'état actif** et **l'anneau de drop** avec `var(--accent, currentColor)`. [vérifié] dans `index.css` : thème clair `--accent: oklch(0.97)` et `--border: oklch(0.922)` sur `--popover: oklch(1)` — l'indicateur est **plus clair que la bordure qu'il remplace**. Le token d'interaction correct est `--ring: oklch(0.708)`, déjà utilisé ailleurs (`index.css:953, 998, 1340`). **À corriger avant #2 et #15**, qui reposent tous deux sur la lisibilité de cet indicateur.

---

## 4. Les quatre décisions produit à prendre (et ma recommandation)

Ces quatre points ne sont pas des tâches : ce sont des arbitrages que les auditeurs refusent de trancher à ta place. Ma recommandation pour chacun.

**D1 — Faut-il inverser `Entrée` ?** → **Non.** Conserve `Entrée` = nouveau bloc, `Maj+Entrée` = retour à la ligne. Raison structurelle : « the block list IS the line breaks » (`cardBlock.ts:29-33`), et cette convention est **déjà** celle du canvas (`card.addSiblingBelow` = `Enter`). Si le problème est la découvrabilité de `Maj+Entrée`, la réponse est de **le montrer sur place**, pas d'inverser. Pour le changement de type, `Ctrl+Maj+M` (déclaré dans `COMMANDS` pour hériter du remappage et du détecteur de collisions) plutôt que `Tab`. **Corollaire obligatoire** : le `ShortcutsPanel` code ses libellés **en dur** au lieu de lire `formatBinding` (`DescriptionDialog.tsx:584-589`) et il **ment déjà dans 2 surfaces sur 4** (`Entrée` valide le renommage dans le titre `:355-361` ; `Entrée` ajoute une ligne dans une cellule `:1400`). Le rendre contextuel et piloté par le registre fait partie du lot.

**D2 — Faut-il remonter la palette ?** → **Non à la barre haute, oui à la correction du défaut réel.** Garde le footer attaché au bloc et **réserve sa hauteur** pour supprimer le saut de 120–190 px. Ensuite, adresse le vrai manque : **rendre les symboles mathématiques disponibles dans un bloc texte**, ce qui est la cause racine du découpage des définitions.

**D3 — Faut-il un bloc « Question » conteneur ?** → **Non à l'arbre récursif, oui à la forme plate.** Le format `.zmap` **n'est pas versionné** (`serialization.ts:13-22`) ; un `kind` inconnu est aplati en texte par `sanitizeBlock` (`blocks.ts:233-241`) et la **première écriture rend la perte définitive** (le commentaire de `contentOf`, `blocks.ts:255-260`, l'assume). Aggravant : `admin/` importe **le même validateur** (`admin/src/lib/quality.ts:1` → `cardsValidation.ts:335`), donc un passage par « Réparer » depuis le panneau prof **aplatirait la structure**. L'arbre récursif est donc un **changement de format de fichier avec perte de données** chez toute version antérieure.
**Forme recommandée (coût M au lieu de XL)** : un bloc **plat** `{ kind: 'question', text }` qui **ouvre un groupe** — les blocs suivants jusqu'au prochain bloc `question` lui appartiennent par convention de rendu (bordure + fond teinté sur la plage). Conséquences : `sanitizeBlock` gagne **un** cas plat, `blocksToPlainText` reste linéaire (le miroir quiz/XMind/PDF reste exact), `moveBlock`/`blocksDiffer`/l'undo local ne changent pas, la sync reste opaque, `admin/` continue de valider, et une vieille version perd **le style, pas le texte**. C'est **le même lot que #8**. 🚩 Piège à ne pas oublier : `sanitizeBlock` **reconstruit chaque bloc champ par champ** — tout nouveau champ non ajouté à **chaque** branche (et à `cloneBlock`) est **supprimé silencieusement** par le chemin de réparation partagé. Écrire le test « un bloc X avec la nouvelle propriété survit à `sanitizeBlocks` » **avant**.

**D4 — Faut-il permettre la multi-ligne dans une formule ?** → **Non en l'état** (#6). Le modèle est « une ligne par bloc » et le miroir plat alimente le quiz et l'export ; une formule multi-lignes y perdrait sa structure (et `\begin{cases}` y devient `begincases…endcases`). Le besoin est réel (systèmes, étapes) mais se sert avec des **blocs formule consécutifs**.

---

## 5. Ce qui manque dans la liste (par ordre de valeur)

1. **Les symboles mathématiques dans un bloc texte** (`≤`, `→`, `π`, `∞`) — cause racine du découpage des définitions. [vérifié]
2. **Une palette de symboles dans les cellules de tableau** : les cellules ne s'enregistrent pas dans `mathFields` (`ref={() => {}}`, `:1428`) [vérifié] → il faut taper `\infty`, `\leq` à la main dans un tableau de signes.
3. **« Tableau » est introuvable** : le menu de type ne propose que Texte et Formule (`:818-829`) et affiche « Image » sur un tableau (#14). Un élève cherche « Tableau », ne le trouve pas, et conclut que c'est impossible.
4. **Le `ShortcutsPanel` ment et code ses libellés en dur** (voir D1) — c'est le seul endroit qui enseigne `$$` et `Maj+Entrée`.
5. **`endsWith('$$')` convertit toute la phrase** si elle finit par `$$` (`:990`) — à limiter à un bloc vide ou à `$$` seule sur sa ligne.
6. **Un état de chargement honnête pour la première formule** : même #11 corrigé, le champ LaTeX brut ne devrait jamais s'afficher sans que l'utilisateur l'ait demandé.
7. **Le quiz n'interroge que le titre, jamais la définition** — or c'est la définition qu'on écrit ici.
8. **Aucun test ne couvre le drag** aujourd'hui, et jsdom n'implémente pas `DataTransfer` : à prévoir avec #2/#15.
9. **Le mouvement n'est pas gaté globalement.** `prefers-reduced-motion` est déjà géré à **5 endroits** dans `index.css` [vérifié], mais ce n'est pas systématique : `motion` v13 a `reducedMotion: "never"` **par défaut** (il faut `useReducedMotion()` explicitement), `tw-animate-css` n'a aucun `@media`, et `.react-flow__node`, le pulse de reparent et les « marching ants » ne sont pas gatés. Comme #2, #5, #15 et le hover de #1 ajoutent tous du mouvement, **un garde-fou unique** est un prérequis de ce lot, pas un détail.

---

## 6. Ordre d'implémentation recommandé

**Lot 0 — hygiène, avant tout le reste (S)** : `data-slot="dialog-content"` + test d'isolation des raccourcis. Corriger `--accent` → `--ring` pour l'état actif et l'indicateur de drop.

**Lot 1 — bugs confirmés, zéro décision produit (S)** : #14 (le ternaire), #12 (largeur du host), #11 (init MathLive), + l'insertion au caret dans le champ de secours.

**Lot 2 — gains mécaniques indépendants (S, parallélisables)** : #7, #4 (avec ses garde-fous), l'animation hover de #1, puis #17 par fichiers (`tooltip.tsx` d'abord, avec un test de z-index dans la modale).

**Lot 3 — le footer stable et la toolbar** : réserver la hauteur du footer (D2), puis #13 (API de lecture + réactivité dans `descriptionHistory`, boutons dans le **pied**), puis #15-partie-1 (`+` sur la frontière, avant la première ligne/colonne, cibles ≥28 px, corbeille séparée). #13 avant #5 parce que les deux se disputent le haut.

**Lot 4 — symboles dans les blocs texte + cellules de tableau** : le gain produit le plus élevé de l'audit.

**Lot 5 — décisions produit à documenter avant de coder** : #3, #6, #2/#15-DnD (natif + FLIP, ou réécriture pointer events), #18, #16.

**Lot 6 — modèle, un seul lot** : #8+#9+#10 sous **forme plate**, avec les tests de survie `sanitizeBlock` et la décision sur `formatVersion`.

---

## 7. Ce que les auditeurs refusent de faire sans spécification

1. `Tab` = changer le type de bloc (piège clavier, contradiction avec le canvas, test existant).
2. Toute bascule rétroactive `Entrée` ↔ nouveau bloc **sans** mettre à jour `ShortcutsPanel`, les commentaires de contrat et les tests — sinon la documentation intégrée ment.
3. Un `kind` conteneur récursif **sans** décision sur le versionnage du format, protection « refuser d'écrire » pour les versions anciennes, et alignement de `admin/`.
4. Un nouveau champ de bloc **sans** test de survie à `sanitizeBlocks`.
5. Un aperçu live de drag **sans** trancher natif vs pointer events — et sans test.
6. Créer des cartes depuis la modale **sans** définir ce que devient la modale (navigation, historique, carte verrouillée).

---

## 8. Réserves de méthode

- Les sous-agents ne voient pas le tour de conversation d'origine : la liste des 18 idées a dû leur être renvoyée verbatim. Deux rapports (`03`, `07`) signalent des items reçus tronqués et jugés sur leur titre ; `04` et `05` ont reconstitué la liste.
- Les chiffres de `06-ergonomie.md` (durées de Fitts, pourcentages de miss) sont des **estimations** issues d'un modèle, pas des mesures instrumentées — elles servent à comparer des options entre elles, pas comme vérité absolue.
- La gestion multi-ligne réelle de MathLive n'a **pas** été exécutée (le composant est mocké en échec dans les tests) : le refus de #6 s'appuie sur le modèle de données et `latexToPlainText`, qui sont, eux, vérifiés.

---

## 9. Journal d'implémentation

### Lot 0 + Lot 1 — fait

Vérification : `bunx tsc --noEmit` → *No errors found* ; `bunx vitest run` → **145 fichiers, 2030 tests passés** (base de référence avant travaux : 2025 tests — soit +6 tests ajoutés et 1 contrat remplacé).

| Correctif | Fichier | Ce qui a changé |
|---|---|---|
| **Lot 0** — isolation de la modale | `src/content/DescriptionDialog.tsx` | `data-slot="dialog-content"` sur le `DialogPrimitive.Content`. Test ajouté : `isModalOpen()` vaut `true` pendant que la description est ouverte (`src/content/DescriptionDialog.test.tsx`). |
| **Lot 0** — jeton d'interaction | `src/content/BlockEditor.tsx` | `var(--accent)` → `var(--ring)` pour la bordure du bloc actif et l'anneau de drop (`oklch(0.97)` → `oklch(0.708)`, visible en thème clair). |
| **#14** — libellé de type | `src/content/BlockEditor.tsx` | Le ternaire qui finissait en `: 'Image'` remplacé par `KIND_LABEL: Record<CardBlockKind, string>` — un `table` s'annonce « Tableau ». Test ajouté (`BlockEditor.test.tsx`). |
| **#12** — largeur en cellule | `src/content/MathFieldEditor.tsx` | L'hôte WYSIWYG, qui n'avait **aucun** style, reçoit `flexGrow: 1, flexBasis: 0, minWidth: 0, width: '100%'` via un conteneur commun aux deux branches. Test ajouté. |
| **#11** — double champ | `src/content/MathFieldEditor.tsx` | `loadMathLive()` renvoie désormais un booléen (« chargé / ne chargera jamais ») ; le bloc **remonte** du champ brut vers le vrai éditeur dès que l'import aboutit, via `upgradeWhenIdle()`. Le contrat testé a été remplacé, pas supprimé : la garantie d'origine (ne jamais remplacer le champ sous un caret actif) est conservée par une garde `contains(document.activeElement)`, doublée d'un `onBlur` qui diffère l'upgrade au lieu de le perdre. 3 tests : upgrade effectif, non-interruption pendant la frappe puis upgrade au blur, et fallback définitif si l'import échoue. |

**Deux points de vigilance découverts pendant l'implémentation** :

1. Une première version de `upgradeWhenIdle()` n'était gardée que par le focus. Sur une machine où MathLive **échoue**, un simple blur aurait alors remplacé le champ LaTeX — le seul éditable — par un hôte vide. D'où la seconde garde `if (!loaded)`, sur le drapeau module qui n'est positionné qu'en cas de **succès**. Le test « stays on the caller's field forever when the editor never loads » couvre désormais aussi le blur.
2. Le conteneur ajouté autour des deux branches est ce qui rend la garde de focus possible ; il porte aussi le dimensionnement de #12. `flexGrow`/`flexBasis` sont écrits en propriétés longues plutôt qu'en raccourci `flex`, pour que le test puisse affirmer l'intention sans dépendre de la façon dont jsdom développe un raccourci.

### Lot 1 — volontairement NON fait

- **Insertion au caret dans le champ LaTeX de secours** (`MathFieldEditor.tsx`, `insert()` : sans élément `math-field` vivant, le fragment est ajouté **à la fin** au lieu d'être inséré au caret, car ce `<textarea>` appartient à l'appelant). Le corriger proprement demande de faire passer une ref du champ de secours de l'appelant au composant — un changement d'API sur `MathFieldEditor` et ses deux appelants — plus une restauration de caret après le `onChange` contrôlé. Non fait ici pour ne pas mêler un changement d'API à une passe de correctifs. Avec #11 en place, ce chemin ne subsiste que sur les machines où MathLive échoue définitivement.
- **Préchargement de MathLive** : inutile une fois l'upgrade en place. `MathLive` n'est toujours payé qu'à l'ouverture d'un bloc formule.

### Lot 2 + #15 première moitié — fait

Vérification : `bunx tsc --noEmit` → *No errors found* ; `bunx vitest run` → **145 fichiers, 2037 tests passés** (2030 après le Lot 0/1, soit +7).

| Correctif | Fichier | Ce qui a changé |
|---|---|---|
| **#4** — héritage du type | `src/content/BlockEditor.tsx` | `inheritableKind()` + `emptyBlock()` : un nouveau bloc hérite de `text`/`math` du bloc au-dessus, par `Entrée` **et** par le bouton « Ajouter un bloc ». Jamais d'un tableau (où `Entrée` en cellule ajoute une ligne) ni d'une image (qui n'a pas de texte à donner). 4 tests. |
| **#7** — focus après changement de type | `src/content/BlockEditor.tsx` | Le champ reçoit le caret après un changement de type par le menu. **Deux mécanismes ont été nécessaires** : Radix restaure le focus sur le déclencheur à la fermeture du menu (`onCloseAutoFocus` + `pickedType`, ajoutés à `BlockKindMenu`), et cette restauration ne passe pas par les effets de React — d'où un `focusBlockAfterMenu()` qui attend la tâche suivante. Un simple `focusBlockLater()` était repris dans la foulée : constaté par instrumentation, `document.activeElement` valait `BODY`. 1 test. |
| **#1** — réactivité au survol | `src/content/DescriptionDialog.tsx` | Les quatre `NavArrow` passent en `motion.button` avec le ressort de l'app (500/25, la convention de `CardNode`), `scale` plus doux car ce sont de larges pilules. Le **centrage passe en `x`/`y` motion** et non plus en `transform` CSS : `whileHover` compose son `scale` dans la même propriété et écrasait le `translate(-50%)` — piège déjà documenté par `EdgeButton`. Garde `useReducedMotion()` obligatoire (`motion` ne consulte pas `prefers-reduced-motion` par défaut). **Le mot de relation et les couleurs cibles sont conservés** : l'audit a refusé l'icône seule et le tooltip teinté par carte. |
| **#15** (1ʳᵉ moitié) | `src/content/BlockEditor.tsx` | Cibles `HANDLE_BUTTON` 18×18 → **28×28**, écart « + »/corbeille 1px → **6px**, opacité 0.42 → 0.72 (WCAG 2.5.8, et la corbeille destructive n'est plus à un cheveu du `+`). Alignement en `flex-end` : chaque `+` est posé **sur la frontière qu'il agit**, au lieu d'être centré une demi-cellule à côté. Les deux frontières manquantes sont ajoutées (coin haut-gauche → avant la 1ʳᵉ colonne ; gouttière d'en-tête → avant la 1ʳᵉ ligne), ce qui rend l'insertion en tête possible — elle ne l'était pas. Extrait en composant `TableHandle`. Gouttière 40 → 68px pour la nouvelle taille. 2 tests. |

**Reste du Lot 3 au moment de cette passe — traité à la passe suivante (§ ci-dessous), sauf un point :**

- **Stabilité du footer de bloc** (le vrai fond de #5) — **en attente de la validation visuelle des maquettes** (`maquettes-bandeau-outils.html`). ⚠️ **Correction d'une option que j'avais mal présentée** : j'avais proposé `position: sticky; bottom: 0` comme correctif. **C'est faux, et vérifié** : un élément collant **garde sa place dans le flux**, donc un pied collant ne supprime pas le décalage de 120–190 px — il change seulement l'endroit où il reste visible, et il disparaît quand même avec son bloc si celui-ci sort de l'écran par le haut. Le **seul** montage qui supprime réellement le décalage est une bande **hors des blocs, à hauteur réservée**. C'est l'argument technique en faveur de l'idée de l'utilisateur (un bandeau en haut, comme un logiciel d'édition de texte), et les maquettes comparent quatre variantes : v0 = aujourd'hui, v1 = bandeau en haut dont le contenu **suit** le type du bloc actif, v2 = bandeau en haut **unifié** à positions fixes avec l'inapplicable grisé, v3 = pied collant. La question à trancher est **v1 ou v2** — au prix, en v2, d'environ 110 px de chrome permanent contre la mémoire du geste.


### Fin du Lot 3 (#13, #17, #16) — fait

Vérification : `bunx tsc --noEmit` → *No errors found* ; `bunx vitest run` → **145 fichiers, 2042 tests passés** (2037 après le Lot 2, soit +5).

| Correctif | Fichiers | Ce qui a changé |
|---|---|---|
| **#13** — undo/redo avec API de lecture | `src/content/descriptionHistory.ts`, `src/content/useDescriptionHistory.ts` (nouveau), `src/content/DescriptionDialog.tsx` | `canUndoDescription`/`canRedoDescription` en **lecture seule** (`undoDescription` répond à la même question en **mutant** l'index : l'appeler pour décider si le bouton doit être grisé consommerait le pas d'annulation), plus `subscribeDescriptionHistory` et un `notify()` sur chaque changement. Le binding React passe par `useSyncExternalStore` avec un snapshot **numérique** — un objet neuf à chaque lecture ferait re-rendre en boucle. Deux boutons icône dans le **pied** de la modale, avec un vrai `disabled`. 2 tests. |
| **#17** — tooltips | `src/components/ui/hint.tsx` (nouveau), `src/content/DescriptionDialog.tsx`, `src/content/BlockEditor.tsx` | Composant `Hint` partagé (Tooltip Radix, `z-[60]` car la modale est en `zIndex: 50`). Un **seul** `TooltipProvider` par surface — un par bouton donnerait à chacun son propre état de « skip delay », ce qui fait clignoter une colonne d'infobulles instantanées. Migrés : croix de fermeture, undo/redo, les 4 `NavArrow`, bouton « masquer les raccourcis » ; côté éditeur : poignée de glissement, `GutterIcon` (monter/descendre/supprimer), `TableHandle` (`+`/corbeille), « transformer en tableau ». **Pas de tooltip sur un bouton qui porte déjà son libellé** (audit), sauf quand il ajoute une information — voir #16. 3 tests. |
| **#16** — découvrabilité de l'image | `src/content/BlockEditor.tsx` | Le bouton « Image » a un libellé visible, donc son infobulle ajoute ce que le mot ne dit pas : **« ou collez-la avec Ctrl+V »**. C'était le vrai manque — un élève qui avait besoin d'une figure chaque semaine ignorait que le collage fonctionne. **`convertBlock` vers `image` reste refusé** (porte à sens unique, cf. § 2), et rien n'a été ajouté dans une cellule de tableau (changement de modèle). 1 test. |

**✅ Décision prise — WCAG 1.4.13 « Content on Hover or Focus » : on ne change rien.** L'auditeur accessibilité recommandait de passer `disableHoverableContent` à `false`, parce que le critère exige que le pointeur puisse se déplacer **sur** une infobulle sans qu'elle disparaisse. Je ne l'ai pas fait : `src/components/ui/tooltip.test.tsx` **encode ce comportement dans un test** (« ferme le tooltip dès que la souris quitte le déclencheur, même en passant par le tooltip »), c'est donc un choix produit assumé et verrouillé, pas un oubli. **L'utilisateur a tranché : il préfère les bulles qui s'effacent instantanément.** Le critère reste donc enfreint, mais en connaissance de cause — et le préjudice pratique est faible, aucune infobulle de l'app ne portant d'information indispensable. À ne pas re-signaler comme un défaut.

**#17 — état exact, et correction de deux décomptes que j'avais annoncés faux.**

J'ai d'abord écrit « 7 sites réels », puis « 2 sites réels ». **Les deux étaient faux**, pour la même raison : mon `grep` ne capturait pas les mêmes formes (`title="littéral"` d'un côté, `title={expression}` de l'autre), et il comptait des **props de composants** comme des attributs DOM. Voici ce qui est vérifié site par site.

**Convertis dans cette passe** (tous avec le composant `Hint` partagé et le provider unique de leur surface) :

| Fichier | Sites |
|---|---|
| `src/content/DescriptionDialog.tsx` | croix de fermeture, undo, redo, les 4 `NavArrow`, bouton « masquer les raccourcis » |
| `src/content/BlockEditor.tsx` | poignée de glissement, `GutterIcon` (monter/descendre/supprimer), `TableHandle` (`+`/corbeille), « transformer en tableau », bouton « Image », **sélecteur de type d'une cellule** |
| `src/components/sidebar/FileSidebar.tsx` | poignée de redimensionnement |
| `src/content/LanguageHelpPalette.tsx` | les touches de caractères (elles affichent un **glyphe** — `¿`, `»`, `œ` — et le libellé est ce qui le nomme) |

Deux de ces conversions méritent d'être signalées parce qu'elles n'étaient pas mécaniques : le **sélecteur de type d'une cellule** est à la fois déclencheur de tooltip et de menu déroulant (deux slots Radix doivent composer sur le même élément — un test asserte le tooltip *et* que le menu s'ouvre encore), et la **poignée de redimensionnement** porte un `handleRef` utilisé par le drag (composition de refs ; les 4 tests existants du redimensionneur passent).

**Non convertis, et pourquoi :**

- `src/content/MathPalette.tsx:284` — **délibéré**. Une touche « spelled » affiche déjà son libellé en texte à côté du symbole, donc un hint y serait exactement le bruit que l'audit demandait d'éviter ; seules les touches d'opérateur nu (`×`, `≤`) en profiteraient. La bonne forme est un wrapper conditionnel sur `spelled`, pas un `Hint` systématique.
- `src/components/sidebar/FileTreeRow.tsx:682` — un `<span role="img">` **non interactif** dont le commentaire dit que le doublon `aria-label` + `title` est **voulu** (« ils disent À QUI est le fichier, et un lecteur d'écran n'a pas de couleur à lire »). Choix documenté, pas touché.
- **Autres surfaces, non migrées** : `AppToolbar.tsx:444`, `FileSidebar.tsx:629`, `FileTreeRow.tsx:721,799`, `CardNode.tsx:1193`, `App.tsx:437`, `QuizConfigModal.tsx:112`, `SyncSettingsPanel.tsx:364`. ⚠️ Je **n'ai pas vérifié individuellement** lesquels sont des attributs DOM sur un contrôle et lesquels sont des props ou des `<span>` non interactifs — c'est précisément l'erreur que j'ai commise deux fois plus haut. Ce qui est certain : ces sites sont dans le canevas, la barre d'outils, l'arborescence et les paramètres, c'est-à-dire **d'autres écrans**, et le plan de l'audit était explicitement « une PR par écran ». Le faire correctement demande de reprendre l'inventaire site par site sur ces fichiers.

Vérification de cette passe : `bunx tsc --noEmit` → *No errors found* ; `bunx vitest run` → **145 fichiers, 2043 tests passés**.

### Lot 4 — signes mathématiques dans la prose — fait

C'est le gain que **les neuf auditeurs** ont classé le plus haut, et il n'était dans aucune des 18 idées. La cause racine : `≤`, `→`, `π`, `∞` n'étaient atteignables **nulle part** dans un bloc texte. `MathPalette` ne sert qu'un bloc `math`, et la palette de langue ne connaît que les accents et la typographie. Écrire « f est croissante sur I si a ≤ b » obligeait donc à découper la phrase en trois blocs autour d'une formule — ou à taper `<=`. Les deux ont été observés à l'usage.

| Fichiers | Ce qui a été fait |
|---|---|
| `src/content/mathSymbols.ts` (nouveau) | `MATH_SYMBOLS` : 16 signes qu'un cours écrit réellement au milieu d'une phrase (`≤ ≥ ≠ ≈ × ÷ ± · → ⇒ ⇔ ∈ √ π ∞ °`), sur le modèle `SpecialCharacter` déjà utilisé par les caractères de langue — donc une insertion au caret, et les paires qui se ferment toutes seules en héritent gratuitement. |
| `src/content/MathSymbolsPalette.tsx` (nouveau) | La rangée, **une seule**, avec un `Hint` par touche (le glyphe est affiché, le libellé le nomme) et `onMouseDown` + `preventDefault` comme la palette de formules : sans ça le clic déplacerait le focus sur le bouton et le caret **hors** de la phrase, c'est-à-dire exactement ce que la palette sert à respecter. |
| `src/content/BlockEditor.tsx` | Rangée rendue en **premier** dans le footer d'un bloc texte (sur une fiche de maths, ces signes servent bien plus que les accents en dessous) ; titre du footer « Caractères et symboles ». Et dans un **tableau** : la rangée apparaît sous la grille **quand une cellule a le focus**, et écrit dans cette cellule. |

**Pourquoi la palette de cellule s'affiche avec le caret et pas en permanence** : sans caret il n'y a nulle part où insérer ; une rangée de boutons inertes serait pire qu'une absence de rangée. C'est aussi ce qui fait que le tableau ne coûte aucune hauteur tant qu'on n'y tape pas — ce qui compte, vu le décalage du footer discuté plus haut.

**Deux détails d'implémentation qui ne sont pas des détails :**

1. **La cellule cible est trouvée à l'instant de l'insertion**, via `document.activeElement`, et **non mémorisée** dans un état. Un couple (ligne, colonne) mémorisé devient faux dès qu'on insère une colonne ou supprime une ligne, et une palette qui écrit dans la mauvaise cellule — ou dans une cellule qui n'existe plus — est pire que pas de palette. `data-cell` est posé sur l'**enveloppe** de la cellule, pour que `closest` fonctionne aussi bien depuis un `<input>` que depuis un `<math-field>` MathLive (dont on ne contrôle pas les attributs). C'est ce même choix qui a produit un bug attrapé par les tests : ma restauration de caret cherchait `[data-cell]` et tombait sur le `div` enveloppe, d'où `setSelectionRange is not a function`.
2. **Les deux natures de cellule passent par le même geste** : un `<input>` reçoit le caractère Unicode au caret, et une cellule **formule** reçoit le même caractère via `insert()` de MathLive — l'élément vivant expose déjà la méthode, donc aucune registre de handles n'a été nécessaire (`TableCellField` jetait le sien avec `ref={() => {}}`). C'est le chemin qui remplace le fait de taper `\leq` à la main.

Vérification : `bunx tsc --noEmit` → *No errors found* ; `bunx vitest run` → **145 fichiers, 2047 tests passés** (2043 + 4 pour le Lot 4). 4 tests nouveaux pour ce lot.

### Lot 5 — le bandeau en haut (v2 raffiné) — fait

Décision de l'utilisateur après les maquettes : **v2**, avec trois exigences — garder le système de couleur, garder les groupes par catégorie, et compacter le vertical. Implémenté après validation sur `maquettes-bandeau-outils.html`.

Vérification : `bunx tsc --noEmit` → *No errors found* ; `bunx vitest run` → **145 fichiers, 2050 tests passés**.

| Fichiers | Ce qui a changé |
|---|---|
| `src/content/symbolSets.ts` (nouveau) | Les familles du bandeau, avec la décision qui fait gagner la place : **un seul glyphe par signe**, et c'est le champ qui décide de ce qu'il écrit — `glyph` dans un texte, `latex` dans une formule. `≤` n'existe donc plus en deux exemplaires. **Structures** (fraction, puissance, indice, racine, racine n-ième, parenthèses) et **Unités** (`\ce`, `\pu`) sont reprises telles quelles : les retirer aurait été une **perte de capacité**, pas un rangement — `katex/contrib/mhchem` est bien chargé, donc les touches chimie rendent vraiment. |
| `src/content/SymbolBand.tsx` (nouveau) | Une seule rangée qui se replie, familles **en ligne** avec les teintes de `GROUP_TONES` (mixées en transparence, lisibles en clair comme en sombre), touches de 32 px, cible (« Bloc 2 · Formule ») **dans le flux** au lieu d'une ligne de titre. |
| `src/content/BlockEditor.tsx` | Le bandeau est rendu **hors de la zone qui défile**, à hauteur constante. `insertSymbol` remplace les trois chemins d'insertion par un seul : **le champ qui a le focus décide** — Unicode au caret dans un texte, LaTeX au caret dans une formule, taquets MathLive (`#0`, `#?`) dans une cellule de formule. `data-cell-kind` permet de griser les familles « formule seulement » là où elles ne valent rien. `onMouseDown` annulé sur les touches, sinon le clic retirerait le caret du champ. |
| `src/content/LanguageHelpPalette.tsx` | `GROUP_TONES` et `tint` exportés : une seule définition des teintes, deux consommateurs. |
| **Supprimés** | `MathPalette.tsx`, `MathSymbolsPalette.tsx`, `mathSymbols.ts` — superseded par le bandeau (structures et chimie comprises). Le pied de bloc ne porte plus que les **caractères de langue**, pour une raison qui n'est pas un oubli : ils dépendent d'une langue qu'on choisit, donc ils ne peuvent pas tenir dans une bande permanente qui doit montrer les mêmes touches à tout moment. |

**Gain sur le décalage, mesuré en nombre de pieds supprimés** : un bloc **formule** et un bloc **tableau** n'ont plus de pied du tout, et un bloc **texte** n'en garde qu'un pour les accents. Le décalage de 120–190 px qui venait des palettes de symboles a donc disparu ; il subsiste, réduit, pour la seule palette de langue. **Le finir** demande de traiter les accents (les faire tenir dans le bandeau, ou les mettre derrière un bouton qui ouvre un panneau) — un chantier à part, avec ses propres tests.

**Trois erreurs que la vérification a attrapées et que je signale** : les noms accessibles des actions de tableau ont dû être **conservés à l'identique** dans le bandeau (sinon un lecteur d'écran — et trois tests — auraient eu à réapprendre où l'action est partie) ; l'espace final après les opérateurs binaires (`\times ` et non `\times`) a été **conservé** pour la lisibilité du source LaTeX ; et `MathPalette.tsx` est resté orphelin après le portage, donc supprimé plutôt que laissé comme code mort.

**Raffinement après retour d'usage** (« trop condensé quoique bien organisé ») :

| Fichiers | Ce qui a changé |
|---|---|
| `src/types/symbolBand.ts` (nouveau) | Les types sont sortis de `symbolSets.ts` et vivent avec ceux du reste du contenu (`cardBlock`, `card`, `commands`) : **la forme** dans `types/`, **le contenu** dans `symbolSets.ts`, **le rendu** dans `SymbolBand.tsx`. Une famille se retire en supprimant une entrée de `symbolSets`, et rien d'autre ne bouge. |
| `src/content/SymbolBand.tsx` | Aération, et surtout **un conteneur teinté par famille** au lieu d'un simple espacement. C'est ce qui change tout : la bande se replie sur deux lignes, et un groupe doit rester un groupe **de chaque côté du repli** — c'est la couleur du fond qui le dit, pas la distance entre deux touches. Le nom de la famille s'écrit maintenant **dans la couleur de sa famille** (ramenée vers le premier plan du thème, donc lisible en clair comme en sombre) plutôt que sur une seconde pastille : une pastille dans une pastille se lit mal. Touches 32 → 34 px, écarts internes 4 → 5, écart entre familles 9 → 14, et plus d'air autour de la bande. |

### Déplacement des blocs (#2 d'origine) — fait, avec une réserve non vérifiable

Vérification : `bunx tsc --noEmit` → *No errors found* ; `bunx vitest run` → **145 fichiers, 2051 tests passés**.

**Ce que je dois dire d'abord** : l'animation demandée à l'idée #2 **n'avait jamais été implémentée**. L'audit l'avait classée « à décomposer » et je l'ai reportée de lot en lot sans le dire assez clairement. Ce n'était pas un oubli de ma part au sens d'un bug, mais c'était un manque de transparence, et c'est corrigé maintenant.

| Ce qui a changé | Détail |
|---|---|
| **Cause probable du glissement qui ne marchait pas** | La poignée avait été enveloppée dans un `Hint` au lot #17. Un tooltip Radix rend son contenu dans un **portail**, et le portail s'ouvre sous le curseur **au moment précis où l'on attrape la poignée** : une insertion dans le DOM pendant le `dragstart` fait avorter le glissement natif. La poignée est donc le **seul contrôle de l'éditeur sans tooltip Radix** — elle porte un `title` natif et son `aria-label`. Un tooltip qui empêche de glisser est pire qu'un tooltip imparfait. |
| **Poignée plus trouvable** | 24 px à 45 % d'opacité → **28 px à 70 %**, icône 13 → 15. Une poignée qu'on ne voit pas se lit comme « le déplacement ne marche pas », et c'est la seule façon de réordonner à la souris. |
| **L'animation** | Les blocs sont devenus des `motion.div` en **`layout="position"`** : `motion` anime les blocs qui **changent de place** — donc « lequel prend la place de l'autre » — et **rien d'autre**. `layout` seul animerait aussi les changements de taille, donc chaque zone de texte qui s'allonge pendant la frappe : une page qui tremble au lieu d'un déplacement qu'on suit. 180 ms, ease-out, et garde `useReducedMotion()` explicite (`motion` ne consulte pas `prefers-reduced-motion` par défaut). |

⚠️ **Réserve honnête** : **jsdom n'implémente pas le drag & drop HTML5** (`DataTransfer` absent), donc **je n'ai pas pu vérifier le glissement lui-même** — aucune ligne de test ne le couvre, c'était déjà le cas avant. La cause identifiée est une hypothèse solide et le correctif est sans risque, mais **la confirmation doit venir de l'app**. Si ça ne glisse toujours pas, la prochaine étape est de remplacer le DnD natif par des pointer events, ce que l'audit recommandait déjà pour obtenir l'aperçu *pendant* le drag (le natif fige un bitmap avec `setDragImage`, donc l'animation ne peut jouer qu'**après** le dépôt).

### Configurateur de familles (demande #1) — fait

Vérification : `bunx tsc --noEmit` → *No errors found* ; `bunx vitest run` → **146 fichiers, 2057 tests passés**.

| Fichiers | Ce qui a été fait |
|---|---|
| `src/persistence/bandFamilies.ts` + son test | Le réglage vit avec les autres préférences d'interface (`localStorage`, clé `zachart-mentale:band-hidden-families`), même contrat que `booleanFlag`/`panelWidth` : au mieux, jamais d'exception quand le stockage est bloqué, et **lecture synchrone** pour que le premier rendu reflète déjà le choix. |
| `src/content/BandOptionsOverlay.tsx` | Une case par famille : nom, nombre de signes, mention « formules » pour les familles qui n'ont de sens qu'en LaTeX. Bouton « Tout afficher », compteur de familles visibles. |
| `src/content/SymbolBand.tsx` | Un bouton **⚙ Familles** dans le bandeau, et le filtrage des familles masquées. |
| `src/content/BlockEditor.tsx` | L'état, l'écriture du réglage, et la surcouche. |

**Deux décisions qu'il faut connaître :**

1. **On enregistre les familles MASQUÉES, pas les familles visibles** — et c'est un vrai choix, pas un détail d'implémentation. Avec la liste inverse, une famille ajoutée plus tard dans `symbolSets` resterait invisible pour quiconque a ouvert ce réglage une fois : un nouveau signe ne se montrerait jamais. Là, il apparaît tout seul.
2. **Le réglage est lu à l'initialisation, pas dans un effet.** Un effet ferait peindre le bandeau complet puis le réduirait — c'est-à-dire exactement le saut visuel que tout ce bandeau existe pour éviter.

**Sur la forme de la surcouche** : ce n'est pas un `Dialog` Radix mais une surcouche locale `position: absolute; inset: 0`, comme l'overlay de confirmation de suppression. Elle s'ouvre depuis une modale qui est **déjà** un dialogue Radix, et en imbriquer un second dans son portail complique le piège de focus et la touche Échap sans rien apporter. Échap est intercepté en **phase de capture** pour fermer la surcouche et non la description entière. ⚠️ **Limite assumée** : le focus n'est pas piégé et la tête et le pied de la description restent atteignables — donc `aria-modal` n'est **pas** revendiqué, ce serait un mensonge pour un lecteur d'écran.

### Poignées de tableau (demande #2) — fait

Décision de l'utilisateur : le survol seul suffit, la suppression de ligne/colonne peut être souris-seule.

| Ce qui a changé dans `src/content/BlockEditor.tsx` | Détail |
|---|---|
| **Poubelle séparée du `+`** | Le `+` reste sur la **frontière** (il insère entre deux colonnes/lignes) ; la poubelle est **centrée sur la colonne** qu'elle supprime, et **centrée verticalement sur la ligne**, collée au bord gauche de la gouttière. Deux positions distinctes, donc plus de cible destructrice à un pixel d'un `+`. |
| **Révélée au survol** | `hoveredTrash()` : `opacity: 0` + `pointerEvents: none` tant que la ligne/colonne n'est pas appelée, puis `1`/`auto`. Un clic ne peut donc pas tomber sur une poubelle qu'on ne voyait pas. |
| **Boutons plus petits** | 28 → **22 px**, icônes 13 → 12, gouttière 68 → **52 px**. |
| **Ligne/colonne survolée trouvée par `data-cell`** | Un seul gestionnaire sur la grille couvre toutes les cellules — pas un rappel câblé par ligne et par colonne — et le `focus` passe par le **même** chemin. |

⚠️ **Un écart assumé par rapport à ta consigne** : tu as accepté que la suppression soit souris-seule, mais **je l'ai rendue atteignable au clavier pour rien** — `opacity: 0` reste **focalisable**, et le focus la révèle (il emprunte le même chemin que le survol). Ce n'est pas un désaccord : ça ne change **rien** à ce que tu vois, et sans ça la suppression d'une ligne ou d'une colonne serait tout simplement **impossible au clavier**. Si tu veux vraiment la souris seule, retirer le `onFocus`/`onBlur` de la grille suffit.

**Réserve** : la géométrie est vérifiée par les tests (tailles, séparation, révélation, non-chevauchement par construction), mais **je n'ai pas d'aperçu visuel** — les tests jsdom ne calculent pas de mise en page. Ce qui est certain par construction : la poubelle est en `position: absolute`, donc elle ne participe pas au flux et ne peut pas pousser le `+`.

### Le « + » nu des frontières — fait

Demande : « ne me pas de bordure ni fond, juste un `+`, et en hover on voit le bouton avec fond/bordure ».

| Ce qui a changé | Détail |
|---|---|
| `src/content/BlockEditor.tsx` | `BARE_HANDLE` (sans `border` ni `background`) + `className="table-handle"` sur les `+`. La règle est encodée **dans `TableHandle`** (`destructive === false` ⇒ nu) plutôt qu'aux quatre sites d'appel : un seul endroit décide, et la corbeille garde sa chrome parce qu'elle est destructive. |
| `src/index.css` | `.table-handle` : transparent au repos, et **au survol comme au focus clavier** (`:focus-visible`) une bordure et un fond `--background`. Rien au repos sauf le glyphe, qui reste visible — c'est la *chrome* qui disparaît, pas le signe, sinon la poignée deviendrait introuvable (le reproche que l'audit faisait déjà à l'opacité de 42 %). |

**Le piège, et il est réel** : les couleurs devaient vivre dans la feuille de style et **pas** en ligne sur le bouton. Un `border` ou un `background` en ligne l'emporte toujours sur une règle `:hover`, donc le bouton n'apparaîtrait **jamais**. C'est écrit dans `BARE_HANDLE`, dans la règle CSS, et **verrouillé par un test** — parce que c'est exactement le genre de « nettoyage » qu'un futur passage réintroduirait sans le savoir.

### Retour d'usage : glissement, animation, bouton invisible

| Symptôme rapporté | Cause trouvée | Correctif |
|---|---|---|
| **Le glissement ne part pas** | Le bloc active son index sur `onMouseDown`, ce qui déclenche un rendu React **entre le mousedown et le `dragstart`** — et Chromium abandonne alors le glissement natif. Ma correction précédente (retirer le portail de tooltip) traitait une autre cause, réelle mais pas décisive. | `onMouseDown={event => event.stopPropagation()}` **sur la poignée** : le mousedown ne remonte plus jusqu'au bloc, donc plus de rendu pendant le geste. La poignée n'a pas besoin d'activer le bloc — le glissement le fait à l'arrivée. |
| **Le bouton des familles est invisible** | Il était placé **en dernier** dans un bandeau qui se replie sur deux ou trois lignes : il atterrissait donc sur la dernière ligne, à droite, souvent hors de vue. | Déplacé **en tête, juste après la cible** — première ligne, toujours à la même place. |
| **L'animation de déplacement ne marche pas** | **Mon erreur, et je l'avais moi-même documentée sans en tenir compte** : les blocs sont montés avec `key={index}`. Avec des clés d'index, React réutilise l'élément de *chaque position*, donc **aucun élément ne change jamais de place** — `layout` n'a rien à animer. L'audit avait écrit noir sur blanc que `CardBlock` n'a pas d'identifiant et que le rendu est `key={index}` : c'était le prérequis, et j'ai posé l'animation sans le traiter. | **Non corrigé, et le commentaire du code le dit maintenant.** Ce qu'il faut : une identité **stable** par bloc, locale et non persistée — un tableau d'ids tenu en parallèle dans l'éditeur et déplacé par les mêmes opérations que `move`/`insert`/`remove`. Une `WeakMap` sur l'objet bloc ne suffit **pas** (chaque frappe crée un objet neuf ⇒ identité neuve ⇒ remontage à chaque caractère, donc perte du focus). |

**Leçon de méthode, et elle vaut d'être notée** : le glissement a demandé **deux** corrections parce que j'ai traité la première hypothèse plausible sans pouvoir vérifier — jsdom n'implémente pas le drag & drop. J'aurais dû le dire plus tôt : sur cette fonction précise, je travaille à l'aveugle et chaque hypothèse doit être confirmée dans l'app.

### Identités stables des blocs → l'animation devient possible — fait

Le prérequis que l'audit avait identifié et que j'avais sauté. Vérification : `tsc` propre, **146 fichiers / 2060 tests**.

| Ce qui a changé dans `src/content/BlockEditor.tsx` | Détail |
|---|---|
| `blockIds` + `idSeq` | Un tableau d'identités **local et non persisté** — un `.zmap` n'en sait rien — et `key={blockIds.current[index]}` à la place de `key={index}`. `data-row-index` reste l'**index** : les recherches DOM et l'insertion au caret en dépendent, c'est une coordonnée, pas une identité. |
| `move()` | Les identités **suivent le bloc déplacé** (`splice` de l'id en même temps que celui du bloc). C'est ce suivi, et lui seul, qui fait **déplacer le nœud** au lieu de réécrire son contenu — donc qui donne à `motion` quelque chose à animer. |
| La réconciliation | Volontairement simpliste (on garde les identités et on complète à la fin), et **c'est ce qui la rend sûre** : une insertion au milieu fait remonter le DERNIER bloc au lieu du nouveau, ce qui est invisible (les champs sont contrôlés) alors qu'un décalage ferait remonter le bloc qu'on est en train d'écrire — donc perdre le focus. |

**Deux tests verrouillent exactement les deux propriétés en jeu** : le nœud DOM est **le même** après un déplacement (`toBe`, donc il a été déplacé et non recréé — c'est le contrat dont `layout` dépend), et le focus **survit à une insertion au milieu** malgré les identités stables (le risque exact de la réconciliation).

**La leçon de méthode, déjà notée plus haut, s'est vérifiée** : les tests de focus existants (`focus après Entrée`, saisie) ont servi de filet pendant ce changement. C'est parce qu'ils existaient que j'ai pu toucher aux clés React sans casser la frappe — sur le drag & drop, où aucun test n'existe, j'ai travaillé à l'aveugle et il a fallu deux corrections.

### Réglage des familles déplacé dans le pied + « désactivé ici » lisible

| Demande | Ce qui a été fait |
|---|---|
| **Le bouton des familles en icône seule, dans la barre du bas à gauche de « Supprimer »** | L'état du réglage est **remonté dans `DescriptionDialog`** — il ne pouvait pas en être autrement : le bouton vit dans le pied de la modale, donc le réglage et sa commande doivent être au même endroit. `BlockEditor` reçoit maintenant `hiddenFamilies` en **prop** et ne possède plus rien ; `SymbolBand` n'a plus de bouton du tout. L'icône est un `LayoutGrid` dans un `Hint`, à gauche de « Supprimer » : c'est un réglage d'affichage, il ne doit donc ni se mêler au groupe d'actions de droite (Raccourcis, Fermer) ni concurrencer la seule action destructive. |
| **Griser les familles inapplicables pour dire « désactivé ici »** | Le grisage existait déjà, mais **il n'était pas lisible** : le navigateur, livré à lui-même, grise à peine, et la teinte de la famille mangeait ce qui restait. Correction : **la famille entière s'éteint** (`opacity`), sans rien ajouter sur les touches — la couleur suffit, et c'est ce qui distingue les touches d'une famille fermée de celles d'une famille ouverte. |

**Le point qui a demandé réflexion** : une infobulle **ne s'ouvre pas sur un bouton désactivé** (contrainte Radix documentée). Impossible donc d'expliquer le grisage au survol **des touches**. La raison est donc sur **le nom de la famille** (« Ces signes ne s'écrivent que dans une formule »), et — pour ceux qui n'ont pas de pointeur — dans le **nom accessible de chaque touche** (« Fraction — indisponible ici »). Pas de texte ajouté à l'écran : deux canaux, zéro encombrement.

**Trois tests ont dû être déplacés**, pas contournés : ceux qui réglaient les familles depuis le bandeau vivent maintenant dans `DescriptionDialog.test.tsx` (là où est le bouton et la persistance), et le test du bandeau se contente de lui **donner** des familles masquées et de vérifier qu'il obéit.

### Actions de tableau retirées du bandeau + seconde passe sur le glissement

| Demande | Ce qui a été fait |
|---|---|
| **Désactiver/retirer les actions « Tableau » du bandeau** | Le groupe **retiré**, pas désactivé : le tableau se gère dans le tableau (les `+` sur les frontières, les corbeilles au survol), donc ces trois boutons faisaient double emploi avec ce que l'utilisateur a sous les yeux. Le bandeau ne porte plus que des signes — `tableAction`, `TABLE_GROUP` et `BAND_ACTION` supprimés, et **trois tests qui cliquaient ces boutons ont été repointés sur les poignées de la grille** (ce qu'un utilisateur fait vraiment). |

**Seconde passe sur le glissement**, à partir de tes deux symptômes — et ils n'en font qu'un :

> curseur « interdit » partout **et** aucun ghost.

Un navigateur n'accepte un dépôt que si la cible a annulé le `dragover` ; si **aucune** cible ne l'accepte, le curseur est « interdit » sur toute la page. Cela n'arrive que si l'état du glissement n'a jamais été enregistré — donc si `onDragStart` s'est **interrompu avant la fin**. Or ce handler appelait `setDragImage` **avant** `setData` et avant d'enregistrer l'état, et Chromium refuse de photographier un élément transformé (`motion` en pose un). Une exception là-dedans explique **les deux** symptômes d'un coup : pas de ghost, et aucun dépôt accepté nulle part.

| Correctif | Pourquoi |
|---|---|
| `setDragImage` sous `try`/`catch` | Une exception ici ne peut plus empêcher `setData` ni l'enregistrement de l'état. Le ghost par défaut du navigateur est moins joli, mais le glissement fonctionne — un confort visuel ne doit jamais être une condition du fonctionnement. |
| `preventDefault` **inconditionnel** sur `dragover` | Même si l'état n'est pas enregistré, la cible accepte le survol : plus de « interdit » partout. Le `drop` vérifie toujours `dragFrom` avant de déplacer, donc accepter le survol n'engage à rien. |

Vérification : `tsc` propre, **146 fichiers / 2061 tests**.

⚠️ **Toujours pas vérifiable de mon côté** : jsdom n'implémente pas le drag & drop HTML5. Ces deux correctifs traitent la cause la plus probable, mais **seule l'app peut confirmer**. Si le glissement ne part toujours pas, la prochaine étape est de remplacer le DnD natif par des **pointer events** : c'est ce qui donnerait le « ghost » que tu décris (un aperçu qu'on contrôle, qui suit le curseur *pendant* le geste), et — non des moindres — ce serait **enfin testable**, puisque les pointer events, eux, existent sous jsdom.

### Onglets du bandeau (1ʳᵉ étape) — fait

Vérification : `tsc` propre, **146 fichiers / 2063 tests**.

| Fichiers | Ce qui a été fait |
|---|---|
| `src/types/symbolBand.ts` | Les **deux formes de symbole** dans un seul type : `latex` devient **optionnel** (un caractère de langue n'a pas de forme LaTeX) et `closesWith`/`spaced` arrivent — c'est le comportement de **paire** (`¿…?`, `« … »`) repris tel quel, parce que l'aplatir serait une régression. `textOnly` sur la famille, exact inverse de `formulaOnly`. Et le type `SymbolTab`. |
| `src/content/symbolSets.ts` | **`SCIENCES_FAMILIES`** : Réactions (`⇌`, `⚗` `\ce`, `m/s` `\pu`), Grandeurs (`°C`, `µ`, `Ω`, `λ`, `ν`, `ρ`), Mesures (`≈`, `Δ`, `→`, `°`). Un onglet à part et non des familles de plus dans Maths : ce qu'on cherche en rédigeant une réaction n'est pas ce qu'on cherche en écrivant une inéquation. |
| `src/content/symbolTabs.ts` (nouveau) | `SYMBOL_TABS` : Mathématiques (`Sigma`), Sciences (`FlaskConical`), et `DEFAULT_TAB`. |
| `src/persistence/bandTab.ts` + tests | L'onglet resté ouvert, même contrat que les autres réglages. **`null` a un sens propre** : « aucun onglet ouvert » est un CHOIX, donc il se retient — sans quoi rouvrir la modale le rouvrirait tout seul. Un onglet inconnu (renommé, retiré) retombe sur le défaut au lieu de laisser un bandeau vide sans explication. |
| `src/content/SymbolBand.tsx` | **Ligne 1** : bloc visé + onglets. **Ligne 2+** : les familles de l'onglet ouvert. Cliquer l'onglet **déjà ouvert le referme** — un seul geste pour « ouvre » et pour « ne rien afficher ». `aria-pressed` et non `role="tab"` : le contenu n'est pas un vrai panneau d'onglets, le prétendre serait un mensonge pour un lecteur d'écran. |
| `src/content/BlockEditor.tsx` | L'état de l'onglet et sa persistance ; `textApply` (l'inverse de `structuresApply`) pour les familles de langue à venir. |

**⚠️ Les onglets de langue (Anglais / Espagnol / Français) ne sont PAS encore là, et c'est volontaire.** Leur contenu est prêt — `languageHelp` porte déjà les groupes, et les drapeaux sont déjà dessinés en SVG — mais les ajouter oblige à **retirer la palette d'accents du pied du bloc dans le même passage** : sinon les mêmes caractères existeraient à deux endroits. C'est l'étape suivante, avec la migration des tests de la palette de langue (comme je viens de le faire pour les boutons de tableau). C'est aussi ce qui supprimera **le dernier pied de bloc**, donc le dernier décalage.

**Un test instable à signaler** : `CardDetailPanel` › « edits through the same editor the card uses » a échoué **une fois** dans une suite complète (103 s), puis est repassé seul (1,4 s) **et** en suite complète (90 s). Ce n'est donc **pas** une régression de ce lot : c'est un test sensible à la charge, et je le note plutôt que de le passer sous silence.

### Glissement supprimé + colonne de droite réorganisée

| Demande | Ce qui a été fait |
|---|---|
| **Oublier le drag & drop des blocs** | La poignée de glissement **supprimée**, et tout son code avec : `dragFrom`/`dragOver`, `onDragOver`/`onDragLeave`/`onDrop`, `setDragImage`, l'opacité de l'élément en vol et le contour de cible de dépôt, les props de glissement du gutter, et l'import `GripVertical`. **Le déplacement par les flèches haut/bas reste**, et **l'animation de déplacement aussi** (`motion` en `layout="position"`, qui n'a jamais dépendu du glissement — elle dépend des clés stables). |
| **« Tableau » dans le sous-menu de type** | Le bouton `Columns3` de la colonne de droite supprimé ; `BlockKindMenu` propose maintenant **Texte / Formule / Tableau**, avec la coche sur le type courant. Pour un tableau, « Tableau » est **désactivé** (il l'est déjà) et « Texte » **ramène le contenu** — ce que plus rien ne permettait : le pied de tableau, qui s'en chargeait, avait disparu. Le handler distingue les deux gestes : « Tableau » **ajoute une colonne** (un bloc est déjà un tableau 1×1), les autres **convertissent** le contenu. |
| **« Supprimer » sous le menu de type** | Descendu du gutter vers la colonne de droite, sous le `BlockKindMenu`. Le gutter ne garde que le déplacement, et la corbeille garde la règle « jamais le dernier bloc ». Deux tests qui cliquaient le bouton « transformer en tableau » ont été **repointés sur le menu** (deux gestes au lieu d'un, comme l'utilisateur les fait). |

### Reste à faire (fin du Lot 3, puis Lot 6)

Voir § 6. Le Lot 5 exige les quatre décisions de § 4 ; le Lot 6 (#8+#9+#10 en forme plate) exige en plus une décision sur le versionnage du format. Le **Lot 4** (symboles mathématiques dans les blocs texte et les cellules de tableau) reste, de l'avis de tous les auditeurs, le gain produit le plus élevé — et il n'était dans aucune des 18 idées.

### Note d'hygiène de test

La suite contient des avertissements `act(...)` **préexistants** dans plusieurs fichiers non touchés ici (`PaletteKey`, `BlockEditor`, `FileTreeRow`, `CardNode`, `App`, `TestComponent`). Aucun avertissement `act(...)` n'est plus attribué à `MathFieldEditor` : les deux qui ont été introduits par ce lot ont été résorbés.
