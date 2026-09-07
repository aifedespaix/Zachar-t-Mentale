# Restructuration & cartes volantes — Design

**Date** : 2026-09-07
**Statut** : Implémenté
**Lot** : Évolutions drag & drop / brouillon

## Contexte

L'éditeur limite la carte mentale à 4 niveaux stricts, chaque carte ayant
exactement un parent (sauf la racine). Le drag & drop existant ne permettait
qu'un reparentage *à niveau constant* (le nouveau parent devait être au niveau
juste au-dessus), et la même gestuelle servait au reparentage et à la
réorganisation — la distinction ne dépendant que d'un chevauchement de boîtes.

Ce lot ouvre le déplacement à tous les niveaux, sépare visuellement les deux
gestes, et introduit un statut « carte volante » (détachée) qui sert à la fois
de soupape à la limite des 4 niveaux et de zone de brouillon.

## Modèle de données

`Card` gagne un champ optionnel :

```ts
interface Card {
  // ...
  detached?: boolean
}
```

Invariants (`src/types/card.ts`) :

- Une carte détachée a `parentId: null` et **ne peut pas avoir d'enfants**.
  Elle est une zone de réflexion, pas un second arbre.
- `isRootCard(card)` = `parentId === null && !detached`. La racine et les
  cartes volantes partagent la même forme ; toute protection de la racine
  (non supprimable, non déplaçable) doit donc exclure explicitement les
  cartes volantes.
- `canReceiveChildren(card)` = `!detached && level < 4`.
- Le `level` d'une carte volante est **vestigial** (le dernier niveau connu).
  Rien ne l'utilise : ni le rendu (palette grise dédiée), ni le layout (zone
  propre), ni le quiz (les cartes volantes en sont exclues). Un rattachement
  le recalcule depuis le nouveau parent.

Aucune migration : les fichiers existants n'ont pas le champ, `undefined` est
falsy, et la sérialisation JSON l'omet tant qu'il n'est pas posé.

## Opérations (src/state/cardsReducer.ts)

| Opération | Effet |
| --- | --- |
| `moveCard(cards, id, parentId, index?)` | Reparente vers **n'importe quel** niveau, ré-étage toute la branche déplacée, insère à `index` (défaut : fin), détache ce qui dépasse le niveau 4. Renvoie `{ cards, detachedIds }`. |
| `overflowingCardCount(cards, id, parentId)` | Prédit le nombre de cartes qui seraient détachées — 0 = le déplacement tient dans les 4 niveaux. |
| `canMoveCardTo(cards, id, parentId)` | Validité structurelle : pas la racine, pas un parent niveau 4, pas une carte volante, pas un descendant (cycle). |
| `detachCard(cards, id)` | Détache **et aplatit** toute la branche : chaque descendant devient une carte volante individuelle. |
| `flattenedCardCount(cards, id)` | La carte + tous ses descendants (le « X » des modales). |
| `deleteCard(cards, id)` | Supprime la carte et sa branche. Sur la racine (jamais supprimée) : vide ses descendants. |
| `deleteCardDetachingChildren(cards, id)` | Supprime la carte, **conserve** ses descendants aplatis en cartes volantes. |

Le reparentage libre rend les cycles possibles (ce n'était pas le cas quand le
parent devait être au niveau juste au-dessus) : `canMoveCardTo` les refuse
explicitement.

Les `order` sont re-numérotés par une passe `normalizeOrders` : chaque groupe
de fratrie, plus un groupe implicite unique pour la zone volante, redevient une
suite contiguë `0..n-1` en préservant l'ordre relatif.

## UX du drag & drop

Le geste est décidé par la **position verticale** de la carte tirée sur la
carte survolée (`resolveDropTarget`, `INSERT_BAND = 0.3`) :

- **Bande haute / basse (30 %) — ou l'espace entre deux cartes** : `insert`.
  La carte rejoint la fratrie de la carte survolée à cet emplacement. Couvre la
  réorganisation *et* le « deviens le frère de cette carte », y compris entre
  parents différents. Indicateur : **ligne d'insertion bleue** tracée dans
  l'interstice (un nœud React Flow dédié, donc en coordonnées du graphe).
- **Milieu (40 %)** : `reparent`. La carte (et sa branche) devient enfant de la
  carte survolée. Indicateur : **surbrillance pulsée** de la cible + arête
  fantôme pointillée (comportement existant conservé).

Cas particuliers : survoler le milieu du parent actuel ne fait rien (rien à
changer) ; survoler une carte qui ne peut pas recevoir d'enfants (niveau 4)
retombe sur une insertion à côté d'elle ; la branche de la carte tirée n'est
jamais une cible (elle voyage avec elle) ; un survol dans le vide annule le
déplacement et la carte revient à sa place.

## Modales

1. **Dépassement des 4 niveaux** (au drop, `MindMapCanvas`) —
   `overflowWarningMessage(n)` : « Attention, ce déplacement dépasse la limite
   des 4 niveaux. X cartes enfants situées hors limite seront transformées en
   cartes volantes. » → *Confirmer* / *Annuler*. Annuler = rien n'est commité,
   la carte est remise à sa place.
2. **Détachement d'une branche** (bouton « Détacher », `CardNode`) : annonce
   l'aplatissement et le nombre exact de cartes volantes générées → *Accepter*
   / *Annuler*. Une carte sans enfant est détachée sans modale.
3. **Suppression avec descendants** (`CardNode`) : trois issues —
   *Annuler* / *Détacher les enfants* (supprime la carte, garde la branche en
   cartes volantes) / *Tout supprimer*. Sur la racine, la modale précise
   qu'elle-même ne sera pas supprimée ; son bouton n'est actif que si elle a au
   moins un descendant.

Toutes ces opérations passent par le store, donc sont annulables (undo/redo).

## Rendu

- Palette dédiée `detachedColors` (achromatique, contraste WCAG AA vérifié) +
  bordure pointillée + `grayscale` : une carte volante ne peut pas être lue
  comme un cinquième niveau.
- Zone volante : grille propre (4 colonnes, retour à la ligne) placée sous
  l'arbre avec un interstice franc, coiffée d'un libellé « Cartes volantes ».
- Une carte volante n'expose ni « + » (pas de fratrie) ni « → » (pas
  d'enfants) ni « Détacher » ; elle reste supprimable et surtout **déplaçable**
  : la glisser sur la carte mentale est la seule façon de lui redonner des
  enfants.
- Le bouton de suppression quitte le coin haut-droit (icône croix) pour le
  footer d'actions (icône poubelle), aux côtés de « Détacher ».
