import { describe, it, expect, beforeEach } from 'vitest'
import {
  clampSidebarWidth,
  loadSidebarWidth,
  saveSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
} from './sidebarWidth'

describe('clampSidebarWidth', () => {
  it('keeps a width that is already inside the bounds', () => {
    expect(clampSidebarWidth(300)).toBe(300)
  })

  it('clamps to the bounds rather than rejecting', () => {
    expect(clampSidebarWidth(10)).toBe(MIN_SIDEBAR_WIDTH)
    expect(clampSidebarWidth(9000)).toBe(MAX_SIDEBAR_WIDTH)
  })

  it('rounds to whole pixels', () => {
    expect(clampSidebarWidth(240.6)).toBe(241)
  })

  it('falls back to the default for a non-finite width', () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(DEFAULT_SIDEBAR_WIDTH)
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SIDEBAR_WIDTH)
  })
})

describe('loadSidebarWidth / saveSidebarWidth', () => {
  beforeEach(() => localStorage.clear())

  it('defaults when nothing was ever saved', () => {
    expect(loadSidebarWidth()).toBe(DEFAULT_SIDEBAR_WIDTH)
  })

  it('restores the width saved by a previous session', () => {
    saveSidebarWidth(320)
    expect(loadSidebarWidth()).toBe(320)
  })

  it('clamps an out-of-bounds stored value instead of trusting it', () => {
    // A hand-edited entry, or one written before the bounds changed.
    localStorage.setItem('zachart-mentale:sidebar-width', '5000')
    expect(loadSidebarWidth()).toBe(MAX_SIDEBAR_WIDTH)
  })

  it('falls back to the default for an unparsable stored value', () => {
    localStorage.setItem('zachart-mentale:sidebar-width', 'nope')
    expect(loadSidebarWidth()).toBe(DEFAULT_SIDEBAR_WIDTH)
  })
})
