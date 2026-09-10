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
import { loadSyncStatus, saveSyncStatus, DEFAULT_SYNC_STATUS } from './syncStatus'

beforeEach(() => {
  vi.mocked(exists).mockReset().mockResolvedValue(false)
  vi.mocked(readTextFile).mockReset().mockResolvedValue('')
  vi.mocked(writeTextFile).mockReset().mockResolvedValue(undefined)
  vi.mocked(mkdir).mockReset().mockResolvedValue(undefined)
})

describe('loadSyncStatus', () => {
  it('answers "never" when nothing was ever written', async () => {
    expect(await loadSyncStatus()).toEqual(DEFAULT_SYNC_STATUS)
  })

  it('reads back the timestamp of the last successful sync', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ lastSuccessAt: '2026-09-10T19:00:00.000Z' }))

    expect(await loadSyncStatus()).toEqual({ lastSuccessAt: '2026-09-10T19:00:00.000Z' })
  })

  it('discards a corrupt file and a wrongly typed field — it only feeds a sentence', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue('{ pas du json')
    expect(await loadSyncStatus()).toEqual(DEFAULT_SYNC_STATUS)

    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ lastSuccessAt: 42 }))
    expect(await loadSyncStatus()).toEqual(DEFAULT_SYNC_STATUS)
  })
})

describe('saveSyncStatus', () => {
  it('creates the config folder when missing, then writes it formatted', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    const status = { lastSuccessAt: '2026-09-10T19:00:00.000Z' }

    await saveSyncStatus(status)

    expect(mkdir).toHaveBeenCalledWith('/config', { recursive: true })
    expect(writeTextFile).toHaveBeenCalledWith('/config/sync-status.json', JSON.stringify(status, null, 2))
  })
})
