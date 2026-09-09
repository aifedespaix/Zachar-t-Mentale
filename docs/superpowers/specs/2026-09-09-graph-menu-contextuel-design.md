# Graph : menu contextuel — Design

**Date** : 2026-09-09
**Statut** : Validé, en attente du plan d'implémentation
**Sous-projet** : C (sur 4 — D, A et B faits, C en cours — dernier)

## Contexte

Dernier volet de l'amélioration sidebar/graph (voir
`docs/superpowers/specs/2026-09-08-sidebar-menu-contextuel-design.md` pour
le contexte des 4 sous-projets). Aujourd'hui, `MindMapCanvas.tsx` n'a aucun
clic-droit : ni sur le fond du canvas, ni sur une carte. Undo/redo
(`useCardsStore().undo`/`.redo`) et la zone de cartes volantes
(`detachCard`) existent déjà mais ne sont accessibles que via des boutons
existants ailleurs dans l'interface, pas depuis le canvas lui-même.

Objectif : un clic-droit n'importe où sur le canvas ouvre un menu avec
créer une carte volante, annuler, refaire, et exporter (PDF / Image /
XMind, export direct sans dialogue).

**Explicitement hors périmètre** : aucune modification de la logique de
mise en page (`computeLayout`), de `CardNode.tsx`, ou du flux d'export
existant depuis la sidebar (`ExportDialog.tsx` reste tel quel, avec sa
modale et ses cases à cocher — le nouveau chemin d'export direct depuis le
canvas est un chemin *supplémentaire*, pas un remplacement).

## Vue d'ensemble

1. `MindMapCanvas.tsx` enveloppe son `<ReactFlow>` dans le composant
   `ContextMenu` déjà construit au sous-projet A (`src/components/ui/context-menu.tsx`)
   — première vraie utilisation de `ContextMenuSub`/`SubTrigger`/`SubContent`,
   construits en A mais jamais consommés jusqu'ici.
2. Nouvelle fonction `addFloatingCard` dans `cardsReducer.ts` + action
   `addFloatingCard` dans `useCardsStore.ts`, sur le modèle exact
   d'`addChild`/`addSibling`.
3. Un export direct (sans dialogue) déclenché par le sous-menu, réutilisant
   les fonctions d'export déjà utilisées par `ExportDialog.tsx`.

## Le menu

Clic-droit n'importe où sur le canvas (fond **ou** carte — aucune carte
n'a de clic-droit propre aujourd'hui, donc pas de conflit) :

- Créer une carte volante
- ─
- Annuler (désactivé si `history.past.length === 0`)
- Refaire (désactivé si `history.future.length === 0`)
- ─
- Exporter → sous-menu → PDF / Image / XMind

**Verrouillage pendant un quiz** : « Créer une carte volante », « Annuler »
et « Refaire » sont masqués quand `locked` est vrai — cohérent avec le
reste de l'app (les boutons structurels des cartes sont déjà cachés en
mode quiz, cf. `EdgeButton`). « Exporter » reste toujours disponible : ça
ne modifie rien à l'état.

**Piège d'intégration React Flow** : `ContextMenuTrigger asChild` clone ses
props (`onContextMenu`, `ref`) sur son enfant direct via le mécanisme
`Slot` de Radix — ça ne fonctionne correctement que si l'enfant est un
élément DOM (ou un composant qui relaie ces props verbatim à son nœud
racine). `<ReactFlow>` est un composant tiers strictement typé qui
n'accepte pas un `onContextMenu` arbitraire dans ses props. Donc le
`ContextMenuTrigger` enveloppe une `<div style={{ width: '100%', height:
'100%' }}>` autour de `<ReactFlow>`, jamais `<ReactFlow>` directement —
exactement le motif déjà utilisé dans `FileTreeRow.tsx` (enveloppe une
`<div>` avant d'appliquer `asChild`). Le `width`/`height` à 100% est
nécessaire pour que la div hérite la hauteur calculée par le conteneur
flex parent (`<main style={{ flex: 1 }}>` dans `App.tsx`) — sans ça, React
Flow n'a pas de hauteur concrète pour se dessiner.

## Créer une carte volante

`cardsReducer.ts`, sur le modèle exact d'`addChild` :

```ts
export function addFloatingCard(cards: Card[]): { cards: Card[]; newCardId: string } {
  const newCard: Card = {
    id: crypto.randomUUID(),
    level: 1,
    title: 'Nouveau titre',
    parentId: null,
    detached: true,
    order: nextDetachedOrder(cards),
  }
  return { cards: [...cards, newCard], newCardId: newCard.id }
}
```

`nextDetachedOrder` existe déjà dans ce fichier (privée) ; elle devient
exportée pour être testée directement en plus d'être utilisée ici. Le
`level: 1` est arbitraire et sans effet visuel : le rendu d'une carte
détachée utilise toujours `detachedColors`, jamais le niveau — mais le
type `Card` exige une valeur.

Pas de calcul de position à la souris : la carte apparaît automatiquement
au prochain emplacement de la grille des cartes volantes, la mise en page
(`computeLayout`) s'en charge déjà pour toute carte détachée, quelle que
soit son origine.

`useCardsStore.ts` : `addFloatingCard: () => string`, même schéma
qu'`addChild`/`addSibling` (pousse un nouvel état dans l'historique,
retourne le nouvel id).

**Annuler/Refaire** : réutilisent directement `useCardsStore().undo`/`.redo`
déjà existants. Aucune nouvelle logique — seulement l'exposition dans ce
nouveau menu, avec l'état désactivé lu depuis `history.past.length`/
`history.future.length`.

## Export direct depuis le canvas

Chaque item du sous-menu Exporter appelle une fonction locale à
`MindMapCanvas.tsx` qui réutilise directement les fonctions déjà utilisées
par `ExportDialog.tsx` (`exportToPdfBytes`, `exportToImageDataUrls` de
`../export/exportMindMap` ; `writeXmindFile` de `../xmind/exportXmind` ;
`saveBytesAs`, `describeExportError` de `../persistence/exportIO` ;
`mindMapBaseName` de `../persistence/paths`), sur les cartes courantes
(`useCardsStore().history.present`) avec des options fixes — pas de
dialogue, le choix du format EST déjà le sous-menu :

```ts
const options = { showDefinitions: true, includeDetached: true, mindMapPath: currentFilePath }
const baseName = currentFilePath ? mindMapBaseName(currentFilePath) : 'carte-mentale'
```

`currentFilePath` vient de `useWorkspaceStore` (pas encore importé dans ce
fichier). Une erreur (n'importe quelle étape) affiche un état local
`exportError` dans une bannière `status-banner` (même classe CSS que la
sidebar, cohérence visuelle) — pas de nouvelle prop à faire remonter
jusqu'à `App.tsx`.

**DRY** : `dataUrlToBytes` (actuellement privée dans `ExportDialog.tsx`,
utilisée pour convertir un data URL PNG en octets avant `saveBytesAs`) est
extraite vers `src/persistence/exportIO.ts`, à côté de `saveBytesAs`
qu'elle accompagne toujours, et importée depuis les deux endroits — évite
de dupliquer cette petite fonction pure maintenant que deux composants en
ont besoin.

## Tests

- `cardsReducer.test.ts` : `addFloatingCard` — nouvelle carte avec
  `detached: true`, `parentId: null`, `order` correct (0 sur un dossier
  vide, suite de la dernière carte volante existante sinon).
- `useCardsStore.test.ts` : l'action `addFloatingCard` pousse un état
  undoable.
- `MindMapCanvas.test.tsx` : le menu s'ouvre au clic-droit (sur le fond
  comme sur une carte) ; contenu correct selon `locked` (les 3 premiers
  items masqués en mode quiz, Exporter toujours présent) ; Annuler/Refaire
  désactivés selon l'état de l'historique ; chaque item du sous-menu
  Exporter appelle la bonne fonction d'export avec le bon nom de base ;
  une erreur d'export affiche la bannière.
- `exportIO.test.ts` (ou `ExportDialog.test.tsx`, selon où il est le plus
  simple de couvrir sans dupliquer) : `dataUrlToBytes` continue de
  fonctionner correctement après son déplacement — au minimum, vérifier que
  `ExportDialog.test.tsx` passe toujours sans modification après
  l'extraction.
