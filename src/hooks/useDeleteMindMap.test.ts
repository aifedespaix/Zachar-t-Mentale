import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../persistence/fileStore', () => ({ loadMindMapMeta: vi.fn() }))
vi.mock('../persistence/fileOps', () => ({ deletePath: vi.fn() }))
vi.mock('../persistence/syncState', () => ({
  loadServerSyncState: vi.fn(),
  saveSyncState: vi.fn(),
  serverStateOf: vi.fn((state: { servers: Record<string, unknown> }, url: string) => state.servers[url]),
}))

import { loadMindMapMeta } from '../persistence/fileStore'
import { deletePath } from '../persistence/fileOps'
import { loadServerSyncState, saveSyncState, serverStateOf } from '../persistence/syncState'
import type { ServerSyncState, SyncState } from '../persistence/syncState'
import { useSyncStore } from '../state/useSyncStore'
import { useDeleteMindMap, type DeletePlan } from './useDeleteMindMap'
import type { FileTreeNode } from '../types/workspace'
import type { MindMapMeta } from '../types/card'

const AIFE: MindMapMeta = { id: 'file-1', author: 'aife', role: 'prof', lastModified: '2026-01-01T00:00:00.000Z' }
const OTHER: MindMapMeta = { id: 'file-9', author: 'autre', role: 'eleve', lastModified: '2026-01-01T00:00:00.000Z' }

let state: SyncState

function server(overrides: Partial<ServerSyncState> = {}): ServerSyncState {
  return {
    syncFolderPath: '/cours',
    entries: {},
    tombstones: [],
    folderTombstones: [],
    knownFolders: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.mocked(loadMindMapMeta).mockReset().mockResolvedValue(null)
  vi.mocked(deletePath).mockReset().mockResolvedValue(undefined)
  vi.mocked(saveSyncState).mockReset().mockResolvedValue(undefined)
  state = { version: 2, servers: { 'https://pb.test': server() } }
  vi.mocked(loadServerSyncState).mockReset().mockResolvedValue(state)
  vi.mocked(serverStateOf).mockClear()
  useSyncStore.setState({
    syncFolderPath: '/cours',
    serverUrl: 'https://pb.test',
    currentUser: { username: 'aife', role: 'prof' },
  })
})

async function plan(target: FileTreeNode): Promise<DeletePlan> {
  const { result } = renderHook(() => useDeleteMindMap())
  let computed: DeletePlan | null = null
  await act(async () => {
    computed = await result.current.planDelete(target)
  })
  if (computed === null) throw new Error('plan non calculé')
  return computed
}

describe('useDeleteMindMap — plan', () => {
  it('supprime un fichier jamais publié, sans tombstone', async () => {
    const computed = await plan({ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' })

    expect(computed.files).toEqual([{ path: '/cours/a.zmap', kind: 'mindmap' }])
    expect(computed.files[0]?.fileId).toBeUndefined()
    expect(computed.folderTombstones).toEqual([])
  })

  it('conserve la carte d’un autre, en lecture seule', async () => {
    vi.mocked(loadMindMapMeta).mockResolvedValue(OTHER)
    useSyncStore.setState({ currentUser: { username: 'eleve1', role: 'eleve' } })

    const computed = await plan({ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' })

    expect(computed.files).toEqual([])
    expect(computed.keptCards).toEqual([{ path: '/cours/a.zmap', name: 'a.zmap' }])
  })

  it('pose la tombstone d’une carte possédée, mais seulement à l’application', async () => {
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)

    const computed = await plan({ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' })

    expect(computed.files[0]?.fileId).toBe('file-1')
    // Rien n’est posé tant que la confirmation n’a pas appliqué le plan.
    expect(state.servers['https://pb.test'].tombstones).toEqual([])
    expect(saveSyncState).not.toHaveBeenCalled()
  })

  it('prof : tombstones pour tous les dossiers de la branche, du plus profond au plus haut', async () => {
    const target: FileTreeNode = {
      type: 'folder',
      name: 'Chapitre',
      path: '/cours/Chapitre',
      children: [
        { type: 'folder', name: 'Sous', path: '/cours/Chapitre/Sous', children: [] },
        { type: 'mindmap', name: 'a.zmap', path: '/cours/Chapitre/a.zmap' },
      ],
    }

    const computed = await plan(target)

    expect(computed.folderTombstones).toEqual(['Chapitre/Sous', 'Chapitre'])
  })

  it('élève : un dossier du prof reste, sa carte aussi', async () => {
    state = { version: 2, servers: { 'https://pb.test': server({ knownFolders: ['Chapitre'] }) } }
    vi.mocked(loadServerSyncState).mockResolvedValue(state)
    vi.mocked(loadMindMapMeta).mockResolvedValue(OTHER)
    useSyncStore.setState({ currentUser: { username: 'eleve1', role: 'eleve' } })
    const target: FileTreeNode = {
      type: 'folder',
      name: 'Chapitre',
      path: '/cours/Chapitre',
      children: [{ type: 'mindmap', name: 'a.zmap', path: '/cours/Chapitre/a.zmap' }],
    }

    const computed = await plan(target)

    expect(computed.files).toEqual([])
    expect(computed.folderTombstones).toEqual([])
    // Le dossier du prof n'est pas retiré du disque, même vidé.
    expect(computed.folders).toEqual([])
    expect(computed.remainingFolders).toEqual(['Chapitre'])
  })
})

describe('useDeleteMindMap — application', () => {
  async function applyPlan(computed: DeletePlan): Promise<void> {
    const { result } = renderHook(() => useDeleteMindMap())
    await act(async () => {
      await result.current.applyDelete(computed)
    })
  }

  it('supprime les fichiers, remonte les dossiers vidés et enregistre les tombstones', async () => {
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)
    const target: FileTreeNode = {
      type: 'folder',
      name: 'Chapitre',
      path: '/cours/Chapitre',
      children: [{ type: 'mindmap', name: 'a.zmap', path: '/cours/Chapitre/a.zmap' }],
    }
    const computed = await plan(target)

    await applyPlan(computed)

    expect(deletePath).toHaveBeenCalledWith('/cours/Chapitre/a.zmap', false)
    expect(deletePath).toHaveBeenLastCalledWith('/cours/Chapitre', false)
    expect(state.servers['https://pb.test'].tombstones).toEqual(['file-1'])
    expect(state.servers['https://pb.test'].folderTombstones).toEqual(['Chapitre'])
    expect(saveSyncState).toHaveBeenCalled()
  })

  it('pose la tombstone AVANT le disque : un échec local est signalé, la passe 3 annulera', async () => {
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)
    vi.mocked(deletePath).mockRejectedValue(new Error('fichier verrouillé'))
    const computed = await plan({ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' })

    const { result } = renderHook(() => useDeleteMindMap())
    let outcome: { deletedFiles: number; failed: unknown[] } | null = null
    await act(async () => {
      outcome = await result.current.applyDelete(computed)
    })

    expect(outcome!.failed).toHaveLength(1)
    // L'intention est enregistrée ; le fichier encore là la fera annuler par la
    // passe 3, qui constate qu'il porte toujours son `file_id`.
    expect(state.servers['https://pb.test'].tombstones).toEqual(['file-1'])
    expect(saveSyncState).toHaveBeenCalled()
  })

  it('n’efface rien sur le disque quand l’état de sync ne s’écrit pas', async () => {
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)
    vi.mocked(saveSyncState).mockRejectedValue(new Error('disque plein'))
    const computed = await plan({ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' })

    const { result } = renderHook(() => useDeleteMindMap())
    let outcome: { deletedFiles: number; failed: unknown[] } | null = null
    await act(async () => {
      outcome = await result.current.applyDelete(computed)
    })

    expect(outcome!.deletedFiles).toBe(0)
    expect(outcome!.failed).toHaveLength(1)
    expect(deletePath).not.toHaveBeenCalled()
  })
})
