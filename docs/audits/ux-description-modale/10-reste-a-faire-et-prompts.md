# Ce qu'il reste à faire — et les prompts à envoyer en session fraîche

État au moment de la rédaction, mesuré : `bunx tsc --noEmit` → *No errors found*.
`bunx vitest run` → **146 fichiers, 2062 tests passent, 1 échoue de façon intermittente**
(voir le lot 2 — c'est le premier à traiter).

Le journal complet de tout ce qui a été fait, avec ses preuves, est dans
`docs/audits/ux-description-modale/00-synthese.md` (§ 9, « Journal d'implémentation »).

---

## 1. Les onglets de langue, et la suppression du dernier pied de bloc

**Pourquoi c'est le premier.** Un bloc **texte** garde aujourd'hui un pied — la palette
d'accents (`BlockFooter` → `LanguageCharacterPalette`, `BlockEditor.tsx:916` et `:1194`).
C'est **la dernière** source du décalage de 120–190 px qu'on a supprimé partout ailleurs :
un bloc formule et un bloc tableau n'ont plus de pied du tout. Le supprimer est aussi ce qui
rend les onglets de langue cohérents, puisque les mêmes caractères ne doivent pas exister à
deux endroits.

**Ce qui est déjà prêt.** Le modèle d'onglets (`symbolTabs.ts`), la persistance de l'onglet
ouvrant (`persistence/bandTab.ts`), les deux formes de symbole (`PaletteSymbol` accepte
`latex` optionnel, `closesWith`, `spaced`), et `SymbolFamily.textOnly` — tout est en place et
testé, il ne manque que les données et le retrait du pied.

```
Contexte : dépôt Zachar't-Mentale (Tauri + React/TS, PAS un monorepo). Lis d'abord
`CLAUDE.md`, puis `docs/audits/ux-description-modale/00-synthese.md` (§ 9, journal
d'implémentation) et `10-reste-a-faire-et-prompts.md`. Ne modifie aucun autre fichier que
ceux nécessaires.

Objectif : ajouter les onglets Anglais / Espagnol / Français au bandeau de symboles, et
supprimer le pied de bloc qui devient alors redondant.

Contexte technique à respecter :
- `src/content/symbolTabs.ts` porte `SYMBOL_TABS` (aujourd'hui Maths + Sciences) et
  `DEFAULT_TAB`. Les onglets de langue y prennent `icon: null` : leur visuel est un
  DRAPEAU, déjà dessiné en SVG par `LanguageFlag` dans `LanguageHelpPalette.tsx` — un
  emoji drapeau s'affiche « GB » sur Windows, donc surtout pas d'emoji.
- `languageHelp.ts` porte déjà les groupes (`LANGUAGES`, des `CharacterGroup` de
  `SpecialCharacter`). Il faut les convertir en `SymbolFamily` : `glyph ← char`,
  `textOnly: true`, et `closesWith`/`spaced` repris TELS QUELS — les paires `¿…?` et
  `« … »` s'écrivent d'un seul clic avec le curseur au milieu, c'est testé, et les aplatir
  serait une régression. La teinte d'une famille est un index dans `GROUP_TONES`.
- `SymbolBand` sait déjà griser une famille `textOnly` hors d'un texte (via la prop
  `textApply`), et `insertSymbol` gère déjà l'absence de `latex`.
- Retirer ensuite : le rendu de `BlockFooter` (`BlockEditor.tsx:916`), la définition de
  `BlockFooter` (`:1194`), l'état `language` (`:360`), et l'import de
  `LanguageCharacterPalette` s'il devient inutile. `insertText` reste (les onglets de
  langue passent par lui, paires comprises).

Tests à migrer (ils encodent l'ancienne structure, ne les contourne pas) :
- `BlockEditor.test.tsx`, describe « the character palette, in the footer of the text block »
  (~8 tests) : ils cliquent un bouton de langue puis un caractère. Le nouveau geste est
  « cliquer l'onglet, puis le caractère ». Les noms accessibles des caractères sont
  conservés, donc la plupart des requêtes tiennent.
- `DescriptionDialog.test.tsx`, les tests qui passent par la palette d'accents.
- Ajoute un test qui verrouille la propriété nouvelle : plus AUCUN pied de bloc n'existe,
  donc changer de bloc actif ne déplace plus rien (c'est le but du chantier).

Vérification obligatoire, avant de dire que c'est fini :
- `bunx tsc --noEmit` → aucune erreur
- `bunx vitest run` → tout vert (sauf l'instabilité connue du lot 2, décrite dans
  `10-reste-a-faire-et-prompts.md` : si `CardDetailPanel › « edits through the same editor »`
  échoue, relance — ne le « répare » pas ici).

Contraintes : ne touche PAS au format de fichier `.zmap`. Ne remets pas de glisser-déposer
des blocs (il a été retiré volontairement). Garde les commentaires explicatifs dans le style
du dépôt : ils disent POURQUOI, pas quoi.
```

---

## 2. L'instabilité du test, et la mémoïsation du bandeau

**Pourquoi c'est prioritaire.** Une suite qui échoue au hasard ne sert plus à rien : elle
apprend à ignorer le rouge. Et il y a derrière un vrai problème de performance.

```
Contexte : dépôt Zachar't-Mentale (Tauri + React/TS). Lis `CLAUDE.md` puis
`docs/audits/ux-description-modale/10-reste-a-faire-et-prompts.md`.

Symptôme, avec le diagnostic que j'ai fini par établir (vérifie-le, mais il tient) :
`src/components/detail/CardDetailPanel.test.tsx` › « edits through the same editor the card
uses, and writes to the store » PASSE seul (1,4 s) mais échoue dans TOUTE suite complète
(4 fois sur 4, ~5,4 s à chaque fois).

CE N'EST PAS UNE ASSERTION FAUSSE, C'EST UN DÉPASSEMENT DE DÉLAI : `vitest` coupe un test
à 5 000 ms par défaut, et le test échoue à 5 403 ms. Autrement dit la FRAPPE est devenue
trop lente — taper 8 caractères prend plus de 5 secondes, donc chaque frappe coûte ~600 ms.
C'est un vrai problème de performance de l'app, révélé par un test, pas un test fragile.

Deux suspects, par ordre de probabilité :
1. **`motion` en `layout="position"` sur chaque bloc** (ajouté pour l'animation de
   déplacement). L'animation de mise en page force une MESURE de position par bloc à chaque
   rendu — donc un reflux synchrone à chaque frappe. C'est le suspect le plus sérieux.
2. Le bandeau qui re-rend à chaque frappe (onglets + 7 familles × ~5 touches, chacune dans un
   déclencheur de tooltip Radix).

Hypothèse à VÉRIFIER (pas à supposer) : le bandeau de symboles re-rend à chaque frappe —
il rend les onglets plus 7 familles × ~5 touches, chacune dans un déclencheur de tooltip
Radix — donc chaque frappe du test coûte plus cher, et il finit par dépasser son budget de
temps implicite.

Ce que je veux :
1. D'abord MESURER : chronomètre un rendu du bandeau, et vérifie si le nombre de rendus
   pendant la frappe est anormal. Dis-moi ce que tu mesures.
2. Si c'est bien la charge : MÉMOÏSER plutôt que durcir le test. `SymbolBand` ne dépend que
   de `targetLabel`, `kind`, `symbolsApply`, `structuresApply`, `textApply`,
   `hiddenFamilies`, `activeTab` et des rappels — il n'a aucune raison de se re-rendre à
   chaque caractère tapé. `React.memo` + des rappels stables (`useCallback`) sont le bon
   correctif, et c'est un gain réel, pas un pansement.
3. Si ce n'est PAS la charge : cherche la vraie cause (une attente implicite, un état
   partagé entre tests, un minuteur) et corrige-la, ou durcis le test en expliquant
   pourquoi le test était faux.

Vérification obligatoire : `bunx tsc --noEmit` sans erreur, et `bunx vitest run` lancé
**au moins 3 fois de suite** tout vert. C'est la répétition qui prouve qu'une instabilité
est réglée, pas un seul passage.
```

---

## 3. Le panneau des raccourcis ment, et `$$` convertit trop

Deux défauts réels trouvés par l'audit, jamais corrigés, et ils sont du même genre : du texte
qui promet autre chose que ce que le code fait.

```
Contexte : dépôt Zachar't-Mentale (Tauri + React/TS). Lis `CLAUDE.md`, le rapport
`docs/audits/ux-description-modale/03-expert-ux.md` (§ « #3 » et « conflits de modèle
mental ») puis `10-reste-a-faire-et-prompts.md`.

Deux corrections indépendantes, dans l'ordre :

1. LE PANNEAU DES RACCOURCIS MENT. `ShortcutsPanel` (`DescriptionDialog.tsx`, autour de la
   ligne 727) code ses libellés EN DUR : « Entrée — Nouveau bloc », « Maj + Entrée — Retour
   à la ligne ». Or c'est déjà faux dans 2 surfaces sur 4 : dans le champ TITRE, Entrée
   valide le renommage (`DescriptionDialog.tsx:355-361`) ; dans une CELLULE de tableau,
   Entrée ajoute une ligne (`BlockEditor.tsx`, `TableCellField`). Fais dire au panneau ce
   qui est vrai LÀ OÙ ON EST, ou limite-le explicitement aux surfaces où il dit vrai — mais
   ne le laisse pas mentir.

2. `$$` AVALE LA PHRASE. `BlockEditor.tsx` (cherche `endsWith('$$')`) convertit le bloc
   entier en formule dès que le texte se termine par `$$`. Donc une phrase qui finit
   légitimement par « … coûte 5$$ » devient une formule LaTeX. Limite la conversion à ce
   qui est voulu : un bloc VIDE, ou `$$` seule sur sa ligne. Écris le test qui le prouve
   dans les deux sens (la phrase survit, le bloc vide se convertit).

Vérification obligatoire : `bunx tsc --noEmit` sans erreur, `bunx vitest run` tout vert.
```

---

## 4. Finir la migration des tooltips (#17) sur les autres écrans

Ici, commence par **vérifier**, parce que je me suis trompé deux fois sur le décompte de ce
qui restait : mes `grep` comptaient des **props de composants** (`SettingsSection title=`,
`NameDialog title=`, `ConfirmDeleteDialog title=`) comme des attributs DOM.

```
Contexte : dépôt Zachar't-Mentale (Tauri + React/TS). Lis `CLAUDE.md` puis
`10-reste-a-faire-et-prompts.md`.

Objectif : finir la migration `title=` → tooltip de l'app, sur les écrans AUTRES que la
modale de description (déjà faite).

Méthode imposée, parce que c'est là que je me suis trompé : pour CHAQUE occurrence de
`title=`, ouvre le fichier et détermine si c'est
  (a) un attribut DOM sur un contrôle interactif  → à convertir,
  (b) un attribut DOM sur un élément NON interactif (un `<span>` décoratif porteur
      d'information)  → souvent à LAISSER, un `title` natif y est légitime,
  (c) une PROP de composant (`<Dialog title=…>`, `<SettingsSection title=…>`) → rien à faire.
Annonce ton inventaire (fichier:ligne → a/b/c) AVANT de modifier quoi que ce soit.

À convertir avec le composant partagé `Hint` (`src/components/ui/hint.tsx`) : chaque surface
doit avoir UN SEUL `TooltipProvider` (un par bouton fait clignoter les infobulles), et le
`aria-label` du contrôle doit être CONSERVÉ — un tooltip n'est pas un nom accessible.

Fichiers à examiner au minimum : `src/components/sidebar/FileTreeRow.tsx`,
`src/components/sidebar/FileSidebar.tsx`, `src/components/toolbar/AppToolbar.tsx`,
`src/components/CardNode.tsx`, `src/App.tsx`, `src/components/quiz/QuizConfigModal.tsx`,
`src/components/settings/SyncSettingsPanel.tsx`, `src/components/RecentFilesList.tsx`.

DEUX PIÈGES CONNUS, à traiter explicitement :
- Une infobulle NE S'OUVRE PAS sur un `<button disabled>` (contrainte Radix) : si
  l'explication est sur un contrôle désactivé, elle doit aller ailleurs (le libellé, un
  `aria-label`, un conteneur non désactivé), sinon elle disparaît.
- Sur un contrôle `disabled`, `aria-label` reste annoncé : ne le retire jamais.

N'écris pas de tooltip sur un bouton qui porte DÉJÀ son libellé visible (« Ajouter un
bloc ») : c'est du bruit.

Vérification : `bunx tsc --noEmit` sans erreur, `bunx vitest run` tout vert.
```

---

## 5. Lot 6 — les blocs « question » en forme PLATE (exige une décision produit)

**À ne pas commencer sans avoir posé la question.** C'est le seul lot qui touche le **format
de fichier**, donc le seul qui peut faire perdre des données chez un utilisateur qui n'a pas
mis à jour.

```
Contexte : dépôt Zachar't-Mentale (Tauri + React/TS). Lis `CLAUDE.md`, puis
`docs/audits/ux-description-modale/08-expert-technique.md` (§ « Chantier architectural »)
et `10-reste-a-faire-et-prompts.md`.

Objectif : permettre de regrouper des blocs sous une « question » (ou tout en-tête de
groupe), SANS arbre récursif.

AVANT TOUTE LIGNE DE CODE, tu dois faire trancher DEUX décisions par l'utilisateur, et tu ne
codes rien tant qu'il n'a pas répondu :
  1. Le format `.zmap` n'est PAS versionné. Un `kind` inconnu est aplati en texte par
     `sanitizeBlock` (`src/content/blocks.ts`) et la première écriture rend la perte
     DÉFINITIVE. Accepte-t-on ce risque, ou introduit-on un `formatVersion` qui fait
     REFUSER d'écrire à une version ancienne plutôt que d'aplatir ? (Précédent dans le
     dépôt : `syncState.ts` refuse de lire une version future.)
  2. `admin/` importe le MÊME validateur (`admin/src/lib/quality.ts` →
     `@app/validation/cardsValidation`), donc une carte passée par « Réparer » depuis le
     panneau prof ressortirait aplatie. Qui met à jour `admin/` et son test ?

La forme à viser (celle que je recommande, dictée par la contrainte ci-dessus) : un bloc PLAT
`{ kind: 'question', text }` qui OUVRE un groupe — les blocs suivants jusqu'au prochain
en-tête lui appartiennent par convention de RENDU (bordure et fond teintés sur la plage).
Pas d'enfants imbriqués. Conséquences : `sanitizeBlock` gagne UN cas plat,
`blocksToPlainText` reste linéaire (donc le miroir quiz / XMind / PDF reste exact),
`moveBlock` et l'undo local ne changent pas, et une version ancienne perd le STYLE, pas le
texte.

PIÈGE À NE PAS OUBLIER : `sanitizeBlock` reconstruit chaque bloc champ par champ. Tout
nouveau champ non ajouté à CHAQUE branche (et à `cloneBlock`) est supprimé silencieusement
par le chemin de réparation partagé. Écris le test « un bloc X avec le nouveau champ survit
à `sanitizeBlocks` » AVANT le reste.

Vérification : `bunx tsc --noEmit` sans erreur, `bunx vitest run` tout vert, plus
`bun run test:admin` si `admin/` est touché.
```

---

## Idées non planifiées (à ne pas traiter sans le demandeur)

- **Le quiz n'interroge que le titre, jamais la définition.** C'est pourtant la définition
  qu'on écrit ici. Le champ « à trous » existe déjà (`BlankFillField`, pour le titre).
  C'est une fonctionnalité, pas un correctif — elle mérite sa propre décision.
- **L'insertion au caret dans le champ LaTeX de secours** : quand MathLive n'est pas chargé,
  un symbole du bandeau est ajouté À LA FIN au lieu d'être inséré au caret, parce que le
  `<textarea>` appartient à l'appelant. Le corriger demande de faire passer une ref du champ
  de secours de l'appelant au composant — un changement d'API sur `MathFieldEditor` et ses
  deux appelants. Le cas ne se produit plus que sur une machine où MathLive échoue.
- **L'onglet « Sciences » attend son vrai contenu** : les signes actuels (⇌, °C, µ, Ω, λ, ν,
  ρ, ≈, Δ, →, °, `\ce`, `\pu`) sont ma proposition, pas une liste validée par un professeur.
- **Les infobulles de l'app se ferment dès que la souris quitte le déclencheur**, ce qui
  enfreint WCAG 1.4.13 (« Hoverable »). C'est un choix ASSUMÉ et verrouillé par un test
  (`src/components/ui/tooltip.test.tsx`), confirmé par le demandeur. À ne pas « corriger »
  au passage.

---

## Deux choses à savoir avant de toucher à ce dépôt

1. **Ce qui n'est pas vérifiable en test** : jsdom n'implémente ni le glisser-déposer HTML5,
   ni la mise en page, ni les animations. Donc **le rendu visuel, les animations et tout
   glisser-déposer doivent être confirmés dans l'app** — c'est ce qui a coûté trois
   corrections successives à l'aveugle sur le glissement des blocs, avant qu'il soit
   finalement retiré.
2. **La suite a un test instable connu** (lot 2 ci-dessus). S'il échoue, relance d'abord :
   ne le « répare » pas en croyant à une régression de ton lot.
