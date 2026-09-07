import { describe, it, expect } from 'vitest'
import {
  createRootCard,
  addChild,
  addSibling,
  updateTitle,
  updateDefinition,
  countDescendants,
  hasChildren,
  deleteCard,
  deleteCardDetachingChildren,
  detachCard,
  moveCard,
  moveCardToIndex,
  moveCardToParent,
  canMoveCardTo,
  flattenedCardCount,
  overflowingCardCount,
  subtreeDepths,
} from './cardsReducer'
import type { Card } from '../types/card'

describe('createRootCard', () => {
  it('creates a level-1 card with no parent', () => {
    const root = createRootCard('Chapitre 1')
    expect(root.level).toBe(1)
    expect(root.parentId).toBeNull()
    expect(root.title).toBe('Chapitre 1')
    expect(root.order).toBe(0)
  })
})

describe('addChild', () => {
  it('adds a level+1 card linked to the parent', () => {
    const root = createRootCard()
    const { cards, newCardId } = addChild([root], root.id)
    const child = cards.find(c => c.id === newCardId)!
    expect(child.level).toBe(2)
    expect(child.parentId).toBe(root.id)
    expect(cards).toHaveLength(2)
  })

  it('throws when the parent is level 4 (cannot have children)', () => {
    const level4: Card = { id: 'x', level: 4, title: 'x', parentId: null, order: 0 }
    expect(() => addChild([level4], 'x')).toThrow()
  })
})

describe('addSibling', () => {
  it('inserts a sibling below the reference and reindexes order', () => {
    const root = createRootCard()
    const { cards: withChild, newCardId: firstChildId } = addChild([root], root.id)
    const { cards, newCardId } = addSibling(withChild, firstChildId, 'below')
    const siblings = cards.filter(c => c.parentId === root.id).sort((a, b) => a.order - b.order)
    expect(siblings.map(c => c.id)).toEqual([firstChildId, newCardId])
    expect(siblings[0].order).toBe(0)
    expect(siblings[1].order).toBe(1)
  })

  it('inserts a sibling above the reference', () => {
    const root = createRootCard()
    const { cards: withChild, newCardId: firstChildId } = addChild([root], root.id)
    const { cards, newCardId } = addSibling(withChild, firstChildId, 'above')
    const siblings = cards.filter(c => c.parentId === root.id).sort((a, b) => a.order - b.order)
    expect(siblings.map(c => c.id)).toEqual([newCardId, firstChildId])
  })

  it('throws when trying to add a sibling to the root (single-root invariant)', () => {
    const root = createRootCard()
    expect(() => addSibling([root], root.id, 'below')).toThrow()
  })
})

describe('updateTitle', () => {
  it('updates only the targeted card', () => {
    const root = createRootCard('old')
    const cards = updateTitle([root], root.id, 'new')
    expect(cards[0].title).toBe('new')
  })
})

describe('updateDefinition', () => {
  it('sets the definition on the targeted card', () => {
    const root = createRootCard()
    const cards = updateDefinition([root], root.id, 'une définition')
    expect(cards[0].definition).toBe('une définition')
  })
})

describe('countDescendants', () => {
  it('counts children and grandchildren', () => {
    const root = createRootCard()
    const { cards: withChild, newCardId: childId } = addChild([root], root.id)
    const { cards: withGrandchild } = addChild(withChild, childId)
    expect(countDescendants(withGrandchild, root.id)).toBe(2)
    expect(countDescendants(withGrandchild, childId)).toBe(1)
  })
})

describe('hasChildren', () => {
  it('is false for a card with no children', () => {
    const root = createRootCard()
    expect(hasChildren([root], root.id)).toBe(false)
  })

  it('is true for a card with at least one child', () => {
    const root = createRootCard()
    const { cards } = addChild([root], root.id)
    expect(hasChildren(cards, root.id)).toBe(true)
  })
})

describe('deleteCard', () => {
  it('removes a leaf card and reindexes its remaining siblings', () => {
    const root = createRootCard()
    const { cards: c1, newCardId: firstChild } = addChild([root], root.id)
    const { cards: c2, newCardId: secondChild } = addChild(c1, root.id)
    const result = deleteCard(c2, firstChild)
    expect(result.find(c => c.id === firstChild)).toBeUndefined()
    const remainingChild = result.find(c => c.id === secondChild)!
    expect(remainingChild.order).toBe(0)
  })

  it('cascades deletion to descendants', () => {
    const root = createRootCard()
    const { cards: c1, newCardId: childId } = addChild([root], root.id)
    const { cards: c2, newCardId: grandchildId } = addChild(c1, childId)
    const result = deleteCard(c2, childId)
    expect(result.find(c => c.id === childId)).toBeUndefined()
    expect(result.find(c => c.id === grandchildId)).toBeUndefined()
    expect(result).toHaveLength(1)
  })

  it('empties the root instead of deleting it (single-root invariant)', () => {
    const root = createRootCard()
    const { cards: c1, newCardId: childId } = addChild([root], root.id)
    const { cards: c2, newCardId: grandchildId } = addChild(c1, childId)
    const result = deleteCard(c2, root.id)
    expect(result.map(c => c.id)).toEqual([root.id])
    expect(result.find(c => c.id === childId)).toBeUndefined()
    expect(result.find(c => c.id === grandchildId)).toBeUndefined()
  })
})

describe('moveCardToIndex', () => {
  it('moves a card to a new index among its siblings and reindexes order', () => {
    const root = createRootCard()
    const { cards: c1, newCardId: first } = addChild([root], root.id)
    const { cards: c2, newCardId: second } = addChild(c1, root.id)
    const { cards: c3, newCardId: third } = addChild(c2, root.id)

    const result = moveCardToIndex(c3, first, 2)
    const siblings = result.filter(c => c.parentId === root.id).sort((a, b) => a.order - b.order)
    expect(siblings.map(c => c.id)).toEqual([second, third, first])
  })

  it('clamps out-of-range indexes to the valid range', () => {
    const root = createRootCard()
    const { cards: c1, newCardId: first } = addChild([root], root.id)
    const { cards: c2, newCardId: second } = addChild(c1, root.id)
    const result = moveCardToIndex(c2, first, 999)
    const siblings = result.filter(c => c.parentId === root.id).sort((a, b) => a.order - b.order)
    expect(siblings.map(c => c.id)).toEqual([second, first])
  })
})

describe('moveCardToParent', () => {
  function twoBranchTree() {
    const root = createRootCard()
    const { cards: c1, newCardId: branchA } = addChild([root], root.id)
    const { cards: c2, newCardId: branchB } = addChild(c1, root.id)
    const { cards: c3, newCardId: leaf } = addChild(c2, branchA)
    return { cards: c3, root, branchA, branchB, leaf }
  }

  it('reattaches the card to the new parent, keeping its level unchanged', () => {
    const { cards, branchB, leaf } = twoBranchTree()
    const result = moveCardToParent(cards, leaf, branchB)
    const moved = result.find(c => c.id === leaf)!
    expect(moved.parentId).toBe(branchB)
    expect(moved.level).toBe(3)
  })

  it('appends the card at the end of the new sibling group', () => {
    const { cards, branchB, leaf } = twoBranchTree()
    const { cards: withOtherChild, newCardId: otherChild } = addChild(cards, branchB)
    const result = moveCardToParent(withOtherChild, leaf, branchB)
    const siblings = result.filter(c => c.parentId === branchB).sort((a, b) => a.order - b.order)
    expect(siblings.map(c => c.id)).toEqual([otherChild, leaf])
  })

  it('reindexes the old sibling group after the card leaves', () => {
    const { cards, branchA, branchB, leaf } = twoBranchTree()
    const { cards: withOtherLeaf, newCardId: otherLeaf } = addChild(cards, branchA)
    const result = moveCardToParent(withOtherLeaf, leaf, branchB)
    const oldSiblings = result.filter(c => c.parentId === branchA)
    expect(oldSiblings.map(c => c.id)).toEqual([otherLeaf])
    expect(oldSiblings[0].order).toBe(0)
  })

  it('accepts a parent at any level and re-levels the moved card', () => {
    const { cards, root, leaf } = twoBranchTree()
    const result = moveCardToParent(cards, leaf, root.id)
    expect(result.find(c => c.id === leaf)!.level).toBe(2)
    expect(result.find(c => c.id === leaf)!.parentId).toBe(root.id)
  })

  it('throws when the new parent is one of the card’s own descendants (cycle)', () => {
    const { cards, branchA, leaf } = twoBranchTree()
    expect(() => moveCardToParent(cards, branchA, leaf)).toThrow()
  })

  it('throws when trying to reparent the root card (single-root invariant)', () => {
    const { cards, root, branchB } = twoBranchTree()
    expect(() => moveCardToParent(cards, root.id, branchB)).toThrow()
  })

  it('throws when the new parent does not exist', () => {
    const { cards, leaf } = twoBranchTree()
    expect(() => moveCardToParent(cards, leaf, 'missing')).toThrow()
  })

  it('is a no-op when the new parent is already the current parent', () => {
    const { cards, branchA, leaf } = twoBranchTree()
    const result = moveCardToParent(cards, leaf, branchA)
    expect(result).toEqual(cards)
  })

  it('does not mutate the input cards array or its objects', () => {
    const { cards, branchB, leaf } = twoBranchTree()
    const before = structuredClone(cards)
    moveCardToParent(cards, leaf, branchB)
    expect(cards).toEqual(before)
  })
})

// Undo/redo keeps previous Card[] snapshots alive in the history stack. If any
// reducer mutated a Card object (rather than returning a fresh one), every past
// snapshot sharing that object would silently change too, corrupting undo.
describe('reducer immutability', () => {
  function threeChildTree() {
    const root = createRootCard()
    const { cards: c1, newCardId: first } = addChild([root], root.id)
    const { cards: c2, newCardId: second } = addChild(c1, root.id)
    const { cards: c3, newCardId: third } = addChild(c2, root.id)
    return { cards: c3, root, first, second, third }
  }

  it('addSibling does not mutate the input cards array or its objects', () => {
    const { cards, first } = threeChildTree()
    const before = structuredClone(cards)
    addSibling(cards, first, 'below')
    expect(cards).toEqual(before)
  })

  it('deleteCard does not mutate the input cards array or its objects', () => {
    const { cards, first } = threeChildTree()
    const before = structuredClone(cards)
    deleteCard(cards, first)
    expect(cards).toEqual(before)
  })

  it('moveCardToIndex does not mutate the input cards array or its objects', () => {
    const { cards, first } = threeChildTree()
    const before = structuredClone(cards)
    moveCardToIndex(cards, first, 2)
    expect(cards).toEqual(before)
  })

  it('addChild, updateTitle and updateDefinition do not mutate their input either', () => {
    const { cards, root, first } = threeChildTree()
    const before = structuredClone(cards)
    addChild(cards, root.id)
    updateTitle(cards, first, 'autre titre')
    updateDefinition(cards, first, 'une définition')
    expect(cards).toEqual(before)
  })
})

// ---------------------------------------------------------------------------
// Restructuring: cross-level moves, the 4-level ceiling and floating cards.
// ---------------------------------------------------------------------------

/** root(1) -> a(2) -> b(3) -> c(4), plus a second level-2 branch `other`. */
function deepTree() {
  const root = createRootCard()
  const { cards: c1, newCardId: a } = addChild([root], root.id)
  const { cards: c2, newCardId: b } = addChild(c1, a)
  const { cards: c3, newCardId: c } = addChild(c2, b)
  const { cards: c4, newCardId: other } = addChild(c3, root.id)
  return { cards: c4, root: root.id, a, b, c, other }
}

describe('subtreeDepths', () => {
  it('maps every card of the branch to its depth relative to its root', () => {
    const { cards, a, b, c } = deepTree()
    expect([...subtreeDepths(cards, a).entries()]).toEqual([
      [a, 0],
      [b, 1],
      [c, 2],
    ])
  })

  it('is just the card itself for a leaf', () => {
    const { cards, c } = deepTree()
    expect([...subtreeDepths(cards, c).keys()]).toEqual([c])
  })
})

describe('flattenedCardCount', () => {
  it('counts the card plus every descendant', () => {
    const { cards, a } = deepTree()
    expect(flattenedCardCount(cards, a)).toBe(3)
    expect(flattenedCardCount(cards, a)).toBe(countDescendants(cards, a) + 1)
  })
})

describe('canMoveCardTo', () => {
  it('accepts a parent at a completely different level', () => {
    const { cards, c, root } = deepTree()
    expect(canMoveCardTo(cards, c, root)).toBe(true)
  })

  it('rejects the root as the moved card', () => {
    const { cards, root, other } = deepTree()
    expect(canMoveCardTo(cards, root, other)).toBe(false)
  })

  it('rejects a level-4 parent (no level 5 to put the child on)', () => {
    const { cards, other, c } = deepTree()
    expect(canMoveCardTo(cards, other, c)).toBe(false)
  })

  it('rejects a detached parent (floating cards cannot have children)', () => {
    const { cards, other, c } = deepTree()
    const detached = detachCard(cards, c)
    expect(canMoveCardTo(detached, other, c)).toBe(false)
  })

  it('rejects the card itself and any of its own descendants (cycle)', () => {
    const { cards, a, b } = deepTree()
    expect(canMoveCardTo(cards, a, a)).toBe(false)
    expect(canMoveCardTo(cards, a, b)).toBe(false)
  })
})

describe('overflowingCardCount', () => {
  it('is 0 when the whole branch still fits under the new parent', () => {
    const { cards, b, other } = deepTree()
    // b(+c) under `other`(2) lands on levels 3 and 4: it fits.
    expect(overflowingCardCount(cards, b, other)).toBe(0)
  })

  it('counts the cards that would land past level 4', () => {
    const { cards, a, other } = deepTree()
    // a(+b+c) under `other`(2) would land on levels 3, 4 and 5: c overflows.
    expect(overflowingCardCount(cards, a, other)).toBe(1)
  })

  it('is 0 for a move that is not allowed at all', () => {
    const { cards, a, b } = deepTree()
    expect(overflowingCardCount(cards, a, b)).toBe(0)
  })
})

describe('moveCard', () => {
  it('re-levels the whole moved branch under its new parent', () => {
    const { cards, b, root } = deepTree()
    const { cards: result, detachedIds } = moveCard(cards, b, root)
    expect(detachedIds).toEqual([])
    expect(result.find(c => c.id === b)!.level).toBe(2)
    expect(result.find(c => c.parentId === b)!.level).toBe(3)
  })

  it('inserts the card at the requested index among its new siblings', () => {
    const { cards, root, other, c } = deepTree()
    const result = moveCard(cards, c, root, 0).cards
    const children = result.filter(x => x.parentId === root).sort((x, y) => x.order - y.order)
    expect(children.map(x => x.id)[0]).toBe(c)
    expect(children.map(x => x.id)).toContain(other)
    expect(children.map(x => x.order)).toEqual([0, 1, 2])
  })

  it('clamps an out-of-range index to the end of the group', () => {
    const { cards, root, c } = deepTree()
    const result = moveCard(cards, c, root, 99).cards
    const children = result.filter(x => x.parentId === root).sort((x, y) => x.order - y.order)
    expect(children[children.length - 1].id).toBe(c)
  })

  it('reindexes the sibling group the card left behind', () => {
    const { cards, root, a, other } = deepTree()
    const result = moveCard(cards, other, a, 0).cards
    const rootChildren = result.filter(x => x.parentId === root)
    expect(rootChildren.map(x => x.order)).toEqual([0])
  })

  it('detaches the descendants pushed past level 4, flattening them', () => {
    const { cards, a, other } = deepTree()
    const { cards: result, detachedIds } = moveCard(cards, a, other)
    const c = result.find(x => detachedIds.includes(x.id))!
    expect(detachedIds).toHaveLength(1)
    expect(c.detached).toBe(true)
    expect(c.parentId).toBeNull()
    // The cards that still fit keep their place in the hierarchy.
    expect(result.find(x => x.id === a)!.level).toBe(3)
    expect(result.filter(x => !x.detached).map(x => x.level).every(l => l <= 4)).toBe(true)
  })

  it('re-attaches a floating card, clearing its detached flag', () => {
    const { cards, c, other } = deepTree()
    const detached = detachCard(cards, c)
    const result = moveCard(detached, c, other).cards
    const reattached = result.find(x => x.id === c)!
    expect(reattached.detached).toBeUndefined()
    expect(reattached.parentId).toBe(other)
    expect(reattached.level).toBe(3)
  })

  it('refuses to move the root, to a level-4 parent, or into its own branch', () => {
    const { cards, root, a, b, c, other } = deepTree()
    expect(() => moveCard(cards, root, other)).toThrow()
    expect(() => moveCard(cards, other, c)).toThrow()
    expect(() => moveCard(cards, a, b)).toThrow()
  })

  it('does not mutate the input cards array or its objects', () => {
    const { cards, a, other } = deepTree()
    const before = structuredClone(cards)
    moveCard(cards, a, other)
    expect(cards).toEqual(before)
  })
})

describe('detachCard', () => {
  it('turns a leaf into a floating card', () => {
    const { cards, c } = deepTree()
    const result = detachCard(cards, c)
    const detached = result.find(x => x.id === c)!
    expect(detached.detached).toBe(true)
    expect(detached.parentId).toBeNull()
  })

  it('flattens the whole branch: every descendant becomes its own floating card', () => {
    const { cards, a, b, c } = deepTree()
    const result = detachCard(cards, a)
    for (const id of [a, b, c]) {
      const card = result.find(x => x.id === id)!
      expect(card.detached).toBe(true)
      expect(card.parentId).toBeNull()
    }
    expect(result.filter(x => x.detached).map(x => x.order)).toEqual([0, 1, 2])
  })

  it('reindexes the sibling group it left and appends after existing floating cards', () => {
    const { cards, root, a, other } = deepTree()
    const first = detachCard(cards, other)
    const second = detachCard(first, a)
    expect(second.filter(x => x.parentId === root && !x.detached)).toHaveLength(0)
    const detachedOrders = second.filter(x => x.detached).sort((x, y) => x.order - y.order)
    expect(detachedOrders.map(x => x.order)).toEqual([0, 1, 2, 3])
    expect(detachedOrders[0].id).toBe(other)
  })

  it('refuses to detach the root and is a no-op on an already floating card', () => {
    const { cards, root, c } = deepTree()
    expect(() => detachCard(cards, root)).toThrow()
    const detached = detachCard(cards, c)
    expect(detachCard(detached, c)).toBe(detached)
  })

  it('does not mutate the input cards array or its objects', () => {
    const { cards, a } = deepTree()
    const before = structuredClone(cards)
    detachCard(cards, a)
    expect(cards).toEqual(before)
  })
})

describe('deleteCardDetachingChildren', () => {
  it('removes the card and keeps its descendants as flattened floating cards', () => {
    const { cards, a, b, c } = deepTree()
    const result = deleteCardDetachingChildren(cards, a)
    expect(result.find(x => x.id === a)).toBeUndefined()
    for (const id of [b, c]) {
      const card = result.find(x => x.id === id)!
      expect(card.detached).toBe(true)
      expect(card.parentId).toBeNull()
    }
  })

  it('keeps the root itself, emptying its hierarchy into the floating zone', () => {
    const { cards, root, a, other } = deepTree()
    const result = deleteCardDetachingChildren(cards, root)
    expect(result.find(x => x.id === root)!.detached).toBeUndefined()
    expect(result.filter(x => x.detached)).toHaveLength(cards.length - 1)
    expect(result.find(x => x.id === a)!.detached).toBe(true)
    expect(result.find(x => x.id === other)!.detached).toBe(true)
  })

  it('does not mutate the input cards array or its objects', () => {
    const { cards, a } = deepTree()
    const before = structuredClone(cards)
    deleteCardDetachingChildren(cards, a)
    expect(cards).toEqual(before)
  })
})

describe('detached card invariants', () => {
  it('addChild and addSibling both refuse a floating card', () => {
    const { cards, c } = deepTree()
    const detached = detachCard(cards, c)
    expect(() => addChild(detached, c)).toThrow()
    expect(() => addSibling(detached, c, 'below')).toThrow()
  })

  it('a floating card can still be deleted (it is not the root)', () => {
    const { cards, c } = deepTree()
    const detached = detachCard(cards, c)
    expect(deleteCard(detached, c).find(x => x.id === c)).toBeUndefined()
  })
})
