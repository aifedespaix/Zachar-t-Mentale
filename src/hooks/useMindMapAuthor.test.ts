import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('../persistence/fileStore', () => ({ loadMindMapMeta: vi.fn() }))
import { loadMindMapMeta } from '../persistence/fileStore'
import { useMindMapAuthor } from './useMindMapAuthor'

describe('useMindMapAuthor', () => {
  beforeEach(() => {
    vi.mocked(loadMindMapMeta).mockReset()
  })

  it('returns null while pending and for a null path', () => {
    const { result } = renderHook(() => useMindMapAuthor(null))
    expect(result.current).toBeNull()
    expect(loadMindMapMeta).not.toHaveBeenCalled()
  })

  it('resolves to the file’s meta once loaded', async () => {
    const meta = { id: 'f1', author: 'aife', role: 'prof' as const, lastModified: 'x' }
    vi.mocked(loadMindMapMeta).mockResolvedValue(meta)
    const { result } = renderHook(() => useMindMapAuthor('/cours/a.zmap'))
    await waitFor(() => expect(result.current).toEqual(meta))
  })

  it('resolves to null on a read failure rather than throwing', async () => {
    vi.mocked(loadMindMapMeta).mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useMindMapAuthor('/cours/a.zmap'))
    await waitFor(() => expect(loadMindMapMeta).toHaveBeenCalled())
    expect(result.current).toBeNull()
  })
})
