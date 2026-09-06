import type { Card } from '../types/card'

export const COLUMN_WIDTH = 320
// A card's actual height (~100px unfolded) plus the sibling "+" buttons
// CardNode pins straddling its top/bottom edges (each pokes ~14px past the
// border) leaves almost no clearance at 120: two stacked siblings' buttons
// visibly overlapped. 168 keeps a clear gap between them even so.
export const ROW_HEIGHT = 168

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
  const childrenByParent = new Map<string, Card[]>()
  for (const card of cards) {
    if (card.parentId === null) continue
    if (!childrenByParent.has(card.parentId)) childrenByParent.set(card.parentId, [])
    childrenByParent.get(card.parentId)!.push(card)
  }
  for (const group of childrenByParent.values()) {
    group.sort((a, b) => a.order - b.order)
  }

  let nextRow = 0

  function layoutSubtree(card: Card): number {
    const children = childrenByParent.get(card.id) ?? []
    let y: number
    if (children.length === 0) {
      y = nextRow * ROW_HEIGHT
      nextRow += 1
    } else {
      const childYs = children.map(layoutSubtree)
      y = (Math.min(...childYs) + Math.max(...childYs)) / 2
    }
    positions[card.id] = { x: (card.level - 1) * COLUMN_WIDTH, y }
    return y
  }

  const root = cards.find(c => c.parentId === null)
  if (root) layoutSubtree(root)

  // Defensive: a hand-edited/corrupt file could contain cards unreachable from
  // the root (a dangling parentId, or a second root). Lay out each such
  // orphaned subtree root too, so no card is ever left without a position.
  const knownIds = new Set(cards.map(c => c.id))
  for (const card of cards) {
    if (card.id in positions) continue
    const isSubtreeRoot = card.parentId === null || !knownIds.has(card.parentId)
    if (isSubtreeRoot) layoutSubtree(card)
  }

  return positions
}
