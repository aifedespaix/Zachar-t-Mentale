import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAppearanceSettingsStore } from './useAppearanceSettingsStore'
import { DEFAULT_APPEARANCE_SETTINGS } from '../types/appearanceSettings'

vi.mock('../persistence/appearanceSettings', () => ({
  loadAppearanceSettings: vi.fn(),
  saveAppearanceSettings: vi.fn(),
}))

import { loadAppearanceSettings, saveAppearanceSettings } from '../persistence/appearanceSettings'

describe('useAppearanceSettingsStore', () => {
  beforeEach(() => {
    vi.mocked(loadAppearanceSettings).mockReset()
    vi.mocked(saveAppearanceSettings).mockReset().mockResolvedValue(undefined)
  })

  it('starts with the defaults before init resolves', () => {
    const store = createAppearanceSettingsStore()
    expect(store.getState().levels).toEqual(DEFAULT_APPEARANCE_SETTINGS.levels)
    expect(store.getState().fontFamily).toBe(DEFAULT_APPEARANCE_SETTINGS.fontFamily)
    expect(store.getState().themeMode).toBe('system')
  })

  it('init loads persisted settings into the store', async () => {
    const persisted = { ...DEFAULT_APPEARANCE_SETTINGS, themeMode: 'dark' as const }
    vi.mocked(loadAppearanceSettings).mockResolvedValue(persisted)
    const store = createAppearanceSettingsStore()

    await store.getState().init()

    expect(store.getState().themeMode).toBe('dark')
  })

  it('falls back to defaults if loading settings throws', async () => {
    vi.mocked(loadAppearanceSettings).mockRejectedValue(new Error('disk error'))
    const store = createAppearanceSettingsStore()

    await store.getState().init()

    expect(store.getState().themeMode).toBe('system')
  })

  it('setFontFamily updates the store and persists it', async () => {
    const store = createAppearanceSettingsStore()

    await store.getState().setFontFamily('Georgia, serif')

    expect(store.getState().fontFamily).toBe('Georgia, serif')
    expect(saveAppearanceSettings).toHaveBeenCalledWith(expect.objectContaining({ fontFamily: 'Georgia, serif' }))
  })

  it('setThemeMode updates the store and persists it', async () => {
    const store = createAppearanceSettingsStore()

    await store.getState().setThemeMode('dark')

    expect(store.getState().themeMode).toBe('dark')
    expect(saveAppearanceSettings).toHaveBeenCalledWith(expect.objectContaining({ themeMode: 'dark' }))
  })

  it('keeps the in-memory value even if persisting it fails', async () => {
    vi.mocked(saveAppearanceSettings).mockRejectedValue(new Error('disk error'))
    const store = createAppearanceSettingsStore()

    await store.getState().setThemeMode('dark')

    expect(store.getState().themeMode).toBe('dark')
  })
})
