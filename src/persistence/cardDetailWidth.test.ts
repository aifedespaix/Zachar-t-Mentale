import { describe, it, expect, beforeEach } from 'vitest'
import {
  clampCardDetailWidth,
  loadCardDetailWidth,
  saveCardDetailWidth,
  DEFAULT_CARD_DETAIL_WIDTH,
  MAX_CARD_DETAIL_WIDTH,
  MIN_CARD_DETAIL_WIDTH,
} from './cardDetailWidth'
import { loadSidebarWidth, saveSidebarWidth, DEFAULT_SIDEBAR_WIDTH } from './sidebarWidth'

describe('clampCardDetailWidth', () => {
  it('keeps a width that is already inside the bounds', () => {
    expect(clampCardDetailWidth(420)).toBe(420)
  })

  it('clamps to the bounds rather than rejecting', () => {
    expect(clampCardDetailWidth(10)).toBe(MIN_CARD_DETAIL_WIDTH)
    expect(clampCardDetailWidth(5000)).toBe(MAX_CARD_DETAIL_WIDTH)
  })

  it('falls back to the default for a non-finite width', () => {
    expect(clampCardDetailWidth(Number.NaN)).toBe(DEFAULT_CARD_DETAIL_WIDTH)
  })
})

describe('card detail width persistence', () => {
  beforeEach(() => localStorage.clear())

  it('defaults when nothing was ever saved', () => {
    expect(loadCardDetailWidth()).toBe(DEFAULT_CARD_DETAIL_WIDTH)
  })

  it('restores the width saved by a previous session', () => {
    saveCardDetailWidth(512)
    expect(loadCardDetailWidth()).toBe(512)
  })

  it('clamps an out-of-bounds stored value instead of trusting it', () => {
    localStorage.setItem('zachart-mentale:card-detail-width', '9999')
    expect(loadCardDetailWidth()).toBe(MAX_CARD_DETAIL_WIDTH)
  })

  it('does not share storage with the file sidebar', () => {
    // Both panels go through the same factory now; a shared key would make
    // resizing one silently resize the other.
    saveCardDetailWidth(512)
    expect(loadSidebarWidth()).toBe(DEFAULT_SIDEBAR_WIDTH)

    saveSidebarWidth(200)
    expect(loadCardDetailWidth()).toBe(512)
  })
})
