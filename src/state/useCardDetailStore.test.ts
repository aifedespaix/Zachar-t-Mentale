import { describe, it, expect, beforeEach } from 'vitest'
import { useCardDetailStore } from './useCardDetailStore'
import { loadStackMode } from '../persistence/stackMode'

const ids = () => useCardDetailStore.getState().open.map(entry => entry.cardId)
const pinnedIds = () =>
  useCardDetailStore
    .getState()
    .open.filter(entry => entry.pinned)
    .map(entry => entry.cardId)

describe('useCardDetailStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useCardDetailStore.getState().closeAll()
    // Stack mode defaults to on (see stackMode.test.ts); most of these tests
    // exercise the pre-existing "replace the preview" behaviour, which now
    // only applies with it off. The dedicated describe blocks below turn it
    // back on for what they test.
    useCardDetailStore.setState({ stackMode: false })
  })

  it('replaces the preview rather than stacking fiches when stack mode is off', () => {
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

  describe('stack mode', () => {
    beforeEach(() => useCardDetailStore.setState({ stackMode: true }))

    it('stacks a newly opened card instead of replacing the preview', () => {
      useCardDetailStore.getState().show('a')
      useCardDetailStore.getState().show('b')

      expect(ids()).toEqual(['a', 'b'])
    })

    it('does not duplicate a card that is already open', () => {
      useCardDetailStore.getState().show('a')
      useCardDetailStore.getState().show('b')
      useCardDetailStore.getState().show('a')

      expect(ids()).toEqual(['a', 'b'])
    })

    it('is on by default', () => {
      // Reflects `stackMode.test.ts`'s "active by default": a fresh store
      // (module-level `loadStackMode()` fallback) starts stacked, this test
      // just pins that contract at the store's own public surface too.
      useCardDetailStore.setState({ stackMode: loadStackMode() })
      expect(useCardDetailStore.getState().stackMode).toBe(true)
    })

    it('toggles and persists the flag', () => {
      useCardDetailStore.getState().toggleStackMode()
      expect(useCardDetailStore.getState().stackMode).toBe(false)
      expect(loadStackMode()).toBe(false)

      useCardDetailStore.getState().toggleStackMode()
      expect(useCardDetailStore.getState().stackMode).toBe(true)
      expect(loadStackMode()).toBe(true)
    })
  })

  describe('clearUnpinned', () => {
    it('drops every unpinned fiche but keeps the pinned ones', () => {
      useCardDetailStore.setState({ stackMode: true })
      useCardDetailStore.getState().show('a')
      useCardDetailStore.getState().pin('a')
      useCardDetailStore.getState().show('b')
      useCardDetailStore.getState().show('c')

      useCardDetailStore.getState().clearUnpinned()

      expect(ids()).toEqual(['a'])
    })

    it('clears the editor when it belonged to a card that got dropped', () => {
      useCardDetailStore.getState().show('a')
      useCardDetailStore.getState().setEditing('a')

      useCardDetailStore.getState().clearUnpinned()

      expect(useCardDetailStore.getState().editingCardId).toBeNull()
    })

    it('leaves the editor alone when it belongs to a card that stays pinned', () => {
      useCardDetailStore.getState().show('a')
      useCardDetailStore.getState().pin('a')
      useCardDetailStore.getState().setEditing('a')

      useCardDetailStore.getState().clearUnpinned()

      expect(useCardDetailStore.getState().editingCardId).toBe('a')
    })

    it('is a no-op when every open fiche is already pinned', () => {
      useCardDetailStore.getState().show('a')
      useCardDetailStore.getState().pin('a')
      const before = useCardDetailStore.getState().open

      useCardDetailStore.getState().clearUnpinned()

      expect(useCardDetailStore.getState().open).toBe(before)
    })
  })
})
