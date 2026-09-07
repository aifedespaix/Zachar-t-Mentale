import { describe, it, expect } from 'vitest'
import { oklchWcagContrast } from './contrast'
import { detachedColors, levelColors } from './levelColors'

describe('levelColors', () => {
  it.each(Object.entries(levelColors))('level %s text meets WCAG AA (>=4.5) against its background', (_level, colors) => {
    const ratio = oklchWcagContrast(colors.bg, colors.text)
    expect(ratio).toBeGreaterThanOrEqual(4.5)
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
    const diff = Math.abs(levelColors[a].border.h - levelColors[b].border.h)
    expect(diff).toBeGreaterThanOrEqual(30)
  })

  it.each([1, 2, 4] as const)('level %s border keeps enough chroma to stay distinguishable', level => {
    expect(levelColors[level].border.c).toBeGreaterThanOrEqual(0.16)
  })

  it('the detached (floating card) palette is achromatic and still meets WCAG AA', () => {
    expect(detachedColors.bg.c).toBe(0)
    expect(detachedColors.border.c).toBe(0)
    expect(oklchWcagContrast(detachedColors.bg, detachedColors.text)).toBeGreaterThanOrEqual(4.5)
  })
})
