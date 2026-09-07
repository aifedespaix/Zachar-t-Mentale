import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAutosave } from './useAutosave'
import type { Card } from '../types/card'

vi.mock('./fileStore', () => ({ saveMindMap: vi.fn().mockResolvedValue(undefined) }))
import { saveMindMap } from './fileStore'

const cardsV1: Card[] = [{ id: 'root', level: 1, title: 'v1', parentId: null, order: 0 }]
const cardsV2: Card[] = [{ id: 'root', level: 1, title: 'v2', parentId: null, order: 0 }]

describe('useAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(saveMindMap).mockReset()
    vi.mocked(saveMindMap).mockResolvedValue(undefined)
  })
  afterEach(() => vi.useRealTimers())

  it('debounces saves and only writes the latest value', () => {
    const { rerender } = renderHook(({ cards }) => useAutosave('/fake/path.json', cards, 500), {
      initialProps: { cards: cardsV1 },
    })
    rerender({ cards: cardsV2 })

    vi.advanceTimersByTime(499)
    expect(saveMindMap).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(saveMindMap).toHaveBeenCalledTimes(1)
    expect(saveMindMap).toHaveBeenCalledWith('/fake/path.json', cardsV2)
  })

  // The file sidebar swaps `path` while `enabled` stays true. If the debounce
  // kept the path captured at schedule time, the next save would write the
  // newly-opened file's cards into the previously-opened file's path.
  it('saves to the NEW path when the path changes while enabled stays true', () => {
    const { rerender } = renderHook(({ path, cards }) => useAutosave(path, cards, 500, true), {
      initialProps: { path: '/fake/a.json', cards: cardsV1 },
    })
    rerender({ path: '/fake/b.json', cards: cardsV2 })

    vi.advanceTimersByTime(500)

    expect(saveMindMap).toHaveBeenCalledTimes(1)
    expect(saveMindMap).toHaveBeenCalledWith('/fake/b.json', cardsV2)
    expect(saveMindMap).not.toHaveBeenCalledWith('/fake/a.json', expect.anything())
  })

  it('does not save if unmounted before the debounce delay elapses', () => {
    const { unmount } = renderHook(() => useAutosave('/fake/path.json', cardsV1, 500))
    unmount()

    vi.advanceTimersByTime(500)
    expect(saveMindMap).not.toHaveBeenCalled()
  })

  it('saves by default (enabled defaults to true)', () => {
    renderHook(() => useAutosave('/fake/path.json', cardsV1, 500))
    vi.advanceTimersByTime(500)
    expect(saveMindMap).toHaveBeenCalledTimes(1)
  })

  it('never saves while disabled, no matter how much time passes', () => {
    renderHook(() => useAutosave('/fake/path.json', cardsV1, 500, false))
    vi.advanceTimersByTime(10_000)
    expect(saveMindMap).not.toHaveBeenCalled()
  })

  it('starts saving once it becomes enabled', () => {
    const { rerender } = renderHook(({ enabled }) => useAutosave('/fake/path.json', cardsV1, 500, enabled), {
      initialProps: { enabled: false },
    })
    vi.advanceTimersByTime(500)
    expect(saveMindMap).not.toHaveBeenCalled()

    rerender({ enabled: true })
    vi.advanceTimersByTime(500)
    expect(saveMindMap).toHaveBeenCalledTimes(1)
  })

  it('reports a rejected save through onError instead of failing silently', async () => {
    const onError = vi.fn()
    const failure = new Error('disk full')
    vi.mocked(saveMindMap).mockRejectedValue(failure)

    renderHook(() => useAutosave('/fake/path.json', cardsV1, 500, true, onError))
    vi.advanceTimersByTime(500)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure))
  })

  it('does not call onError when the save succeeds', async () => {
    const onError = vi.fn()
    renderHook(() => useAutosave('/fake/path.json', cardsV1, 500, true, onError))
    vi.advanceTimersByTime(500)
    await vi.waitFor(() => expect(saveMindMap).toHaveBeenCalledTimes(1))
    expect(onError).not.toHaveBeenCalled()
  })

  describe('flush', () => {
    it('writes a pending debounced save immediately instead of waiting out the delay', async () => {
      const { result } = renderHook(() => useAutosave('/fake/path.json', cardsV1, 500))

      await result.current.flush()

      expect(saveMindMap).toHaveBeenCalledTimes(1)
      expect(saveMindMap).toHaveBeenCalledWith('/fake/path.json', cardsV1)
    })

    it('is a no-op when there is nothing pending (already saved, nothing changed since)', async () => {
      const { result } = renderHook(() => useAutosave('/fake/path.json', cardsV1, 500))
      vi.advanceTimersByTime(500)
      await vi.waitFor(() => expect(saveMindMap).toHaveBeenCalledTimes(1))

      await result.current.flush()

      expect(saveMindMap).toHaveBeenCalledTimes(1)
    })

    it('cancels the debounce timer so the value is never written twice', async () => {
      const { result } = renderHook(() => useAutosave('/fake/path.json', cardsV1, 500))

      await result.current.flush()
      vi.advanceTimersByTime(500)

      expect(saveMindMap).toHaveBeenCalledTimes(1)
    })

    it('rejects and reports through onError when the flushed save fails', async () => {
      const onError = vi.fn()
      const failure = new Error('disk full')
      vi.mocked(saveMindMap).mockRejectedValue(failure)
      const { result } = renderHook(() => useAutosave('/fake/path.json', cardsV1, 500, true, onError))

      await expect(result.current.flush()).rejects.toThrow('disk full')
      expect(onError).toHaveBeenCalledWith(failure)
    })

    it('does nothing while autosave is disabled', async () => {
      const { result } = renderHook(() => useAutosave('/fake/path.json', cardsV1, 500, false))

      await result.current.flush()

      expect(saveMindMap).not.toHaveBeenCalled()
    })
  })
})
