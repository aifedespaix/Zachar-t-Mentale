import { describe, it, expect } from 'vitest'
import { computeLayout, COLUMN_WIDTH, DETACHED_ZONE_COLUMNS, ROW_HEIGHT, BRANCH_GAP } from './columns'
import type { Card } from '../types/card'

describe('computeLayout', () => {
  it('places each level at its fixed column x position', () => {
    const cards: Card[] = [
      { id: 'root', level: 1, title: 'r', parentId: null, order: 0 },
      { id: 'child', level: 2, title: 'c', parentId: 'root', order: 0 },
    ]
    const positions = computeLayout(cards)
    expect(positions.root.x).toBe(0)
    expect(positions.child.x).toBe(COLUMN_WIDTH)
  })

  it('stacks siblings vertically by sorted order, independent of gaps in the order field', () => {
    const cards: Card[] = [
      { id: 'root', level: 1, title: 'r', parentId: null, order: 0 },
      { id: 'a', level: 2, title: 'a', parentId: 'root', order: 5 },
      { id: 'b', level: 2, title: 'b', parentId: 'root', order: 10 },
    ]
    const positions = computeLayout(cards)
    expect(positions.a.y).toBe(0)
    expect(positions.b.y).toBe(ROW_HEIGHT)
  })

  it('never stacks two cards from different sibling groups at the same position', () => {
    // root -> two level-2 parents, each with two level-3 children.
    const cards: Card[] = [
      { id: 'root', level: 1, title: 'r', parentId: null, order: 0 },
      { id: 'p1', level: 2, title: 'p1', parentId: 'root', order: 0 },
      { id: 'p2', level: 2, title: 'p2', parentId: 'root', order: 1 },
      { id: 'p1c1', level: 3, title: 'p1c1', parentId: 'p1', order: 0 },
      { id: 'p1c2', level: 3, title: 'p1c2', parentId: 'p1', order: 1 },
      { id: 'p2c1', level: 3, title: 'p2c1', parentId: 'p2', order: 0 },
      { id: 'p2c2', level: 3, title: 'p2c2', parentId: 'p2', order: 1 },
    ]
    const positions = computeLayout(cards)

    const keys = cards.map(c => `${positions[c.id].x}:${positions[c.id].y}`)
    expect(new Set(keys).size).toBe(cards.length)

    // Leaves take sequential rows across the whole tree, not per-group rows.
    // p1's two children are siblings, one plain row pitch apart; p2's group
    // starts a new branch, so its first row is one BRANCH_GAP lower still.
    expect(positions.p1c1.y).toBe(0)
    expect(positions.p1c2.y).toBe(ROW_HEIGHT)
    expect(positions.p2c1.y).toBe(2 * ROW_HEIGHT + BRANCH_GAP)
    expect(positions.p2c2.y).toBe(3 * ROW_HEIGHT + BRANCH_GAP)

    // Each parent is centred on its own children, so the two parents differ.
    expect(positions.p1.y).toBe(0.5 * ROW_HEIGHT)
    expect(positions.p2.y).toBe(2.5 * ROW_HEIGHT + BRANCH_GAP)
    expect(positions.p1.y).not.toBe(positions.p2.y)

    // The root is centred on the whole span.
    expect(positions.root.y).toBe(1.5 * ROW_HEIGHT + 0.5 * BRANCH_GAP)
  })

  it('widens only the branch boundary, not the sibling step, within a column', () => {
    // root -> two level-2 parents, each with two level-3 children. The rule
    // reads on the level-3 column: p1c2 -> p2c1 crosses from p1 to p2, so it
    // must be visibly wider than the sibling step p1c1 -> p1c2.
    const cards: Card[] = [
      { id: 'root', level: 1, title: 'r', parentId: null, order: 0 },
      { id: 'p1', level: 2, title: 'p1', parentId: 'root', order: 0 },
      { id: 'p2', level: 2, title: 'p2', parentId: 'root', order: 1 },
      { id: 'p1c1', level: 3, title: 'p1c1', parentId: 'p1', order: 0 },
      { id: 'p1c2', level: 3, title: 'p1c2', parentId: 'p1', order: 1 },
      { id: 'p2c1', level: 3, title: 'p2c1', parentId: 'p2', order: 0 },
      { id: 'p2c2', level: 3, title: 'p2c2', parentId: 'p2', order: 1 },
    ]
    const positions = computeLayout(cards)

    const siblingGap = positions.p1c2.y - positions.p1c1.y
    const branchGap = positions.p2c1.y - positions.p1c2.y
    expect(siblingGap).toBe(ROW_HEIGHT)
    expect(branchGap).toBe(ROW_HEIGHT + BRANCH_GAP)
    expect(branchGap).toBeGreaterThan(siblingGap)
  })

  it('does not widen a same-parent pair whose children sit on another level', () => {
    // a (level 2, leaf) and b (level 2, parent) are both children of root, so
    // they are siblings; b is pinned under its only child bc, one level deeper.
    // That level change is not a same-column branch boundary, so a -> b keeps
    // the plain pitch instead of inheriting bc's branch gap.
    const cards: Card[] = [
      { id: 'root', level: 1, title: 'r', parentId: null, order: 0 },
      { id: 'a', level: 2, title: 'a', parentId: 'root', order: 0 },
      { id: 'b', level: 2, title: 'b', parentId: 'root', order: 1 },
      { id: 'bc', level: 3, title: 'bc', parentId: 'b', order: 0 },
    ]
    const positions = computeLayout(cards)
    expect(positions.b.y - positions.a.y).toBe(ROW_HEIGHT)
  })

  it('gives a deep leaf its own row even when it is at a shallower level than other leaves', () => {
    // root -> a (level 2, leaf) and b (level 2, with one level-3 leaf child)
    const cards: Card[] = [
      { id: 'root', level: 1, title: 'r', parentId: null, order: 0 },
      { id: 'a', level: 2, title: 'a', parentId: 'root', order: 0 },
      { id: 'b', level: 2, title: 'b', parentId: 'root', order: 1 },
      { id: 'bc', level: 3, title: 'bc', parentId: 'b', order: 0 },
    ]
    const positions = computeLayout(cards)
    expect(positions.a.y).toBe(0)
    expect(positions.bc.y).toBe(ROW_HEIGHT)
    expect(positions.b.y).toBe(ROW_HEIGHT)
    expect(positions.root.y).toBe(0.5 * ROW_HEIGHT)
  })
})

describe('computeLayout — floating cards zone', () => {
  const root: Card = { id: 'root', level: 1, title: 'r', parentId: null, order: 0 }
  const child: Card = { id: 'child', level: 2, title: 'c', parentId: 'root', order: 0 }

  it('parks detached cards in their own grid below the tree', () => {
    const detachedA: Card = { id: 'da', level: 3, title: 'da', parentId: null, order: 0, detached: true }
    const detachedB: Card = { id: 'db', level: 4, title: 'db', parentId: null, order: 1, detached: true }
    const positions = computeLayout([root, child, detachedA, detachedB])

    const treeBottom = Math.max(positions.root.y, positions.child.y)
    expect(positions.da.y).toBeGreaterThan(treeBottom)
    // Side by side on the zone's first row, whatever level they used to be at.
    expect(positions.da.y).toBe(positions.db.y)
    expect(positions.da.x).toBe(0)
    expect(positions.db.x).toBe(COLUMN_WIDTH)
  })

  it('wraps the zone onto a second row past its column count', () => {
    const detached = Array.from({ length: DETACHED_ZONE_COLUMNS + 1 }, (_, i): Card => ({
      id: `d${i}`,
      level: 2,
      title: `d${i}`,
      parentId: null,
      order: i,
      detached: true,
    }))
    const positions = computeLayout([root, ...detached])
    expect(positions.d0.x).toBe(0)
    expect(positions[`d${DETACHED_ZONE_COLUMNS}`].x).toBe(0)
    expect(positions[`d${DETACHED_ZONE_COLUMNS}`].y).toBeGreaterThan(positions.d0.y)
  })

  it('keeps detached cards out of the tree layout entirely', () => {
    // A detached card that still carries a stale level must not claim a level
    // column, nor shift the rows the real tree is laid out on.
    const detached: Card = { id: 'd', level: 2, title: 'd', parentId: null, order: 0, detached: true }
    const withoutDetached = computeLayout([root, child])
    const withDetached = computeLayout([root, child, detached])
    expect(withDetached.root).toEqual(withoutDetached.root)
    expect(withDetached.child).toEqual(withoutDetached.child)
    expect(withDetached.d.x).toBe(0)
  })

  // The canvas turns every card into a React Flow node whose `position` is read
  // straight out of this map. A card with no entry becomes `position: undefined`,
  // which throws mid-render and takes the whole app down — the "the map opens
  // then disappears" failure. So the layout has to stay TOTAL, even on data no
  // healthy app state can produce.
  it('places every card of a corrupt file, including one in a parent loop', () => {
    const x: Card = { id: 'x', level: 2, title: 'x', parentId: 'y', order: 0 }
    const y: Card = { id: 'y', level: 2, title: 'y', parentId: 'x', order: 0 }
    const positions = computeLayout([root, child, x, y])
    for (const id of ['root', 'child', 'x', 'y']) {
      expect(positions[id]).toBeDefined()
    }
  })

  it('terminates on a card that is its own parent', () => {
    const self: Card = { id: 'self', level: 2, title: 'self', parentId: 'self', order: 0 }
    expect(computeLayout([root, self]).self).toBeDefined()
  })

  it('places a card whose level is out of range in the first column rather than off-canvas', () => {
    const broken = { id: 'broken', level: 0, title: 'broken', parentId: null, order: 1 } as unknown as Card
    expect(computeLayout([broken]).broken.x).toBe(0)
  })
})
