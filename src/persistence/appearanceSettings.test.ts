import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadAppearanceSettings, saveAppearanceSettings } from './appearanceSettings'
import { DEFAULT_APPEARANCE_SETTINGS } from '../types/appearanceSettings'

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
}))
vi.mock('@tauri-apps/api/path', () => ({
  appConfigDir: vi.fn().mockResolvedValue('/fake/config'),
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
}))

import { exists, readTextFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs'

describe('loadAppearanceSettings', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(readTextFile).mockReset()
  })

  it('returns the defaults when no settings file exists yet', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    const settings = await loadAppearanceSettings()
    expect(settings).toEqual(DEFAULT_APPEARANCE_SETTINGS)
  })

  it('reads and parses an existing settings file', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ fontFamily: 'Georgia, serif', themeMode: 'dark' }))
    const settings = await loadAppearanceSettings()
    expect(readTextFile).toHaveBeenCalledWith('/fake/config/appearance-settings.json')
    expect(settings.fontFamily).toBe('Georgia, serif')
    expect(settings.themeMode).toBe('dark')
    expect(settings.levels).toEqual(DEFAULT_APPEARANCE_SETTINGS.levels)
  })

  it('fills in defaults for a level missing from an older settings file', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ levels: { 1: { label: 'Chapitre' } } }))
    const settings = await loadAppearanceSettings()
    expect(settings.levels[1].label).toBe('Chapitre')
    expect(settings.levels[1].color).toEqual(DEFAULT_APPEARANCE_SETTINGS.levels[1].color)
    expect(settings.levels[2]).toEqual(DEFAULT_APPEARANCE_SETTINGS.levels[2])
  })
})

describe('saveAppearanceSettings', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(writeTextFile).mockReset()
    vi.mocked(mkdir).mockReset()
  })

  it('creates the app config directory if missing, then writes the settings file', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    await saveAppearanceSettings(DEFAULT_APPEARANCE_SETTINGS)
    expect(mkdir).toHaveBeenCalledWith('/fake/config', { recursive: true })
    expect(writeTextFile).toHaveBeenCalledWith(
      '/fake/config/appearance-settings.json',
      JSON.stringify(DEFAULT_APPEARANCE_SETTINGS, null, 2)
    )
  })

  it('does not recreate the config directory when it already exists', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    await saveAppearanceSettings(DEFAULT_APPEARANCE_SETTINGS)
    expect(mkdir).not.toHaveBeenCalled()
  })
})
