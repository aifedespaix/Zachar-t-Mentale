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

  // A value the app does not know (a future version, a typo in a hand-edited
  // file) used to make mapTypeColor index an absent key and throw mid-render,
  // which unmounts the whole app. It now falls back to the neutral palette.
  it('falls back to the neutral palette for a value the app does not know, in both themes, without throwing', () => {
    expect(mapTypeColor('futur', 'light')).toBe(neutralMapTypeColors.light)
    expect(mapTypeColor('futur', 'dark')).toBe(neutralMapTypeColors.dark)
    expect(() => mapTypeColor('futur', 'light')).not.toThrow()
  })

  it('renders no pill at all for undefined, the empty string and default', () => {
    expect(mapTypeColor(undefined, 'light')).toBeNull()
    expect(mapTypeColor(undefined, 'dark')).toBeNull()
    expect(mapTypeColor('', 'light')).toBeNull()
    expect(mapTypeColor('', 'dark')).toBeNull()
    expect(mapTypeColor('default', 'light')).toBeNull()
    expect(mapTypeColor('default', 'dark')).toBeNull()
  })

  it('keeps the four known types on their own palette, never the neutral fallback', () => {
    for (const type of ['cours', 'exo', 'prise de notes', 'corrections'] as const) {
      expect(mapTypeColor(type, 'light')).toBe(mapTypeColors[type].light)
      expect(mapTypeColor(type, 'dark')).toBe(mapTypeColors[type].dark)
      expect(mapTypeColor(type, 'light')).not.toBe(neutralMapTypeColors.light)
      expect(mapTypeColor(type, 'dark')).not.toBe(neutralMapTypeColors.dark)
    }
  })
})
