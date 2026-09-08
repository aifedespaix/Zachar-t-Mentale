import { describe, it, expect } from 'vitest'
import { oklchWcagContrast } from '../colors/contrast'
import { DEFAULT_APPEARANCE_SETTINGS, mergeAppearanceSettings } from './appearanceSettings'

describe('DEFAULT_APPEARANCE_SETTINGS', () => {
  it.each([1, 2, 3, 4] as const)('level %s light and dark text meet WCAG AA against their background', level => {
    const { light, dark } = DEFAULT_APPEARANCE_SETTINGS.levels[level].color
    expect(oklchWcagContrast(light.bg, light.text)).toBeGreaterThanOrEqual(4.5)
    expect(oklchWcagContrast(dark.bg, dark.text)).toBeGreaterThanOrEqual(4.5)
  })

  it('defaults to the system theme', () => {
    expect(DEFAULT_APPEARANCE_SETTINGS.themeMode).toBe('system')
  })

  it('has the expected default labels', () => {
    expect(DEFAULT_APPEARANCE_SETTINGS.levels[1].label).toBe('Titre')
    expect(DEFAULT_APPEARANCE_SETTINGS.levels[2].label).toBe('Sous-titre')
    expect(DEFAULT_APPEARANCE_SETTINGS.levels[3].label).toBe('Sous-partie')
    expect(DEFAULT_APPEARANCE_SETTINGS.levels[4].label).toBe('Info')
  })
})

describe('mergeAppearanceSettings', () => {
  it('returns the defaults when given null or undefined', () => {
    expect(mergeAppearanceSettings(null)).toEqual(DEFAULT_APPEARANCE_SETTINGS)
    expect(mergeAppearanceSettings(undefined)).toEqual(DEFAULT_APPEARANCE_SETTINGS)
  })

  it('keeps defaults for levels/fields absent from a partial file', () => {
    const merged = mergeAppearanceSettings({ levels: { 2: { label: 'Custom' } } })
    expect(merged.levels[2].label).toBe('Custom')
    expect(merged.levels[2].color).toEqual(DEFAULT_APPEARANCE_SETTINGS.levels[2].color)
    expect(merged.levels[1]).toEqual(DEFAULT_APPEARANCE_SETTINGS.levels[1])
    expect(merged.levels[3]).toEqual(DEFAULT_APPEARANCE_SETTINGS.levels[3])
    expect(merged.levels[4]).toEqual(DEFAULT_APPEARANCE_SETTINGS.levels[4])
  })

  it('keeps the rest of the light color and the whole dark color when a file only overrides one field', () => {
    const merged = mergeAppearanceSettings({ levels: { 1: { color: { light: { bg: { l: 0.5, c: 0.1, h: 10 } } } } } })
    expect(merged.levels[1].color.light.bg).toEqual({ l: 0.5, c: 0.1, h: 10 })
    expect(merged.levels[1].color.light.border).toEqual(DEFAULT_APPEARANCE_SETTINGS.levels[1].color.light.border)
    expect(merged.levels[1].color.light.text).toEqual(DEFAULT_APPEARANCE_SETTINGS.levels[1].color.light.text)
    expect(merged.levels[1].color.dark).toEqual(DEFAULT_APPEARANCE_SETTINGS.levels[1].color.dark)
  })

  it('keeps default fontFamily/themeMode when absent', () => {
    const merged = mergeAppearanceSettings({ levels: {} })
    expect(merged.fontFamily).toBe(DEFAULT_APPEARANCE_SETTINGS.fontFamily)
    expect(merged.themeMode).toBe('system')
  })

  it('applies an explicit fontFamily and themeMode override', () => {
    const merged = mergeAppearanceSettings({ fontFamily: 'Georgia, serif', themeMode: 'dark' })
    expect(merged.fontFamily).toBe('Georgia, serif')
    expect(merged.themeMode).toBe('dark')
  })
})
