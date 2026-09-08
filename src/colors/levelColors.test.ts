import { describe, it, expect } from 'vitest'
import { oklchWcagContrast } from './contrast'
import { detachedColors, levelColor, levelColors } from './levelColors'

describe('levelColors', () => {
  it.each(Object.entries(levelColors))('level %s light text meets WCAG AA (>=4.5) against its background', (_level, pair) => {
    expect(oklchWcagContrast(pair.light.bg, pair.light.text)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(Object.entries(levelColors))('level %s dark text meets WCAG AA (>=4.5) against its background', (_level, pair) => {
    expect(oklchWcagContrast(pair.dark.bg, pair.dark.text)).toBeGreaterThanOrEqual(4.5)
  })

  // Rouge (1), orange (2) and jaune (4) all sit in the warm part of the hue
  // wheel and used to be bunched within 40° of each other — hard to tell
  // apart at a glance, especially for a colorblind reader. Bleu (3) is
  // already far away (h=235) so it is excluded from this pairwise check.
  it.each([
    [1, 2],
    [2, 4],
    [1, 4],
  ] as const)('level %s and level %s borders are at least 30° apart in hue', (a, b) => {
    const diff = Math.abs(levelColors[a].light.border.h - levelColors[b].light.border.h)
    expect(diff).toBeGreaterThanOrEqual(30)
  })

  it.each([1, 2, 4] as const)('level %s border keeps enough chroma to stay distinguishable', level => {
    expect(levelColors[level].light.border.c).toBeGreaterThanOrEqual(0.16)
  })

  // The dark variant is built from the same hue as light — only lightness
  // (and slightly chroma) changes — so distinguishability between levels
  // carries over automatically. Guards against a future edit accidentally
  // picking a different hue for one theme.
  it.each([1, 2, 3, 4] as const)('level %s keeps the same hue in light and dark', level => {
    expect(levelColors[level].dark.border.h).toBe(levelColors[level].light.border.h)
    expect(levelColors[level].dark.bg.h).toBe(levelColors[level].light.bg.h)
    expect(levelColors[level].dark.text.h).toBe(levelColors[level].light.text.h)
  })

  it('the detached (floating card) palette is achromatic and meets WCAG AA in both themes', () => {
    expect(detachedColors.light.bg.c).toBe(0)
    expect(detachedColors.light.border.c).toBe(0)
    expect(detachedColors.dark.bg.c).toBe(0)
    expect(detachedColors.dark.border.c).toBe(0)
    expect(oklchWcagContrast(detachedColors.light.bg, detachedColors.light.text)).toBeGreaterThanOrEqual(4.5)
    expect(oklchWcagContrast(detachedColors.dark.bg, detachedColors.dark.text)).toBeGreaterThanOrEqual(4.5)
  })

  // `levelColors[5]` is `undefined`, and the `.bg` read that follows throws
  // during render — which unmounts the app instead of showing one odd card.
  it('falls back to a real palette for a level a corrupt file made up', () => {
    expect(levelColor(5, 'light')).toEqual(levelColors[4].light)
    expect(levelColor(0, 'light')).toEqual(levelColors[1].light)
    expect(levelColor(Number.NaN, 'light')).toEqual(levelColors[1].light)
  })

  it('returns the exact palette for every real level, per theme', () => {
    for (const level of [1, 2, 3, 4] as const) {
      expect(levelColor(level, 'light')).toBe(levelColors[level].light)
      expect(levelColor(level, 'dark')).toBe(levelColors[level].dark)
    }
  })
})
