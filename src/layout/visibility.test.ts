import { describe, it, expect } from 'vitest'
import { isFullyVisible } from './visibility'

const pane = { left: 0, top: 0, right: 1000, bottom: 600 }

describe('isFullyVisible', () => {
  it('accepts a card well inside the pane', () => {
    expect(isFullyVisible({ left: 100, top: 100, right: 300, bottom: 200 }, pane)).toBe(true)
  })

  it('rejects a card the fiche panel would cover', () => {
    // The failure the recentring exists to prevent: the card you clicked ends
    // up behind the panel you opened to read it.
    expect(isFullyVisible({ left: 900, top: 100, right: 1100, bottom: 200 }, pane)).toBe(false)
  })

  it('rejects a card clipped by any edge', () => {
    for (const clipped of [
      { left: -10, top: 100, right: 190, bottom: 200 },
      { left: 100, top: -10, right: 300, bottom: 90 },
      { left: 100, top: 550, right: 300, bottom: 650 },
    ]) {
      expect(isFullyVisible(clipped, pane), JSON.stringify(clipped)).toBe(false)
    }
  })

  it('treats a card merely grazing the edge as not visible, given a margin', () => {
    // Half a card, and the sibling "+" buttons that straddle its border, are
    // not something you can work with.
    const grazing = { left: 100, top: 100, right: 995, bottom: 200 }
    expect(isFullyVisible(grazing, pane)).toBe(true)
    expect(isFullyVisible(grazing, pane, 24)).toBe(false)
  })

  it('accepts a card exactly on the boundary when no margin is asked for', () => {
    expect(isFullyVisible({ left: 0, top: 0, right: 1000, bottom: 600 }, pane)).toBe(true)
  })
})
