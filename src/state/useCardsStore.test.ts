import { describe, it, expect } from 'vitest'
import { createCardsStore } from './useCardsStore'

describe('useCardsStore', () => {
  it('starts with a single root card', () => {
    const store = createCardsStore()
    expect(store.getState().history.present).toHaveLength(1)
    expect(store.getState().history.present[0].parentId).toBeNull()
  })

  it('addChild adds a card and is undoable/redoable', () => {
    const store = createCardsStore()
    const rootId = store.getState().history.present[0].id
    store.getState().addChild(rootId)
    expect(store.getState().history.present).toHaveLength(2)

    store.getState().undo()
    expect(store.getState().history.present).toHaveLength(1)

    store.getState().redo()
    expect(store.getState().history.present).toHaveLength(2)
  })

  it('descendantCount reflects the current tree', () => {
    const store = createCardsStore()
    const rootId = store.getState().history.present[0].id
    const childId = store.getState().addChild(rootId)
    store.getState().addChild(childId)
    expect(store.getState().descendantCount(rootId)).toBe(2)
  })

  it('toggleLock flips the locked flag', () => {
    const store = createCardsStore()
    expect(store.getState().locked).toBe(false)
    store.getState().toggleLock()
    expect(store.getState().locked).toBe(true)
  })

  it('moveCardToParent reattaches a card and is undoable', () => {
    const store = createCardsStore()
    const rootId = store.getState().history.present[0].id
    const branchA = store.getState().addChild(rootId)
    const branchB = store.getState().addChild(rootId)
    const leaf = store.getState().addChild(branchA)

    store.getState().moveCardToParent(leaf, branchB)
    expect(store.getState().history.present.find(c => c.id === leaf)?.parentId).toBe(branchB)

    store.getState().undo()
    expect(store.getState().history.present.find(c => c.id === leaf)?.parentId).toBe(branchA)
  })

  it('loadCards replaces the tree and resets history', () => {
    const store = createCardsStore()
    const rootId = store.getState().history.present[0].id
    store.getState().addChild(rootId)
    const freshCards = [{ id: 'x', level: 1 as const, title: 'x', parentId: null, order: 0 }]
    store.getState().loadCards(freshCards)
    expect(store.getState().history.present).toEqual(freshCards)
    expect(store.getState().history.past).toEqual([])
  })
})
