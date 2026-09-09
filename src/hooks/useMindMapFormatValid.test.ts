import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useMindMapFormatValid, resetMindMapFormatCacheForTests } from './useMindMapFormatValid'

vi.mock('@tauri-apps/plugin-fs', () => ({ stat: vi.fn() }))
vi.mock('../persistence/fileStore', () => ({ loadMindMap: vi.fn() }))
vi.mock('../validation/cardsValidation', () => ({ validateCards: vi.fn() }))
vi.mock('../persistence/mindMapFormatCache', () => ({
  loadMindMapFormatCache: vi.fn(),
  saveMindMapFormatCache: vi.fn(),
  isCacheEntryFresh: vi.fn(),
}))

import { stat } from '@tauri-apps/plugin-fs'
import { loadMindMap } from '../persistence/fileStore'
import { validateCards } from '../validation/cardsValidation'
import { loadMindMapFormatCache, saveMindMapFormatCache, isCacheEntryFresh } from '../persistence/mindMapFormatCache'

describe('useMindMapFormatValid', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetMindMapFormatCacheForTests()
    vi.mocked(stat).mockReset()
    vi.mocked(loadMindMap).mockReset()
    vi.mocked(validateCards).mockReset()
    vi.mocked(loadMindMapFormatCache).mockReset().mockResolvedValue({})
    vi.mocked(saveMindMapFormatCache).mockReset().mockResolvedValue(undefined)
    vi.mocked(isCacheEntryFresh).mockReset().mockReturnValue(false)
  })
  afterEach(() => vi.useRealTimers())

  it('starts pending (undefined) before the check resolves', () => {
    vi.mocked(stat).mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useMindMapFormatValid('/cours/chapitre1.zmap'))
    expect(result.current).toBeUndefined()
  })

  it('resolves to true for a well-formed mind map not yet in the cache', async () => {
    vi.mocked(stat).mockResolvedValue({ mtime: new Date(1000), size: 42 } as never)
    vi.mocked(loadMindMap).mockResolvedValue([{ id: 'root', level: 1, title: 'R', parentId: null, order: 0 }])
    vi.mocked(validateCards).mockReturnValue({ valid: true, issues: [] })
    const { result } = renderHook(() => useMindMapFormatValid('/cours/chapitre1.zmap'))
    await vi.waitFor(() => expect(result.current).toBe(true))
  })

  it('resolves to false when the file fails structural validation', async () => {
    vi.mocked(stat).mockResolvedValue({ mtime: new Date(1000), size: 42 } as never)
    vi.mocked(loadMindMap).mockResolvedValue([{ id: 'a', level: 1, title: 'A', parentId: null, order: 0 }])
    vi.mocked(validateCards).mockReturnValue({ valid: false, issues: [] })
    const { result } = renderHook(() => useMindMapFormatValid('/cours/chapitre1.zmap'))
    await vi.waitFor(() => expect(result.current).toBe(false))
  })

  it('resolves to false when the file cannot even be parsed', async () => {
    vi.mocked(stat).mockResolvedValue({ mtime: new Date(1000), size: 42 } as never)
    vi.mocked(loadMindMap).mockRejectedValue(new Error('invalid JSON'))
    const { result } = renderHook(() => useMindMapFormatValid('/cours/chapitre1.zmap'))
    await vi.waitFor(() => expect(result.current).toBe(false))
    expect(validateCards).not.toHaveBeenCalled()
  })

  it('resolves to false without reading the file when stat() fails', async () => {
    vi.mocked(stat).mockRejectedValue(new Error('file vanished'))
    const { result } = renderHook(() => useMindMapFormatValid('/cours/chapitre1.zmap'))
    await vi.waitFor(() => expect(result.current).toBe(false))
    expect(loadMindMap).not.toHaveBeenCalled()
  })

  it('reuses a fresh cache entry without re-reading the file', async () => {
    vi.mocked(loadMindMapFormatCache).mockResolvedValue({
      '/cours/chapitre1.zmap': { mtimeMs: 1000, size: 42, valid: true },
    })
    vi.mocked(stat).mockResolvedValue({ mtime: new Date(1000), size: 42 } as never)
    vi.mocked(isCacheEntryFresh).mockReturnValue(true)
    const { result } = renderHook(() => useMindMapFormatValid('/cours/chapitre1.zmap'))
    await vi.waitFor(() => expect(result.current).toBe(true))
    expect(loadMindMap).not.toHaveBeenCalled()
  })

  it('does not schedule a cache save when stat reports a null mtime', async () => {
    vi.mocked(stat).mockResolvedValue({ mtime: null, size: 42 } as never)
    vi.mocked(loadMindMap).mockResolvedValue([{ id: 'root', level: 1, title: 'R', parentId: null, order: 0 }])
    vi.mocked(validateCards).mockReturnValue({ valid: true, issues: [] })
    const { result } = renderHook(() => useMindMapFormatValid('/cours/chapitre1.zmap'))
    await vi.waitFor(() => expect(result.current).toBe(true))
    expect(isCacheEntryFresh).toHaveBeenCalledWith(undefined, { mtimeMs: null, size: 42 })
    vi.advanceTimersByTime(500)
    expect(saveMindMapFormatCache).not.toHaveBeenCalled()
  })

  it('debounces the cache save across a burst of validations before writing once', async () => {
    vi.mocked(stat).mockResolvedValue({ mtime: new Date(1000), size: 42 } as never)
    vi.mocked(loadMindMap).mockResolvedValue([{ id: 'root', level: 1, title: 'R', parentId: null, order: 0 }])
    vi.mocked(validateCards).mockReturnValue({ valid: true, issues: [] })
    const { result: r1 } = renderHook(() => useMindMapFormatValid('/cours/a.zmap'))
    const { result: r2 } = renderHook(() => useMindMapFormatValid('/cours/b.zmap'))
    await vi.waitFor(() => expect(r1.current).toBe(true))
    await vi.waitFor(() => expect(r2.current).toBe(true))
    expect(saveMindMapFormatCache).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(saveMindMapFormatCache).toHaveBeenCalledTimes(1)
  })
})
