import { describe, it, expect, beforeEach } from 'vitest'
import { useCardHoverStore } from './useCardHoverStore'

describe('useCardHoverStore', () => {
  beforeEach(() => {
    useCardHoverStore.getState().reset()
  })

  it('starts with nothing hovered', () => {
    expect(useCardHoverStore.getState().hoveredCardId).toBeNull()
  })

  it('publishes the hovered card id', () => {
    useCardHoverStore.getState().hover('a')
    expect(useCardHoverStore.getState().hoveredCardId).toBe('a')
  })

  it('clears the hover when the same card leaves', () => {
    useCardHoverStore.getState().hover('a')
    useCardHoverStore.getState().unhover('a')
    expect(useCardHoverStore.getState().hoveredCardId).toBeNull()
  })

  it('does not let a late leave snuff out a newer hover', () => {
    // The pointer moved from 'a' to 'b'; 'a's mouseleave can land after 'b's
    // mouseenter, and the highlight the user just caused must survive it.
    useCardHoverStore.getState().hover('a')
    useCardHoverStore.getState().hover('b')
    useCardHoverStore.getState().unhover('a')
    expect(useCardHoverStore.getState().hoveredCardId).toBe('b')
  })

  it('reset drops any hover', () => {
    useCardHoverStore.getState().hover('a')
    useCardHoverStore.getState().reset()
    expect(useCardHoverStore.getState().hoveredCardId).toBeNull()
  })
})
