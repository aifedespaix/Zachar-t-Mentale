import { describe, it, expect } from 'vitest'
import { iconBadgeFill } from './iconBadge'
import { oklchWcagContrast } from './contrast'
import { levelColors } from './levelColors'
import type { CardLevel } from '../types/card'

const LEVELS: CardLevel[] = [1, 2, 3, 4]

describe('iconBadgeFill', () => {
  it('keeps the border hue, so the badge reads as part of its card', () => {
    const border = { l: 0.55, c: 0.18, h: 25 }
    expect(iconBadgeFill(border, 'light').h).toBe(25)
    expect(iconBadgeFill(border, 'dark').h).toBe(25)
  })

  it('caps chroma so the fill stays a wash rather than a second coloured block', () => {
    const vivid = { l: 0.55, c: 0.3, h: 70 }
    expect(iconBadgeFill(vivid, 'light').c).toBeLessThanOrEqual(0.04)
    expect(iconBadgeFill(vivid, 'dark').c).toBeLessThanOrEqual(0.05)
  })

  it('leaves a low-chroma border alone rather than pushing it up', () => {
    const pale = { l: 0.55, c: 0.01, h: 200 }
    expect(iconBadgeFill(pale, 'light').c).toBe(0.01)
  })

  it.each(LEVELS)('level %s: the icon stays legible on its own fill, in both themes', level => {
    for (const theme of ['light', 'dark'] as const) {
      const border = levelColors[level][theme].border
      // The icon is drawn in the border colour ON this fill, so the two have to
      // stay far enough apart to read at 14px.
      expect(oklchWcagContrast(iconBadgeFill(border, theme), border)).toBeGreaterThanOrEqual(3)
    }
  })
})
