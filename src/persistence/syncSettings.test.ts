import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
}))
vi.mock('@tauri-apps/api/path', () => ({
  appConfigDir: vi.fn().mockResolvedValue('/config'),
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
}))

import { exists, readTextFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs'
import { loadSyncSettings, saveSyncSettings } from './syncSettings'
import { DEFAULT_SYNC_SETTINGS } from '../types/syncSettings'

describe('loadSyncSettings', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(readTextFile).mockReset()
  })

  it('returns the defaults when no file exists yet', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    expect(await loadSyncSettings()).toEqual(DEFAULT_SYNC_SETTINGS)
  })

  it('merges a partial file onto the defaults', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ serverUrl: 'https://pi.local' }))
    // Everything the file does not mention keeps its shipped default — which is
    // what lets a new setting be added without a migration.
    expect(await loadSyncSettings()).toEqual({
      ...DEFAULT_SYNC_SETTINGS,
      serverUrl: 'https://pi.local',
    })
  })

  it('reads back the automatic-sync settings a newer version wrote', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(
      JSON.stringify({
        serverUrl: 'https://pi.local',
        autoSyncOnLaunch: true,
        autoSyncIntervalMinutes: 15,
        verboseLog: true,
      })
    )

    expect(await loadSyncSettings()).toEqual({
      serverUrl: 'https://pi.local',
      syncFolderPath: null,
      autoSyncOnLaunch: true,
      autoSyncIntervalMinutes: 15,
      verboseLog: true,
    })
  })
})

describe('saveSyncSettings', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(writeTextFile).mockReset()
    vi.mocked(mkdir).mockReset()
  })

  it('writes the formatted JSON, creating the config dir if needed', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    const settings = { ...DEFAULT_SYNC_SETTINGS, serverUrl: 'https://pi.local', syncFolderPath: '/cours' }
    await saveSyncSettings(settings)
    expect(mkdir).toHaveBeenCalledWith('/config', { recursive: true })
    expect(writeTextFile).toHaveBeenCalledWith('/config/sync-settings.json', JSON.stringify(settings, null, 2))
  })
})
