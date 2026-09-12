// src/colors/mapTypeColors.test.ts
import { describe, it, expect } from 'vitest'
import { oklchWcagContrast } from './contrast'
import { mapTypeColor, mapTypeColors, neutralMapTypeColors } from './mapTypeColors'

describe('mapTypeColors', () => {
  it.each(Object.entries(mapTypeColors))('%s light text meets WCAG AA (>= 4.5) against its background', (_type, pair) => {
    expect(oklchWcagContrast(pair.light.bg, pair.light.text)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(Object.entries(mapTypeColors))('%s dark text meets WCAG AA (>= 4.5) against its background', (_type, pair) => {
    expect(oklchWcagContrast(pair.dark.bg, pair.dark.text)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the same hue in light and dark for every type', () => {
    for (const pair of Object.values(mapTypeColors)) {
      expect(pair.dark.border.h).toBe(pair.light.border.h)
      expect(pair.dark.bg.h).toBe(pair.light.bg.h)
      expect(pair.dark.text.h).toBe(pair.light.text.h)
    }
  })

  it('covers exactly the four classified types — default has no colour', () => {
    expect(Object.keys(mapTypeColors)).toEqual(['cours', 'exo', 'prise de notes', 'corrections'])
  })

  it('reads « prise de notes » as achromatic: the draft has no colour of its own', () => {
    expect(mapTypeColors['prise de notes'].light.bg.c).toBe(0)
    expect(mapTypeColors['prise de notes'].light.border.c).toBe(0)
    expect(mapTypeColors['prise de notes'].dark.bg.c).toBe(0)
    expect(mapTypeColors['prise de notes'].dark.border.c).toBe(0)
  })

  it('returns no palette for default: it does not render', () => {
    expect(mapTypeColor('default', 'light')).toBeNull()
    expect(mapTypeColor('default', 'dark')).toBeNull()
  })

  it('returns the exact palette for every classified type, per theme', () => {
    for (const type of ['cours', 'exo', 'prise de notes', 'corrections'] as const) {
      expect(mapTypeColor(type, 'light')).toBe(mapTypeColors[type].light)
      expect(mapTypeColor(type, 'dark')).toBe(mapTypeColors[type].dark)
    }
  })

  it('the neutral palette (unknown value) is achromatic and meets WCAG AA in both themes', () => {
    expect(neutralMapTypeColors.light.bg.c).toBe(0)
    expect(neutralMapTypeColors.light.border.c).toBe(0)
    expect(neutralMapTypeColors.dark.bg.c).toBe(0)
    expect(neutralMapTypeColors.dark.border.c).toBe(0)
    expect(oklchWcagContrast(neutralMapTypeColors.light.bg, neutralMapTypeColors.light.text)).toBeGreaterThanOrEqual(4.5)
    expect(oklchWcagContrast(neutralMapTypeColors.dark.bg, neutralMapTypeColors.dark.text)).toBeGreaterThanOrEqual(4.5)
  })
})
