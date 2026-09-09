import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadMindMapFormatCache, saveMindMapFormatCache, isCacheEntryFresh } from './mindMapFormatCache'

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

describe('loadMindMapFormatCache', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(readTextFile).mockReset()
  })

  it('returns an empty cache when no cache file exists yet', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    const cache = await loadMindMapFormatCache()
    expect(cache).toEqual({})
  })

  it('reads and parses an existing cache file', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(
      JSON.stringify({ '/cours/chapitre1.zmap': { mtimeMs: 1000, size: 42, valid: true } })
    )
    const cache = await loadMindMapFormatCache()
    expect(readTextFile).toHaveBeenCalledWith('/fake/config/mindmap-format-cache.json')
    expect(cache).toEqual({ '/cours/chapitre1.zmap': { mtimeMs: 1000, size: 42, valid: true } })
  })

  it('returns an empty cache instead of throwing when the cache file is corrupted', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue('{not valid json')
    const cache = await loadMindMapFormatCache()
    expect(cache).toEqual({})
  })

  it('returns an empty cache instead of throwing when the app config dir cannot be resolved', async () => {
    vi.mocked(exists).mockRejectedValue(new Error('permission denied'))
    const cache = await loadMindMapFormatCache()
    expect(cache).toEqual({})
  })
})

describe('saveMindMapFormatCache', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(writeTextFile).mockReset()
    vi.mocked(mkdir).mockReset()
  })

  it('creates the app config directory if missing, then writes the cache file', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    const cache = { '/cours/chapitre1.zmap': { mtimeMs: 1000, size: 42, valid: true } }
    await saveMindMapFormatCache(cache)
    expect(mkdir).toHaveBeenCalledWith('/fake/config', { recursive: true })
    expect(writeTextFile).toHaveBeenCalledWith(
      '/fake/config/mindmap-format-cache.json',
      JSON.stringify(cache, null, 2)
    )
  })

  it('does not recreate the config directory when it already exists', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    await saveMindMapFormatCache({})
    expect(mkdir).not.toHaveBeenCalled()
  })
})

describe('isCacheEntryFresh', () => {
  it('is fresh when mtime and size both match the cached entry', () => {
    const entry = { mtimeMs: 1000, size: 42, valid: true }
    expect(isCacheEntryFresh(entry, { mtimeMs: 1000, size: 42 })).toBe(true)
  })

  it('is stale when there is no cached entry', () => {
    expect(isCacheEntryFresh(undefined, { mtimeMs: 1000, size: 42 })).toBe(false)
  })

  it('is stale when the mtime differs', () => {
    const entry = { mtimeMs: 1000, size: 42, valid: true }
    expect(isCacheEntryFresh(entry, { mtimeMs: 2000, size: 42 })).toBe(false)
  })

  it('is stale when the size differs', () => {
    const entry = { mtimeMs: 1000, size: 42, valid: true }
    expect(isCacheEntryFresh(entry, { mtimeMs: 1000, size: 99 })).toBe(false)
  })

  it('is never fresh when the current mtime is null', () => {
    const entry = { mtimeMs: 1000, size: 42, valid: true }
    expect(isCacheEntryFresh(entry, { mtimeMs: null, size: 42 })).toBe(false)
  })
})
