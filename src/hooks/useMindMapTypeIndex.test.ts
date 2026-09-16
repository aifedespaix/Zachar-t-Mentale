import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../persistence/fileTree', () => ({ collectMindMapPaths: vi.fn() }))
vi.mock('../persistence/mindMapMetaCache', () => ({
  loadMindMapMetaCached: vi.fn(),
  invalidateMindMapMetaCache: vi.fn(),
}))

import { collectMindMapPaths } from '../persistence/fileTree'
import { loadMindMapMetaCached, invalidateMindMapMetaCache } from '../persistence/mindMapMetaCache'
import { useMindMapTypeIndex } from './useMindMapTypeIndex'
import type { FileTreeNode } from '../types/workspace'
import type { MindMapMeta } from '../types/card'

const NODES: FileTreeNode[] = [
  { type: 'mindmap', name: 'a.zmap', path: '/c/a.zmap' },
  { type: 'mindmap', name: 'b.zmap', path: '/c/b.zmap' },
]

const COURS: MindMapMeta = {
  id: 'a',
  author: 'x',
  role: 'eleve',
  lastModified: '2026-01-01T00:00:00.000Z',
  type: 'cours',
}

describe('useMindMapTypeIndex', () => {
  beforeEach(() => {
    vi.mocked(loadMindMapMetaCached).mockReset()
    vi.mocked(invalidateMindMapMetaCache).mockReset()
    vi.mocked(collectMindMapPaths).mockReset().mockReturnValue(new Set(['/c/a.zmap', '/c/b.zmap']))
  })

  it('reads no header while inactive, and reports itself not ready', () => {
    const { result } = renderHook(() => useMindMapTypeIndex(NODES, false, 0))

    expect(loadMindMapMetaCached).not.toHaveBeenCalled()
    expect(result.current.ready).toBe(false)
  })

  it('indexes every path once active, defaulting an untyped map to « default »', async () => {
    vi.mocked(loadMindMapMetaCached).mockImplementation(async path => (path === '/c/a.zmap' ? COURS : null))

    const { result } = renderHook(() => useMindMapTypeIndex(NODES, true, 0))

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.types.get('/c/a.zmap')).toBe('cours')
    expect(result.current.types.get('/c/b.zmap')).toBe('default')
  })

  it('drops the cached headers and re-reads when the meta revision changes', async () => {
    vi.mocked(loadMindMapMetaCached).mockResolvedValue(null)

    const { rerender } = renderHook(({ revision }) => useMindMapTypeIndex(NODES, true, revision), {
      initialProps: { revision: 0 },
    })
    await waitFor(() => expect(loadMindMapMetaCached).toHaveBeenCalledTimes(2))

    rerender({ revision: 1 })

    await waitFor(() => expect(invalidateMindMapMetaCache).toHaveBeenCalled())
    await waitFor(() => expect(loadMindMapMetaCached).toHaveBeenCalledTimes(4))
  })
})
