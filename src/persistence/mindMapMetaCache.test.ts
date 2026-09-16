import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./fileStore', () => ({ loadMindMapMeta: vi.fn() }))

import { loadMindMapMeta } from './fileStore'
import {
  loadMindMapMetaCached,
  invalidateMindMapMetaCache,
  resetMindMapMetaCacheForTests,
} from './mindMapMetaCache'
import type { MindMapMeta } from '../types/card'

const META: MindMapMeta = {
  id: 'file-1',
  author: 'aife',
  role: 'prof',
  lastModified: '2026-01-01T00:00:00.000Z',
  type: 'cours',
}

describe('mindMapMetaCache', () => {
  beforeEach(() => {
    resetMindMapMetaCacheForTests()
    vi.mocked(loadMindMapMeta).mockReset()
  })

  it('reads a header once per path', async () => {
    vi.mocked(loadMindMapMeta).mockResolvedValue(META)

    expect(await loadMindMapMetaCached('/c/a.zmap')).toEqual(META)
    expect(await loadMindMapMetaCached('/c/a.zmap')).toEqual(META)
    expect(loadMindMapMeta).toHaveBeenCalledTimes(1)
  })

  it('shares one in-flight request between concurrent callers', async () => {
    vi.mocked(loadMindMapMeta).mockResolvedValue(META)

    const [first, second] = await Promise.all([
      loadMindMapMetaCached('/c/a.zmap'),
      loadMindMapMetaCached('/c/a.zmap'),
    ])
    expect(first).toEqual(META)
    expect(second).toEqual(META)
    expect(loadMindMapMeta).toHaveBeenCalledTimes(1)
  })

  it('caches a missing or unreadable header as null instead of retrying', async () => {
    vi.mocked(loadMindMapMeta).mockRejectedValue(new Error('boom'))

    expect(await loadMindMapMetaCached('/c/a.zmap')).toBeNull()
    expect(await loadMindMapMetaCached('/c/a.zmap')).toBeNull()
    expect(loadMindMapMeta).toHaveBeenCalledTimes(1)
  })

  it('re-reads after a publish or a pull invalidated the cache', async () => {
    vi.mocked(loadMindMapMeta).mockResolvedValue(META)

    await loadMindMapMetaCached('/c/a.zmap')
    invalidateMindMapMetaCache()
    await loadMindMapMetaCached('/c/a.zmap')
    expect(loadMindMapMeta).toHaveBeenCalledTimes(2)
  })
})
