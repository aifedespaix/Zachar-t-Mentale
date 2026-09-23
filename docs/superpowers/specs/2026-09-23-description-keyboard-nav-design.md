# Navigation clavier de la description (formules & équations) — Design

**Date** : 2026-09-23
**Statut** : Validé en conversation, en attente de relecture de la spec
**Périmètre** : la modale de description (`DescriptionDialog` → `BlockEditor`),
blocs texte, question, formule et équation. Les tableaux et les images sont
hors périmètre (voir « Hors périmètre »).

## Contexte et objectif

L'élève écrit ses exercices dans la description d'une carte : des phrases, des
formules sur plusieurs lignes, des équations résolues étape par étape. Il doit
pouvoir **tout faire au clavier sans jamais être surpris** : se déplacer d'un
champ à l'autre avec les flèches, créer une ligne, une étape ou un bloc avec la
bonne variante d'Entrée, effacer sans jamais perdre ce qu'il n'a pas voulu
effacer.

Critères de succès :

- Les flèches ne sont **jamais une impasse** : au bord d'un champ, elles mènent
  au champ voisin, puis au bloc voisin — toujours en deux temps
  (`aaa|b` → `aaab|` → champ suivant).
- Les flèches **ne cassent plus** la navigation interne de MathLive (fractions,
  exposants).
- **Aucune perte de donnée** par Retour arrière / Suppr, ni par répétition de
  touche maintenue.
- Une seule règle par touche, identique d'un type de bloc à l'autre, là où le
  type le permet.

## Constats sur le code actuel (2026-09-23, v1.20.3)

1. **Perte de données** — `MathLinesField` appelle `onEmptyBackspace` dès que
   la ligne 1 est vide, sans regarder les autres : Retour arrière sur la ligne
   vide de `["", "x=2"]` supprime tout le bloc, `x=2` compris. Même chose pour
   Suppr sur une dernière ligne vide.
2. **Fractions cassées** — dans une formule multi-ligne, `MathFieldEditor`
   intercepte ↑/↓ en capture, avant MathLive : ↑ dans un dénominateur saute à
   la ligne du dessus au lieu d'aller au numérateur.
3. **« Résolu » trop large** — `equationStepIsSolved` se contente d'une
   variable seule d'un côté : `x = 2x + 3` et `x = ` (vide) passent en vert.
4. **Rafale** — Retour arrière maintenu pour vider un champ traverse la
   frontière et continue d'effacer dans le champ ou le bloc précédent.
5. **Impasses** — ←/→ ne sortent jamais d'un champ ; ↑/↓ sont avalés aux
   extrémités d'une formule ; dans une équation ↓ saute l'opération ; Retour
   arrière au début d'un membre gauche non vide ne fait rien.

MathLive (`^0.110`) émet `move-out` (`detail.direction` :
`forward | backward | upward | downward`, annulable) quand une flèche ou Tab ne
peut plus rien parcourir dans le champ. C'est le point d'accroche de toute la
navigation : le « deux temps » en découle, et la navigation interne reste
intacte.

## Décisions

### Ce qui est conservé

- Entrée dans une formule coupe la ligne au curseur.
- Retour arrière au début d'une ligne de formule ≥ 2 la fusionne avec la
  précédente, curseur à la jointure ; Suppr en fin la fusionne avec la
  suivante.
- Entrée dans une équation ajoute une étape après l'étape courante, focus sur
  son membre gauche.
- Entrée dans un texte = retour à la ligne. Maj+Entrée dans MathLive lui reste
  (matrices).
- Retour arrière / Suppr sur un bloc **entièrement** vide le supprime et rend
  le curseur au voisin (`deleteEmptyAt` / `deleteForwardAt`).
- Suppr en fin d'opération supprime l'étape suivante si elle est vide.
- « Résolu » ne concerne que la dernière étape.
- Alt+↑/↓, Alt+D, Alt+Q, Alt+chiffre, Tab (type de bloc, dans un texte),
  `*`/`/` → `\times`/`\div` dans l'opération.

### Ce qui est retiré

- L'interception de ↑/↓ avant MathLive (remplacée par `move-out`).
- La règle « aux extrémités, la flèche est avalée, jamais un autre bloc ».
- La suppression d'un bloc formule depuis une ligne vide alors que d'autres
  lignes ont du contenu.
- La détection « une variable seule d'un côté suffit ».
- Le sens actuel de Ctrl+Maj+Entrée (« un bloc tout en bas, hors groupe »).

### Ce qui est ajouté ou modifié

Voir le tableau des touches ci-dessous — c'est la référence normative, et la
base des tests.

## Tableau des touches (référence)

Conventions :

- **« Au bord »** = curseur en tout début (ou toute fin) du champ, sans
  sélection.
- **Descendre / avancer pose le curseur au début** du champ d'arrivée ;
  **monter / reculer le pose à la fin**.
- **Bloc navigable** = texte, question, formule, équation. Images et tableaux
  sont sautés par la navigation.

### Commun à tous les blocs

| Touche | Effet |
|---|---|
| Ctrl/Cmd+Entrée | Nouveau bloc **hors groupe**, juste après le groupe courant (juste après le bloc s'il n'est pas dans un groupe). Type hérité via `inheritableKind`. Porte `standalone: true` quand il suit une question (voir `appendOutside`). |
| Ctrl/Cmd+Maj+Entrée | Nouveau bloc **dans le groupe**, juste après le bloc courant (= `insertBlockAfter(index, …)`). |
| Ctrl+Entrée depuis un élément de l'éditeur qui n'est pas un champ de saisie (bouton de gouttière, etc.) | `appendOutside()` — comme le bouton « Ajouter un bloc » du pied. Le libellé du menu du vide (`EmptyAreaContextMenu`) devient « Ctrl + Entrée ». Même portée que l'ancien Ctrl+Maj+Entrée : l'écouteur de la racine de `BlockEditor`. |
| Sortie haut / gauche d'un bloc | Bloc navigable précédent, dernier champ, curseur à la fin. |
| Sortie bas / droite d'un bloc | Bloc navigable suivant, premier champ, curseur au début. |
| Aucun bloc navigable dans cette direction | La touche est avalée. |
| Retour arrière / Suppr au bord d'un bloc | Supprime le bloc s'il est entièrement vide ; sinon **rien** (jamais de fusion ni de saut entre deux blocs). |
| Anti-rafale | Si `event.repeat`, Retour arrière / Suppr **au bord** sont avalés (aucun franchissement, fusion ni suppression). Les flèches répétées circulent normalement. |

### Bloc texte

| Touche | Effet |
|---|---|
| ← en position 0 | Sortie gauche. |
| → en fin | Sortie droite. |
| ↑ | Natif ; si le curseur est **déjà** en position 0 → sortie haut. |
| ↓ | Natif ; si le curseur est **déjà** en fin → sortie bas. |
| Entrée / Maj+Entrée | Retour à la ligne (natif). |
| Retour arrière / Suppr au bord | Règle commune. |
| Tab / Maj+Tab | Type suivant / précédent (inchangé). |

### En-tête de question

Comme le texte, sauf :

| Touche | Effet |
|---|---|
| Entrée | Passe dans le corps : si le bloc suivant est un texte vide du groupe, focus dessus ; sinon insère un bloc texte vide juste après l'en-tête et le focalise. Jamais de coupure du titre. |
| Maj+Entrée | Retour à la ligne dans le titre. |
| Ctrl+Maj+Entrée | Identique à Entrée. |

### Formule (une ou plusieurs lignes)

| Touche | Effet |
|---|---|
| ← / → | MathLive. Sur `move-out` backward/forward : ligne précédente (fin) / suivante (début) ; aux extrémités, sortie de bloc. |
| ↑ / ↓ | MathLive (numérateur ↔ dénominateur…). Sur `move-out` upward/downward : ligne précédente (fin) / suivante (début) ; aux extrémités, sortie de bloc. |
| Entrée | Coupe la ligne au curseur (inchangé). |
| Maj+Entrée | MathLive. |
| Retour arrière au début, ligne ≥ 2 | Fusion avec la précédente (inchangé). |
| Retour arrière au début, ligne 1 | Supprime le bloc **seulement si toutes les lignes sont vides** ; sinon rien. |
| Suppr en fin, ligne < dernière | Fusion avec la suivante (inchangé). |
| Suppr en fin, dernière ligne | Même règle que Retour arrière en ligne 1. |
| Tab | MathLive (cases à remplir). Un `move-out` issu de Tab est laissé tel quel. |

Le repli LaTeX brut (`<textarea>`/`<input>`) reproduit la même règle à partir
de `selectionStart/End` : ←/→ au bord et ↑/↓ (le champ brut est mono-ligne par
ligne de formule) déclenchent la même sortie que `move-out`.

### Équation

Ordre de lecture : `G₀ D₀ Op₀ G₁ D₁ Op₁ … Gₙ Dₙ [Opₙ]` (G = membre gauche,
D = membre droit, Op = opération qui suit l'étape).

**Visibilité de Opₙ** (opération après la dernière étape) : visible, sauf si la
dernière étape est résolue **et** Opₙ est vide. Un contenu saisi n'est jamais
masqué. Les Opᵢ (i < n) restent toujours visibles (bouton « + Opération » quand
vides). La navigation ignore un Opₙ caché.

| Touche | Effet |
|---|---|
| → en fin / ← au début | Champ suivant / précédent dans l'ordre de lecture ; au-delà de `G₀` ou du dernier champ visible, sortie de bloc. Dans G/D, déclenché par `move-out` forward/backward. |
| Tab / Maj+Tab | Même chose que →/←, via `move-out` : MathLive garde la priorité tant qu'il a des cases à remplir. Dans l'opération (input brut), Tab/Maj+Tab passent directement au champ voisin ; au-delà des extrémités, comportement navigateur par défaut. |
| ↓ depuis Gᵢ / Dᵢ | Opᵢ s'il est visible ; sinon Gᵢ₊₁ / Dᵢ₊₁ (même colonne) ; sinon sortie bas. |
| ↓ depuis Opᵢ | Étape i+1, dans la **colonne mémorisée** (G par défaut) ; si i = n, sortie bas. |
| ↑ depuis Gᵢ / Dᵢ | Opᵢ₋₁ si i > 0 ; sinon sortie haut. |
| ↑ depuis Opᵢ | Étape i, colonne mémorisée (G par défaut). |
| Entrée (tout champ de l'étape i) | Si l'étape i+1 existe et est vide : focus sur Gᵢ₊₁. Sinon : insère une étape vide après i, focus Gᵢ₊₁. |
| Maj+Entrée | MathLive dans G/D ; avalé dans l'opération. |
| Retour arrière au début de Dᵢ | Fin de Gᵢ. |
| Retour arrière au début de Opᵢ | Fin de Dᵢ. |
| Retour arrière au début de Gᵢ, i > 0 | Étape i vide → supprimée, curseur fin de Opᵢ₋₁. Sinon → fin de Opᵢ₋₁. |
| Retour arrière au début de G₀ | Supprime le bloc s'il est entièrement vide (une étape vide, aucune opération) ; sinon rien. |
| Suppr en fin de Gᵢ | Début de Dᵢ. |
| Suppr en fin de Dᵢ | Opᵢ s'il est visible ; sinon Gᵢ₊₁ ; en fin de bloc, même règle que G₀. |
| Suppr en fin de Opᵢ | Étape i+1 vide → supprimée, curseur reste en fin de Opᵢ. Étape i+1 non vide → début de Gᵢ₊₁. Opₙ → même règle que G₀. |

**Colonne mémorisée** : le dernier membre (G ou D) qui a eu le focus, quelle
que soit la façon (flèche, Tab, clic). G au montage du bloc.

### Détection « résolu »

`equationStepIsSolved(steps, i)` est vrai si et seulement si :

1. `i` est la dernière étape ;
2. un membre est une variable seule `v` (`isBareVariable`, inchangé) ;
3. l'autre membre est non vide (après `trim`) ;
4. l'autre membre ne contient pas `v` : on retire les commandes LaTeX
   (`\\[a-zA-Z]+`) sauf si `v` en est une, puis on cherche `v`. Une lettre
   collée compte (`2ax` contient `x` : multiplication implicite) ; une
   commande doit finir là (`\alphabet` ne contient pas `\alpha`) ; l'indice
   compte (`x_1` ≠ `x_2`, `x` ≠ `x_1`, `x_1` = `x_{1}`).

| Étape | Résolu |
|---|---|
| `x = 5` | oui |
| `x = \frac{3}{2}` | oui |
| `5 = x` | oui |
| `x = 2x + 3` | non |
| `x = ` | non |
| `x = \max(a, b)` | oui |
| `\alpha = 2\alpha` | non |
| `x = 2ax` | non |
| `x_1 = x_{1} + 2` | non |
| `x_1 = x_2 + 2` | oui |
| `x = x_1 + 2` | oui |

`BlockView` (lecture) et `equationToPlainText` : une opération **non vide**
après la dernière étape est affichée / écrite, comme les autres (l'éditeur ne
masque jamais un contenu saisi, la lecture non plus).

## Architecture

Principe : **les champs émettent des intentions, les parents décident**. C'est
le modèle déjà en place (`onDeleteEmpty`, `onDeleteForward`), généralisé.

### `MathFieldEditor`

- Écoute `move-out` sur `<math-field>` et appelle `onExit(direction)` où
  `direction ∈ 'left' | 'right' | 'up' | 'down'`, puis `preventDefault()` (pas
  de « plonk ») quand le parent l'a géré. Un `move-out` consécutif à Tab
  (dernière touche mémorisée dans l'écouteur `keydown` capture) est traduit en
  `left`/`right` seulement si le prop `tabExits` est vrai (équation) ; sinon
  laissé à MathLive.
- Retire l'interception ↑/↓ en capture et les props `onArrowUp/onArrowDown`.
- Garde anti-rafale : `onBackspaceAtStart` / `onDeleteAtEnd` ne sont pas
  appelés si `event.repeat` ; la touche est alors `preventDefault()` au bord.
- Ctrl/Cmd+Entrée → `onEnterBlock('outside')` ; Ctrl/Cmd+Maj+Entrée →
  `onEnterBlock('inside')`. Maj+Entrée seul reste à MathLive.

### `mathLineKeyDown` (repli brut) et `EquationTermField` / `EquationOperationField`

Mêmes intentions à partir de `selectionStart/End` : ←/→ au bord, ↑/↓ toujours
(un champ brut n'a pas de navigation verticale interne), même anti-rafale,
mêmes variantes d'Entrée.

### `MathLinesField`

- `onExit` d'une ligne : ligne voisine, ou `onExitBlock('before' | 'after')`
  aux extrémités.
- Retour arrière ligne 1 / Suppr dernière ligne : `onEmptyBackspace` /
  `onEmptyDelete` seulement si `lines.every(l => l === '')`.
- Expose via handle `focusEdge('start' | 'end')` (première ligne début /
  dernière ligne fin).

### `equationNav.ts` (nouveau, pur)

```ts
type EqField = 'left' | 'right' | 'operation'
type EqPos = { step: number; field: EqField }
type EqMove = 'left' | 'right' | 'up' | 'down'
type EqTarget = { pos: EqPos; at: 'start' | 'end' } | 'exit-before' | 'exit-after'

export function operationVisible(steps: EquationStep[], step: number): boolean
export function navigate(steps: EquationStep[], from: EqPos, move: EqMove, column: 'left' | 'right'): EqTarget
export function readingOrder(steps: EquationStep[]): EqPos[]
```

Aucune dépendance React ; testé seul, exhaustivement.

### `EquationBlockField`

- Délègue flèches/Tab à `navigate`, garde la colonne mémorisée dans une ref.
- Affiche Opₙ selon `operationVisible`.
- Applique le tableau Retour arrière/Suppr/Entrée ci-dessus.
- Expose `focusEdge('start' | 'end')` (G₀ début / dernier champ visible fin).
- `onExitBlock('before' | 'after')` vers `BlockEditor`.

### `AutoGrowTextarea`

- ←/→/↑/↓ au bord selon le tableau → `onExitBlock`.
- Variante question : prop `onEnterBody` (Entrée / Ctrl+Maj+Entrée), Maj+Entrée
  natif.
- Ctrl+Entrée / Ctrl+Maj+Entrée → `onEnterBlock('outside' | 'inside')`.
- Anti-rafale sur la suppression de bloc vide.

### `BlockEditor`

- `focusBlockEdge(index, 'start' | 'end')` : passe par les mécanismes différés
  existants (`pendingCaret`, `pendingMathFocusStart/End`) et, pour une équation
  ou une formule, par le handle `focusEdge` du bloc.
- `exitBlock(index, 'before' | 'after')` : cherche le bloc navigable voisin
  (saute image/tableau) et appelle `focusBlockEdge`.
- `insertBlockOutsideGroup(index)` : insère après le dernier index du groupe de
  `index` (`blockGroups`), avec `standalone: true` si ce groupe a un en-tête.
- `onEnterBlock('inside')` = `insertBlockAfter(index, …)` actuel.
- `handleEditorKeyDown` : Ctrl+Entrée hors champ → `appendOutside()` ; retire
  l'ancien Ctrl+Maj+Entrée → `appendOutside()`.

### Raccourci global

`card.editDescription` (`Mod+Enter`) ne doit pas se déclencher pendant que la
modale est ouverte : à vérifier dans `useGlobalShortcuts`, corriger si besoin.

## Hors périmètre

- Navigation dans et entre les cellules de tableau, et entrée dans un tableau
  par les flèches (sauté pour ne pas créer de piège dont on ne sort pas).
- Fusion de deux blocs texte par Retour arrière (délibérément refusée : deux
  blocs restent deux blocs).
- Coupure d'un en-tête de question par Entrée.

## Tests

- `equationNav.test.ts` : chaque ligne du tableau « Équation » (déplacements,
  colonne mémorisée, Opₙ caché/visible, extrémités).
- `blocks.test.ts` : la table « Détection résolu ».
- `mathFieldKeys.test.tsx` / `formulaZoneKeys.test.tsx` : `move-out` →
  intentions, anti-rafale, bug 1 (`["", "x=2"]` survit), variantes d'Entrée.
- `equationKeys.test.tsx` : Retour arrière/Suppr/Entrée du tableau, Opₙ.
- `blockKeys.test.tsx` : sorties de bloc (saut image/tableau, avalé sans
  voisin), Ctrl+Entrée hors groupe / Ctrl+Maj+Entrée dans le groupe, Entrée
  dans l'en-tête de question, ↑/↓ en deux temps dans un texte.
- `BlockView.test.tsx` : opération après une dernière étape non résolue.
- Vérification manuelle dans l'app (MathLive réel) : fractions + ↑/↓,
  `move-out` aux bords, Retour arrière maintenu.
