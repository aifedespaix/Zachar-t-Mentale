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
import { loadSyncState, saveSyncState, type SyncState } from './syncState'

const sample: SyncState = { 'file-1': { lastSyncedModified: '2026-01-01T00:00:00.000Z', lastSyncedUpdated: '2026-01-01 00:00:00.000Z' } }

describe('loadSyncState', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(readTextFile).mockReset()
  })

  it('returns an empty object when no cache file exists yet', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    expect(await loadSyncState()).toEqual({})
  })

  it('reads and parses the cache file', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(sample))
    expect(await loadSyncState()).toEqual(sample)
  })

  it('discards a corrupted cache rather than throwing — it is cheap to rebuild', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue('{ not json')
    expect(await loadSyncState()).toEqual({})
  })
})

describe('saveSyncState', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(writeTextFile).mockReset()
    vi.mocked(mkdir).mockReset()
  })

  it('creates the config dir if missing, then writes the formatted JSON', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    await saveSyncState(sample)
    expect(mkdir).toHaveBeenCalledWith('/config', { recursive: true })
    expect(writeTextFile).toHaveBeenCalledWith('/config/sync-state.json', JSON.stringify(sample, null, 2))
  })
})
