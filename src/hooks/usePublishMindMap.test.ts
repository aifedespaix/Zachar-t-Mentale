import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { act, renderHook } from '@testing-library/react'

vi.mock('../persistence/fileStore', () => ({ stampMindMapSyncMeta: vi.fn() }))

import { stampMindMapSyncMeta } from '../persistence/fileStore'
import { usePublishMindMap } from './usePublishMindMap'
import { useSyncStore } from '../state/useSyncStore'
import { useWorkspaceStore, createWorkspaceStore } from '../state/useWorkspaceStore'
import type { MindMapMeta } from '../types/card'

const LOCAL_PATH = '/cours/chapitre1.zmap'
const OUTSIDE_PATH = '/ailleurs/chapitre1.zmap'
const META: MindMapMeta = { id: 'f1', author: 'aife', role: 'prof', lastModified: 'x' }

let refreshFolder: Mock<(folderPath: string) => Promise<void>>

function resetStores() {
  const pristine = createWorkspaceStore().getState()
  refreshFolder = vi.fn<(folderPath: string) => Promise<void>>().mockResolvedValue(undefined)
  useWorkspaceStore.setState({
    rootFolders: pristine.rootFolders,
    workspaceError: pristine.workspaceError,
    fileMetaRevision: pristine.fileMetaRevision,
    refreshFolder,
  })
  useSyncStore.setState({ syncFolderPath: '/cours', currentUser: { username: 'aife', role: 'prof' } })
}

describe('usePublishMindMap — eligibility', () => {
  beforeEach(() => {
    resetStores()
    vi.mocked(stampMindMapSyncMeta).mockReset().mockResolvedValue(true)
  })

  it('accepts a local map inside the sync folder, with an account to stamp it with', () => {
    const { result } = renderHook(() => usePublishMindMap())
    expect(result.current.canPublish(LOCAL_PATH, null)).toBe(true)
  })

  it('refuses every case where the action would mean nothing', () => {
    // A fresh hook per case: `canPublish` is memoised on the account and the
    // folder, so reading it off one render would only ever report the first
    // state the store was in.
    const canPublishNow = () => renderHook(() => usePublishMindMap()).result.current.canPublish

    expect(canPublishNow()(LOCAL_PATH, META)).toBe(false) // already synced
    expect(canPublishNow()(OUTSIDE_PATH, null)).toBe(false) // the push loop never walks there
    expect(canPublishNow()(null, null)).toBe(false)

    // Through act: the hooks already mounted above subscribe to these stores.
    act(() => useSyncStore.setState({ currentUser: null }))
    expect(canPublishNow()(LOCAL_PATH, null)).toBe(false)

    act(() => useSyncStore.setState({ currentUser: { username: 'aife', role: 'prof' }, syncFolderPath: null }))
    expect(canPublishNow()(LOCAL_PATH, null)).toBe(false)
  })
})

describe('usePublishMindMap — publishing', () => {
  beforeEach(() => {
    resetStores()
    vi.mocked(stampMindMapSyncMeta).mockReset().mockResolvedValue(true)
  })

  it('stamps the file for the signed-in account, then refreshes what read its header', async () => {
    const { result } = renderHook(() => usePublishMindMap())
    const revision = useWorkspaceStore.getState().fileMetaRevision

    expect(await result.current.publish(LOCAL_PATH)).toBe('published')

    expect(stampMindMapSyncMeta).toHaveBeenCalledWith(LOCAL_PATH, 'aife', 'prof')
    expect(useWorkspaceStore.getState().fileMetaRevision).toBe(revision + 1)
    expect(refreshFolder).toHaveBeenCalledWith('/cours')
  })

  it('says so when the file already had an identity, instead of stamping over it', async () => {
    const { result } = renderHook(() => usePublishMindMap())
    vi.mocked(stampMindMapSyncMeta).mockResolvedValue(false)

    expect(await result.current.publish(LOCAL_PATH)).toBe('already-published')
    expect(useWorkspaceStore.getState().workspaceError).toMatch(/déjà publiée/)
  })

  it('reports a failed stamp — a click that did nothing must say why', async () => {
    const { result } = renderHook(() => usePublishMindMap())
    vi.mocked(stampMindMapSyncMeta).mockRejectedValue(new Error('disque plein'))

    expect(await result.current.publish(LOCAL_PATH)).toBe('failed')
    expect(useWorkspaceStore.getState().workspaceError).toMatch(/disque plein/)
  })

  it('never touches a file outside the sync folder, whatever the caller asks', async () => {
    const { result } = renderHook(() => usePublishMindMap())

    expect(await result.current.publish(OUTSIDE_PATH)).toBe('not-eligible')
    expect(stampMindMapSyncMeta).not.toHaveBeenCalled()
  })
})
