import { describe, it, expect, beforeEach } from 'vitest'
import { useCardDetailStore } from './useCardDetailStore'

const ids = () => useCardDetailStore.getState().open.map(entry => entry.cardId)
const pinnedIds = () =>
  useCardDetailStore
    .getState()
    .open.filter(entry => entry.pinned)
    .map(entry => entry.cardId)

describe('useCardDetailStore', () => {
  beforeEach(() => useCardDetailStore.getState().closeAll())

  it('replaces the preview rather than stacking fiches', () => {
    // Without this, browsing a map quietly fills the panel with a dozen cards
    // nobody asked to keep.
    useCardDetailStore.getState().show('a')
    useCardDetailStore.getState().show('b')

    expect(ids()).toEqual(['b'])
  })

  it('keeps pinned fiches and opens the next one below them', () => {
    useCardDetailStore.getState().show('a')
    useCardDetailStore.getState().pin('a')
    useCardDetailStore.getState().show('b')

    expect(ids()).toEqual(['a', 'b'])
    expect(pinnedIds()).toEqual(['a'])
  })

  it('drops only the unpinned fiche when a third card is opened', () => {
    useCardDetailStore.getState().show('a')
    useCardDetailStore.getState().pin('a')
    useCardDetailStore.getState().show('b')
    useCardDetailStore.getState().pin('b')
    useCardDetailStore.getState().show('c')
    useCardDetailStore.getState().show('d')

    expect(ids()).toEqual(['a', 'b', 'd'])
  })

  it('never demotes a pinned fiche back to a preview', () => {
    // Re-clicking a pinned card's button must not make it the entry the NEXT
    // click discards.
    useCardDetailStore.getState().show('a')
    useCardDetailStore.getState().pin('a')
    useCardDetailStore.getState().show('a')

    expect(pinnedIds()).toEqual(['a'])
    expect(ids()).toEqual(['a'])
  })

  it('unfolds a collapsed fiche that is opened again', () => {
    useCardDetailStore.getState().show('a')
    useCardDetailStore.getState().pin('a')
    useCardDetailStore.getState().toggleCollapsed('a')
    useCardDetailStore.getState().show('a')

    expect(useCardDetailStore.getState().open[0].collapsed).toBe(false)
  })

  it('closes the editor along with the fiche it belongs to', () => {
    useCardDetailStore.getState().show('a')
    useCardDetailStore.getState().setEditing('a')
    useCardDetailStore.getState().close('a')

    expect(useCardDetailStore.getState().editingCardId).toBeNull()
  })

  it('leaves another card’s editor alone when closing a fiche', () => {
    useCardDetailStore.getState().show('a')
    useCardDetailStore.getState().pin('a')
    useCardDetailStore.getState().show('b')
    useCardDetailStore.getState().setEditing('b')
    useCardDetailStore.getState().close('a')

    expect(useCardDetailStore.getState().editingCardId).toBe('b')
  })

  it('drops fiches for cards that no longer exist', () => {
    useCardDetailStore.getState().show('a')
    useCardDetailStore.getState().pin('a')
    useCardDetailStore.getState().show('b')
    useCardDetailStore.getState().setEditing('b')

    useCardDetailStore.getState().retain(new Set(['a']))

    expect(ids()).toEqual(['a'])
    expect(useCardDetailStore.getState().editingCardId).toBeNull()
  })

  it('keeps the same state object when every open card still exists', () => {
    // `retain` runs on every change to the card list — a keystroke in a title
    // included — so it must not hand subscribers a new array each time.
    useCardDetailStore.getState().show('a')
    const before = useCardDetailStore.getState().open

    useCardDetailStore.getState().retain(new Set(['a', 'b']))

    expect(useCardDetailStore.getState().open).toBe(before)
  })

  it('closes everything, editor included', () => {
    useCardDetailStore.getState().show('a')
    useCardDetailStore.getState().pin('a')
    useCardDetailStore.getState().setEditing('a')

    useCardDetailStore.getState().closeAll()

    expect(ids()).toEqual([])
    expect(useCardDetailStore.getState().editingCardId).toBeNull()
  })
})
