import { describe, it, expect } from 'vitest'
import { createRootCard, addChild, addSibling } from './cardsReducer'
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
