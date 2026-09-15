import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('../persistence/fileOps', () => ({ deletePath: vi.fn() }))
vi.mock('../persistence/fileStore', () => ({ loadMindMapMeta: vi.fn() }))
vi.mock('../persistence/fileTree', () => ({ scanFolder: vi.fn() }))
vi.mock('../persistence/syncState', () => ({
  loadServerSyncState: vi.fn(),
  saveSyncState: vi.fn(),
  serverStateOf: vi.fn(),
}))
vi.mock('../sync/syncService', () => ({ flattenMindMapPaths: vi.fn() }))

import { deletePath } from '../persistence/fileOps'
import { loadMindMapMeta } from '../persistence/fileStore'
import { scanFolder } from '../persistence/fileTree'
import { loadServerSyncState, saveSyncState, serverStateOf } from '../persistence/syncState'
import { flattenMindMapPaths } from '../sync/syncService'
import { useDeleteMindMap } from './useDeleteMindMap'
import { useSyncStore } from '../state/useSyncStore'
import type { MindMapMeta } from '../types/card'

const AIFE: MindMapMeta = { id: 'f1', author: 'aife', role: 'prof', lastModified: 'm1' }
const ELEVE1: MindMapMeta = { id: 'f2', author: 'eleve1', role: 'eleve', lastModified: 'm2' }

function armed(server: { tombstones: string[] } = { tombstones: [] }) {
  vi.mocked(loadServerSyncState).mockResolvedValue({ version: 2, servers: {} } as any)
  vi.mocked(serverStateOf).mockReturnValue({ syncFolderPath: '/cours', entries: {}, ...server } as any)
  vi.mocked(saveSyncState).mockResolvedValue(undefined)
}

describe('useDeleteMindMap', () => {
  beforeEach(() => {
    vi.mocked(deletePath).mockReset().mockResolvedValue(undefined)
    vi.mocked(loadMindMapMeta).mockReset()
    vi.mocked(scanFolder).mockReset()
    vi.mocked(flattenMindMapPaths).mockReset()
    vi.mocked(loadServerSyncState).mockReset()
    vi.mocked(serverStateOf).mockReset()
    vi.mocked(saveSyncState).mockReset()
    useSyncStore.setState({ currentUser: { username: 'aife', role: 'prof' }, syncFolderPath: '/cours', serverUrl: 'https://pb.test' })
  })

  it('poses a tombstone for a single file it has the right to remove, before touching the disk', async () => {
    armed()
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)
    const server = { syncFolderPath: '/cours', entries: {}, tombstones: [] as string[] }
    vi.mocked(serverStateOf).mockReturnValue(server as any)

    const { result } = renderHook(() => useDeleteMindMap())
    const outcome = await result.current.deleteEntry('/cours/a.zmap', false)

    expect(outcome.error).toBeUndefined()
    expect(server.tombstones).toEqual(['f1'])
    expect(saveSyncState).toHaveBeenCalled()
    expect(deletePath).toHaveBeenCalledWith('/cours/a.zmap', false)
    // La tombstone est posée AVANT que le disque ne bouge.
    const saveOrder = vi.mocked(saveSyncState).mock.invocationCallOrder[0]!
    const deleteOrder = vi.mocked(deletePath).mock.invocationCallOrder[0]!
    expect(saveOrder).toBeLessThan(deleteOrder)
  })

  it('never poses a tombstone for a draft (no meta) or a file outside the sync folder', async () => {
    armed()
    vi.mocked(loadMindMapMeta).mockResolvedValue(null)
    const server = { syncFolderPath: '/cours', entries: {}, tombstones: [] as string[] }
    vi.mocked(serverStateOf).mockReturnValue(server as any)

    const { result } = renderHook(() => useDeleteMindMap())
    await result.current.deleteEntry('/cours/brouillon.zmap', false)

    expect(server.tombstones).toEqual([])
    expect(saveSyncState).not.toHaveBeenCalled()
    expect(deletePath).toHaveBeenCalledWith('/cours/brouillon.zmap', false)
  })

  it('poses a tombstone for every card under a folder it has the right to remove, skipping someone else s', async () => {
    armed()
    vi.mocked(scanFolder).mockResolvedValue([] as any)
    vi.mocked(flattenMindMapPaths).mockReturnValue(['/cours/Chapitre/a.zmap', '/cours/Chapitre/b.zmap'])
    vi.mocked(loadMindMapMeta).mockImplementation(async path =>
      path.endsWith('a.zmap') ? AIFE : { ...ELEVE1, author: 'quelquun-d-autre' }
    )
    const server = { syncFolderPath: '/cours', entries: {}, tombstones: [] as string[] }
    vi.mocked(serverStateOf).mockReturnValue(server as any)
    useSyncStore.setState({ currentUser: { username: 'aife', role: 'eleve' as any } })

    const { result } = renderHook(() => useDeleteMindMap())
    await result.current.deleteEntry('/cours/Chapitre', true)

    // « aife » n'est ni l'auteur de b.zmap ni prof : seule a.zmap est tombstonée.
    expect(server.tombstones).toEqual(['f1'])
    expect(deletePath).toHaveBeenCalledWith('/cours/Chapitre', true)
  })

  it('leaves the disk untouched, and reports the failure, when the sync state cannot be saved', async () => {
    armed()
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)
    vi.mocked(serverStateOf).mockReturnValue({ syncFolderPath: '/cours', entries: {}, tombstones: [] } as any)
    vi.mocked(saveSyncState).mockRejectedValue(new Error('disque plein'))

    const { result } = renderHook(() => useDeleteMindMap())
    const outcome = await result.current.deleteEntry('/cours/a.zmap', false)

    expect(outcome.error).toBeInstanceOf(Error)
    expect(deletePath).not.toHaveBeenCalled()
  })

  it('does not touch the sync state at all when no account is signed in — a purely local delete', async () => {
    useSyncStore.setState({ currentUser: null, syncFolderPath: null })

    const { result } = renderHook(() => useDeleteMindMap())
    await result.current.deleteEntry('/ailleurs/a.zmap', false)

    expect(loadServerSyncState).not.toHaveBeenCalled()
    expect(deletePath).toHaveBeenCalledWith('/ailleurs/a.zmap', false)
  })
})
