# Recherche de cartes & capture rapide — Design

**Date** : 2026-09-20
**Statut** : Validé, en attente du plan d'implémentation
**Sous-projet** : B (sur A/B/D — voir la session de brainstorming du
2026-09-20 pour les deux autres)

## Contexte

L'élève prend des notes et fait des exercices à même l'app pendant les
séances, et son parent (l'auteur du projet) a du mal, une fois la carte
mentale devenue grande, à **retrouver** où un exercice donné a été rangé.

Deux besoins avaient été identifiés en amont (« noter vite » et
« retrouver après coup »), mais l'un des deux existe déjà : la commande
`card.addFloating` (créer une carte volante) centre déjà la vue dessus et
place le curseur dans son titre pour une saisie immédiate — voir
`docs/superpowers/specs/2026-09-07-restructuration-et-brouillon-design.md`.
Ce lot ne construit donc que ce qui manque réellement :

1. Une **recherche de cartes** dans la carte mentale ouverte (inexistante
   aujourd'hui — la palette de commandes ne cherche que les actions de
   l'app, jamais le contenu des cartes).
2. Deux ajustements de friction sur la capture déjà existante : la touche
   par défaut de `card.addFloating` (`Inser`, peu fiable sur un clavier de
   portable AZERTY où elle est souvent derrière `Fn`) et la discrétion de
   son bouton dans la barre d'outils.

**Explicitement hors périmètre** : recherche à travers plusieurs fichiers
(seule la carte ouverte est cherchée — voir Décisions de cadrage) ; suivi
de progression / répétition espacée (sous-projet A, à venir) ; confort
sensoriel / focus (sous-projet D, à venir).

## Décisions de cadrage

1. **La recherche porte uniquement sur la carte mentale ouverte**, pas sur
   l'arborescence de fichiers. Retrouver un exercice dans un autre fichier
   reste un problème de navigation de fichiers, pas de cette recherche.
2. **Champs cherchés** : `card.title` et `card.definition` (le miroir texte
   toujours présent, y compris quand la carte a du contenu riche — voir
   `src/types/card.ts`). Pas de recherche dans les blocs `content` bruts :
   `definition` en est déjà la projection texte.
3. **Les cartes volantes sont incluses** dans la recherche — c'est
   justement la zone où atterrissent les notes prises vite.
4. **Recherche désactivée pendant un quiz actif** (`locked` via le quiz),
   comme les autres affordances structurelles : retrouver une carte
   pendant un quiz reviendrait à donner la réponse.
5. **Pas de nouvel index ni de persistance** : la recherche filtre le
   tableau `cards` déjà en mémoire à chaque frappe. Avec les volumes de
   cartes en jeu ici, un filtrage linéaire à chaque frappe est instantané ;
   pas de debounce nécessaire.

## Recherche de cartes

### Algorithme de classement — `src/search/textSearch.ts` (nouveau)

Extrait de `CommandPalette.tsx` (`fold` + `scoreCommand`) dans un module
partagé, pour que les deux recherches (commandes, cartes) classent de la
même façon :

```ts
export function fold(text: string): string
export function matchScore(haystack: string, query: string): number | null
```

`CommandPalette.tsx` est mis à jour pour consommer ce module au lieu de sa
propre copie — aucun changement de comportement pour la palette de
commandes.

Nouvelle fonction `scoreCard(card: Card, query: string): number | null` :
même principe que `scoreCommand` — un hit sur `title` prime sur un hit
dans `definition`, un hit plus tôt prime sur un hit plus tard.

### Composant `CardSearchBar` — `src/components/search/CardSearchBar.tsx`

- Barre semi-transparente ancrée en bas du canvas (comme le dock du
  minimap), qui s'agrandit légèrement au clic et pendant la frappe.
- Liste de résultats sous la barre (masquée si `query === ''`), triés par
  score, chacun affichant : la pastille de couleur du niveau
  (`levelColors`), le fil d'ariane des titres parents (racine → parent
  direct), et un court extrait du champ où le texte a été trouvé.
- Clic sur une ligne de résultat : sélectionne la carte et centre la vue
  dessus (réutilise `focusCard`/`setCenter`, le même mécanisme que la
  navigation clavier entre cartes dans `MindMapCanvas.tsx`). La barre reste
  ouverte (l'élève peut enchaîner plusieurs recherches).
- Bouton secondaire par ligne (icône fiche) : centre la vue **et** ouvre le
  panneau de détail (réutilise l'action de `card.openFiche`).
- `Échap` ferme la recherche et rend le focus au canvas.
- Rendu conditionné à `!quizActive` — complètement absente du DOM pendant
  un quiz, pas seulement désactivée.

## Recherche contextuelle (Ctrl+F)

### Nouvelles commandes — `src/types/commands.ts`

| id | catégorie | binding par défaut | changement |
| --- | --- | --- | --- |
| `view.findInTree` | view | `null` (était `Mod+F`) | binding par défaut retiré |
| `view.findInCards` | view | `null` | nouvelle commande |
| `app.find` | app | `Mod+F` | nouvelle commande, contextuelle |

`view.findInTree` et `view.findInCards` restent chacune invocables
individuellement depuis la palette de commandes (comme `sync.now` ou
`file.delete`, déjà sans touche par défaut) — seul le point d'entrée
clavier change. `view.findInCards` est enregistrée avec `enabled:
!quizActive` (même garde que le montage de `CardSearchBar`), pour que la
palette de commandes la grise aussi pendant un quiz plutôt que de la
laisser silencieusement ne rien faire.

### Dispatch — `app.find`

Enregistrée au niveau `App.tsx` (le seul composant qui voit à la fois la
sidebar et le canvas). Algorithme, dans l'ordre :

1. Si `document.activeElement` est le champ de recherche de
   l'arborescence → exécute `view.findInCards` (bascule vers l'autre zone).
2. Sinon si `document.activeElement` est le champ `CardSearchBar` →
   exécute `view.findInTree` (bascule).
3. Sinon si `document.activeElement` est contenu dans la sidebar
   (`closest('[data-focus-zone="sidebar"]')`, attribut posé sur le
   conteneur racine de `FileSidebar`) → exécute `view.findInTree`.
4. Sinon (canvas, ou contexte ambigu) → exécute `view.findInCards`, **sauf
   si un quiz est actif**, auquel cas retombe sur `view.findInTree` (la
   recherche de cartes n'existe pas pendant un quiz).

Les étapes 1-2 dépendent uniquement de l'élément actuellement focus (pas
d'état partagé supplémentaire à maintenir) : c'est ce qui permet à des
appuis répétés sur Ctrl+F de faire l'aller-retour entre les deux zones.

`allowInQuiz: true` sur `app.find` — la commande reste utile pendant un
quiz (retrouver un fichier), même si elle ne peut plus router vers la
recherche de cartes dans ce cas.

## Ajustements sur `card.addFloating`

- `defaultBinding` : `'Inser'` → `'N'`. Cohérent avec `Tab`/`Entrée`/
  `Maj+Entrée` déjà utilisés seuls pour créer une carte (`scope: 'canvas'`,
  donc sans effet pendant la saisie d'un champ texte).
- `AppToolbar.tsx` : le bouton `card.addFloating` sort du groupe d'icônes
  et devient un bouton avec libellé texte visible (« Carte volante »), pour
  gagner en repérabilité plutôt qu'en sobriété visuelle.

## Cas limites

- **Aucun résultat** : la liste affiche un message (« Aucune carte ne
  correspond à « {query} » »), même gabarit que la palette de commandes.
- **Carte sélectionnée pendant la frappe** : la recherche n'affecte la
  sélection courante tant qu'aucun résultat n'est cliqué — les raccourcis
  `scope: 'canvas'` (Tab, flèches…) restent inertes puisque le focus est
  dans le champ de recherche, pas sur le canvas.
- **Carte volante sans titre ni définition** (juste créée) : n'apparaît
  dans aucun résultat tant qu'elle est vide — comportement normal du
  filtrage, rien à coder spécifiquement.
- **Sidebar repliée** quand `view.findInTree` se déclenche via `app.find` :
  même comportement que l'existant (`setCollapsed(false)` avant de
  focaliser le champ).

## Tests

- `textSearch.test.ts` : `fold` (accents, casse), `matchScore` (hit label
  vs description, position).
- `CommandPalette.test.tsx` : non-régression après le passage au module
  partagé (les tests existants sur `scoreCommand` continuent de passer via
  un alias, ou sont migrés vers `matchScore` directement).
- `cardSearch.test.ts` (ou inline dans `CardSearchBar.test.tsx`) :
  `scoreCard` classe titre avant définition ; les cartes volantes sont
  incluses ; une carte sans texte ne matche que la requête vide.
- `CardSearchBar.test.tsx` : liste vide sur requête vide, résultats triés,
  clic centre + sélectionne, bouton fiche centre + ouvre le panneau,
  absente du DOM quand un quiz est actif, `Échap` ferme et rend le focus.
- `App.find.test.tsx` (ou intégré aux tests d'`App.tsx`) : les quatre
  branches du dispatch (focus sur champ arbre → cartes, focus sur champ
  cartes → arbre, focus dans la sidebar hors champ → arbre, focus ailleurs
  → cartes), et la retombée sur l'arbre quand un quiz est actif.
- Non-régression `card.addFloating` : les tests qui référencent `'Inser'`
  comme binding par défaut (`MindMapCanvas.shortcuts.test.tsx` notamment)
  sont mis à jour pour `'N'`.
- `AppToolbar.test.tsx` : le bouton carte volante expose son libellé texte.

## Fichiers touchés

Nouveaux : `src/search/textSearch.ts` (+ test), `src/components/search/CardSearchBar.tsx`
(+ test), et un éventuel `src/search/scoreCard.ts` si séparé de
`CardSearchBar.tsx`.

Modifiés : `src/components/commands/CommandPalette.tsx`, `src/types/commands.ts`,
`src/App.tsx`, `src/components/sidebar/FileSidebar.tsx` (attribut
`data-focus-zone`), `src/components/MindMapCanvas.tsx` (montage de
`CardSearchBar`), `src/components/toolbar/AppToolbar.tsx`,
`src/components/MindMapCanvas.shortcuts.test.tsx`.
