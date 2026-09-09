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

  it('moveCard reparents across levels, reporting and detaching what falls past level 4', () => {
    const store = createCardsStore()
    const rootId = store.getState().history.present[0].id
    const a = store.getState().addChild(rootId)
    const b = store.getState().addChild(a)
    const c = store.getState().addChild(b)
    const other = store.getState().addChild(rootId)

    expect(store.getState().overflowCount(a, other)).toBe(1)
    const detachedIds = store.getState().moveCard(a, other)
    expect(detachedIds).toEqual([c])
    expect(store.getState().history.present.find(x => x.id === c)?.detached).toBe(true)
    expect(store.getState().history.present.find(x => x.id === a)?.level).toBe(3)

    store.getState().undo()
    expect(store.getState().history.present.find(x => x.id === c)?.parentId).toBe(b)
  })

  it('detachCard flattens a branch into floating cards and is undoable', () => {
    const store = createCardsStore()
    const rootId = store.getState().history.present[0].id
    const a = store.getState().addChild(rootId)
    const b = store.getState().addChild(a)

    expect(store.getState().flattenedCount(a)).toBe(2)
    store.getState().detachCard(a)
    expect(store.getState().history.present.filter(c => c.detached).map(c => c.id)).toEqual([a, b])

    store.getState().undo()
    expect(store.getState().history.present.some(c => c.detached)).toBe(false)
  })

  it('addFloatingCard adds a floating card and is undoable', () => {
    const store = createCardsStore()
    const newCardId = store.getState().addFloatingCard()
    expect(store.getState().history.present.find(c => c.id === newCardId)?.detached).toBe(true)

    store.getState().undo()
    expect(store.getState().history.present.find(c => c.id === newCardId)).toBeUndefined()
  })

  it('deleteCardDetachingChildren drops the card and keeps its branch afloat', () => {
    const store = createCardsStore()
    const rootId = store.getState().history.present[0].id
    const a = store.getState().addChild(rootId)
    const b = store.getState().addChild(a)

    store.getState().deleteCardDetachingChildren(a)
    expect(store.getState().history.present.find(c => c.id === a)).toBeUndefined()
    expect(store.getState().history.present.find(c => c.id === b)?.detached).toBe(true)

    store.getState().undo()
    expect(store.getState().history.present.find(c => c.id === a)).toBeDefined()
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

  describe('updateContent', () => {
    it('writes content with its derived definition, and is undoable', () => {
      const store = createCardsStore()
      const rootId = store.getState().history.present[0].id

      store.getState().updateContent(rootId, [{ kind: 'math', latex: 'x^2' }])
      const after = store.getState().history.present[0]
      expect(after.content).toEqual([{ kind: 'math', latex: 'x^2' }])
      expect(after.definition).toBe('x²')

      store.getState().undo()
      expect(store.getState().history.present[0].content).toBeUndefined()
      expect(store.getState().history.present[0].definition).toBeUndefined()

      store.getState().redo()
      expect(store.getState().history.present[0].definition).toBe('x²')
    })

    it('pushes exactly one undo entry per content change', () => {
      const store = createCardsStore()
      const rootId = store.getState().history.present[0].id

      store.getState().updateContent(rootId, [{ kind: 'math', latex: 'x^2' }])
      store.getState().undo()

      expect(store.getState().history.present[0].definition).toBeUndefined()
    })

    it('does not push a history entry for a card that does not exist', () => {
      // The single write path must not let a no-op consume the user's undo.
      const store = createCardsStore()
      const before = store.getState().history.past.length

      store.getState().updateContent('inconnu', [{ kind: 'math', latex: 'x^2' }])

      expect(store.getState().history.past.length).toBe(before)
    })

    it('updateDefinition clears a stale content through the same path', () => {
      const store = createCardsStore()
      const rootId = store.getState().history.present[0].id
      store.getState().updateContent(rootId, [{ kind: 'math', latex: 'x^2' }])

      store.getState().updateDefinition(rootId, 'Juste du texte')

      const after = store.getState().history.present[0]
      expect('content' in after).toBe(false)
      expect(after.definition).toBe('Juste du texte')
    })
  })
})
