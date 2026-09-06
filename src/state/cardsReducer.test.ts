import { describe, it, expect } from 'vitest'
import { createRootCard, addChild, addSibling, updateTitle, updateDefinition, countDescendants, hasChildren, deleteCard, moveCardToIndex, moveCardToParent } from './cardsReducer'
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

  it('throws when trying to delete the root card', () => {
    const root = createRootCard()
    expect(() => deleteCard([root], root.id)).toThrow()
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

  it('throws when the new parent is not at the level directly above the card', () => {
    const { cards, root, leaf } = twoBranchTree()
    expect(() => moveCardToParent(cards, leaf, root.id)).toThrow()
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
