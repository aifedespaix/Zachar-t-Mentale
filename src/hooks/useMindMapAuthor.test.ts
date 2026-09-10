import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

vi.mock('../persistence/fileStore', () => ({ loadMindMapMeta: vi.fn() }))
import { loadMindMapMeta } from '../persistence/fileStore'
import { useWorkspaceStore } from '../state/useWorkspaceStore'
import { useMindMapAuthor } from './useMindMapAuthor'

describe('useMindMapAuthor', () => {
  beforeEach(() => {
    vi.mocked(loadMindMapMeta).mockReset()
    useWorkspaceStore.setState({ fileMetaRevision: 0 })
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

  it('re-reads after a publish or a pull rewrote the file at the same path', async () => {
    vi.mocked(loadMindMapMeta).mockResolvedValue(null)
    const { result } = renderHook(() => useMindMapAuthor('/cours/a.zmap'))
    await waitFor(() => expect(loadMindMapMeta).toHaveBeenCalledTimes(1))
    expect(result.current).toBeNull()

    const published = { id: 'f9', author: 'aife', role: 'prof' as const, lastModified: 'x' }
    vi.mocked(loadMindMapMeta).mockResolvedValue(published)
    act(() => useWorkspaceStore.getState().bumpFileMetaRevision())

    await waitFor(() => expect(result.current).toEqual(published))
  })
})
