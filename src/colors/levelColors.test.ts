import { describe, it, expect } from 'vitest'
import { oklchWcagContrast } from './contrast'
import { levelColors } from './levelColors'

describe('levelColors', () => {
  it.each(Object.entries(levelColors))('level %s text meets WCAG AA (>=4.5) against its background', (_level, colors) => {
    const ratio = oklchWcagContrast(colors.bg, colors.text)
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })
})
