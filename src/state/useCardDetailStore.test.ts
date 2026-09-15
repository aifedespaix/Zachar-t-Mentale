import { describe, it, expect, beforeEach } from 'vitest'
import { useCardDetailStore } from './useCardDetailStore'

const ids = () => useCardDetailStore.getState().open.map(entry => entry.cardId)

describe('useCardDetailStore', () => {
  beforeEach(() => {
    useCardDetailStore.getState().closeAll()
  })

  it('stacks a newly opened card instead of replacing the preview — the panel is always a stack', () => {
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

  it('unfolds a collapsed fiche that is opened again', () => {
    useCardDetailStore.getState().show('a')
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
    useCardDetailStore.getState().show('b')
    useCardDetailStore.getState().setEditing('b')
    useCardDetailStore.getState().close('a')

    expect(useCardDetailStore.getState().editingCardId).toBe('b')
  })

  it('drops fiches for cards that no longer exist', () => {
    useCardDetailStore.getState().show('a')
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
    useCardDetailStore.getState().setEditing('a')

    useCardDetailStore.getState().closeAll()

    expect(ids()).toEqual([])
    expect(useCardDetailStore.getState().editingCardId).toBeNull()
  })
})
