import type { Card } from '../types/card'
import { COLUMN_WIDTH, ROW_HEIGHT, BRANCH_GAP } from './cardGeometry'

/**
 * The grid two pitches are DERIVED from the card size in layout/cardGeometry:
 * the column pitch is the card width times a ratio (so the gutter between two
 * columns can never shrink relative to the card it separates), and the row
 * pitch is the card height plus the two floating "+" buttons that straddle its
 * edges plus a constant breath of air.
 *
 * Re-exported here because the layout, the canvas and the export all read them
 * from this module.
 */
export { COLUMN_WIDTH, ROW_HEIGHT, BRANCH_GAP }

// The floating-cards ("cartes volantes") zone sits below the tree, as its own
// grid: detached cards are outside the hierarchy, so they get neither a level
// column nor a tree row. A full blank row of clearance separates the two so the
// zone reads as a distinct area rather than as more branches.
export const DETACHED_ZONE_GAP = ROW_HEIGHT * 1.5
// 3 rather than 4: the column pitch is now 480 (a 300px card plus its
// proportional gutter), and four of them would make the floating-cards grid
// wider than the tree it sits under.
export const DETACHED_ZONE_COLUMNS = 3
export const DETACHED_ROW_HEIGHT = ROW_HEIGHT * 0.85

export interface Position {
  x: number
  y: number
}

/**
 * Depth-first, post-order "tidy tree" layout.
 *
 * X is fixed per level (one column per level). Y is allocated from a single
 * shared cursor so that every LEAF of the whole tree — regardless of its level
 * — gets its own row, and every non-leaf sits at the midpoint of its children.
 * A per-sibling-group row index (the previous implementation) collides as soon
 * as two parents at the same level each have children: all their children would
 * restart at row 0 and stack on top of each other.
 */
export function computeLayout(cards: Card[]): Record<string, Position> {
  const positions: Record<string, Position> = {}
  // Detached cards are laid out separately (see below): they must not appear in
  // any parent's child list, nor be walked as a subtree of their own.
  const attached = cards.filter(c => !c.detached)
  const detached = cards.filter(c => c.detached).sort((a, b) => a.order - b.order)

  const childrenByParent = new Map<string, Card[]>()
  for (const card of attached) {
    if (card.parentId === null) continue
    if (!childrenByParent.has(card.parentId)) childrenByParent.set(card.parentId, [])
    childrenByParent.get(card.parentId)!.push(card)
  }
  for (const group of childrenByParent.values()) {
    group.sort((a, b) => a.order - b.order)
  }

  // The leaf rows are the vertical rhythm the whole map is built from: every
  // leaf takes the next row, and each parent is centred on its children. The
  // step between two leaves is the plain ROW_HEIGHT when they share a parent
  // (they are the same sibling group) and ROW_HEIGHT + BRANCH_GAP when the
  // parent changes within one column — two adjacent cards of the same level
  // that belong to different branches. Requiring the same `level` too keeps a
  // leaf-then-deeper-leaf step (never a same-column pair) from widening the map
  // for nothing.
  let previousLeaf: { y: number; parentId: string | null; level: number } | null = null

  function nextLeafY(card: Card): number {
    if (previousLeaf === null) {
      previousLeaf = { y: 0, parentId: card.parentId, level: card.level }
      return 0
    }
    const sameColumn = card.level === previousLeaf.level
    const sameParent = card.parentId === previousLeaf.parentId
    const step = sameColumn && !sameParent ? ROW_HEIGHT + BRANCH_GAP : ROW_HEIGHT
    const y = previousLeaf.y + step
    previousLeaf = { y, parentId: card.parentId, level: card.level }
    return y
  }

  // Guards against a corrupt file whose parent links form a loop: without it,
  // `layoutSubtree` would recurse until the stack blows. A card already being
  // laid out higher up the recursion is treated as a leaf, which terminates the
  // walk and still gives every card a position.
  const inProgress = new Set<string>()

  function layoutSubtree(card: Card): number {
    const children = inProgress.has(card.id) ? [] : childrenByParent.get(card.id) ?? []
    inProgress.add(card.id)
    let y: number
    if (children.length === 0) {
      y = nextLeafY(card)
    } else {
      const childYs = children.map(layoutSubtree)
      y = (Math.min(...childYs) + Math.max(...childYs)) / 2
    }
    positions[card.id] = { x: (Math.max(1, card.level) - 1) * COLUMN_WIDTH, y }
    return y
  }

  const root = attached.find(c => c.parentId === null)
  if (root) layoutSubtree(root)

  // Defensive: a hand-edited/corrupt file could contain cards unreachable from
  // the root (a dangling parentId, or a second root). Lay out each such
  // orphaned subtree root too, so no card is ever left without a position.
  const knownIds = new Set(attached.map(c => c.id))
  for (const card of attached) {
    if (card.id in positions) continue
    const isSubtreeRoot = card.parentId === null || !knownIds.has(card.parentId)
    if (isSubtreeRoot) layoutSubtree(card)
  }

  // Last resort, and the reason this function is TOTAL: cards caught in a
  // parent cycle are neither reachable from the root nor subtree roots, so the
  // two passes above skip them entirely. A card with no position becomes a
  // React Flow node with `position: undefined`, which throws mid-render and
  // takes the whole app down with it — the map "opens then disappears". Placing
  // them somewhere visible is always better than that. (`validateCards` blocks
  // such a file long before it reaches the canvas; this is the net under it.)
  for (const card of attached) {
    if (card.id in positions) continue
    layoutSubtree(card)
  }

  Object.assign(positions, computeDetachedZoneLayout(detached, detachedZoneTop(positions)))

  return positions
}

/** Y of the floating zone: one clear gap under the lowest card of the tree. */
function detachedZoneTop(treePositions: Record<string, Position>): number {
  const ys = Object.values(treePositions).map(p => p.y)
  if (ys.length === 0) return 0
  return Math.max(...ys) + DETACHED_ZONE_GAP
}

/**
 * The floating zone itself: a plain left-to-right grid, wrapping every
 * `DETACHED_ZONE_COLUMNS` cards. Exported for the canvas, which pins the zone's
 * label to the same origin.
 */
export function computeDetachedZoneLayout(detached: Card[], top: number): Record<string, Position> {
  const positions: Record<string, Position> = {}
  detached.forEach((card, index) => {
    positions[card.id] = {
      x: (index % DETACHED_ZONE_COLUMNS) * COLUMN_WIDTH,
      y: top + Math.floor(index / DETACHED_ZONE_COLUMNS) * DETACHED_ROW_HEIGHT,
    }
  })
  return positions
}
