import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAutosave } from './useAutosave'
import type { Card } from '../types/card'

vi.mock('./fileStore', () => ({ saveMindMap: vi.fn().mockResolvedValue(undefined) }))
import { saveMindMap } from './fileStore'

const cardsV1: Card[] = [{ id: 'root', level: 1, title: 'v1', parentId: null, order: 0 }]
const cardsV2: Card[] = [{ id: 'root', level: 1, title: 'v2', parentId: null, order: 0 }]

describe('useAutosave', () => {
  beforeEach(() => vi.useFakeTimers())
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
})
