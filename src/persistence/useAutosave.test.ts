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
})
