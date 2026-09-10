import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn().mockResolvedValue(false),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
}))
vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
}))
vi.mock('../persistence/fileStore', () => ({ loadMindMap: vi.fn(), loadMindMapMeta: vi.fn() }))
vi.mock('../persistence/fileTree', () => ({ scanFolder: vi.fn() }))
vi.mock('../persistence/assets', () => ({
  readAssetBytes: vi.fn(),
  writeAsset: vi.fn(),
  sidecarDirOf: (path: string) => path.replace(/\.zmap$/, '.assets'),
}))

import { exists, writeTextFile, readDir } from '@tauri-apps/plugin-fs'
import { loadMindMap, loadMindMapMeta } from '../persistence/fileStore'
import { scanFolder } from '../persistence/fileTree'
import { readAssetBytes, writeAsset } from '../persistence/assets'
import { sync, type SyncClient, type RemoteMindMapRecord, type RemoteAssetRecord } from './syncService'
import type { SyncState } from '../persistence/syncState'
import type { MindMapMeta } from '../types/card'

function fakeClient(overrides: Partial<SyncClient> = {}): SyncClient {
  return {
    mindMaps: {
      getFullList: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(async data => ({ id: 'new-id', updated: '2026-01-02 00:00:00.000Z', ...data })),
      update: vi.fn().mockImplementation(async (id, data) => ({ id, file_id: 'unused', author: 'unused', updated: '2026-01-02 00:00:00.000Z', ...data })),
      ...overrides.mindMaps,
    },
    assets: {
      getFullList: vi.fn().mockResolvedValue([]),
      upload: vi.fn().mockResolvedValue(undefined),
      download: vi.fn(),
      ...overrides.assets,
    },
  }
}

const AIFE: MindMapMeta = { id: 'file-1', author: 'aife', role: 'prof', lastModified: '2026-01-01T00:00:00.000Z' }

beforeEach(() => {
  vi.mocked(exists).mockReset().mockResolvedValue(false)
  vi.mocked(writeTextFile).mockReset()
  vi.mocked(readDir).mockReset().mockResolvedValue([])
  vi.mocked(loadMindMap).mockReset()
  vi.mocked(loadMindMapMeta).mockReset()
  vi.mocked(scanFolder).mockReset()
  vi.mocked(readAssetBytes).mockReset()
  vi.mocked(writeAsset).mockReset()
})

describe('sync — push', () => {
  it('creates a remote record for a locally-authored file never synced before', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)
    vi.mocked(loadMindMap).mockResolvedValue([])
    const client = fakeClient()
    const state: SyncState = {}

    const result = await sync({ client, currentUser: 'aife', syncFolderPath: '/cours', state })

    expect(client.mindMaps.create).toHaveBeenCalledWith(
      expect.objectContaining({ file_id: 'file-1', author: 'aife', path: 'a.zmap' })
    )
    expect(result.pushed).toBe(1)
    expect(state['file-1']).toEqual({ lastSyncedModified: AIFE.lastModified, lastSyncedUpdated: '2026-01-02 00:00:00.000Z' })
  })

  it('updates the existing remote record when one already exists for that file_id', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)
    vi.mocked(loadMindMap).mockResolvedValue([])
    const existing: RemoteMindMapRecord = { id: 'rec-1', file_id: 'file-1', author: 'aife', path: 'a.zmap', content: '[]', updated: '2025-01-01 00:00:00.000Z' }
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([existing]) } as any })

    await sync({ client, currentUser: 'aife', syncFolderPath: '/cours', state: {} })

    expect(client.mindMaps.update).toHaveBeenCalledWith('rec-1', expect.objectContaining({ path: 'a.zmap' }))
    expect(client.mindMaps.create).not.toHaveBeenCalled()
  })

  it('skips a file already up to date in the cache', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)
    const client = fakeClient()
    const state: SyncState = { 'file-1': { lastSyncedModified: AIFE.lastModified, lastSyncedUpdated: 'x' } }

    const result = await sync({ client, currentUser: 'aife', syncFolderPath: '/cours', state })

    expect(client.mindMaps.create).not.toHaveBeenCalled()
    expect(client.mindMaps.update).not.toHaveBeenCalled()
    expect(result.pushed).toBe(0)
  })

  it('never pushes a file authored by someone else, or one never synced (meta: null)', async () => {
    vi.mocked(scanFolder).mockResolvedValue([
      { type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' },
      { type: 'mindmap', name: 'b.zmap', path: '/cours/b.zmap' },
    ])
    vi.mocked(loadMindMapMeta).mockImplementation(async path =>
      path === '/cours/a.zmap' ? { ...AIFE, author: 'someone-else' } : null
    )
    const client = fakeClient()

    const result = await sync({ client, currentUser: 'aife', syncFolderPath: '/cours', state: {} })

    expect(client.mindMaps.create).not.toHaveBeenCalled()
    expect(result.pushed).toBe(0)
  })

  it('collects a per-file error without aborting the rest of the batch', async () => {
    vi.mocked(scanFolder).mockResolvedValue([
      { type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' },
      { type: 'mindmap', name: 'b.zmap', path: '/cours/b.zmap' },
    ])
    vi.mocked(loadMindMapMeta).mockImplementation(async path =>
      path === '/cours/a.zmap' ? AIFE : { ...AIFE, id: 'file-2' }
    )
    vi.mocked(loadMindMap).mockResolvedValue([])
    const client = fakeClient({
      mindMaps: {
        getFullList: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockRejectedValueOnce(new Error('réseau coupé')).mockResolvedValue({ id: 'x', updated: 'u' }),
        update: vi.fn(),
      } as any,
    })

    const result = await sync({ client, currentUser: 'aife', syncFolderPath: '/cours', state: {} })

    expect(result.errors).toEqual([{ fileId: 'file-1', message: 'réseau coupé' }])
    expect(result.pushed).toBe(1)
  })

  it('uploads a local sidecar asset not yet known remotely, before saving the record', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)
    vi.mocked(loadMindMap).mockResolvedValue([])
    vi.mocked(exists).mockImplementation(async path => path === '/cours/a.assets')
    vi.mocked(readDir).mockImplementation(async path =>
      path === '/cours/a.assets'
        ? ([{ name: 'hash1.png', isDirectory: false, isFile: true, isSymlink: false }] as any)
        : []
    )
    vi.mocked(readAssetBytes).mockResolvedValue(new Uint8Array([9, 9, 9]))
    const callOrder: string[] = []
    const upload = vi.fn().mockImplementation(async () => {
      callOrder.push('upload')
    })
    const create = vi.fn().mockImplementation(async data => {
      callOrder.push('create')
      return { id: 'new-id', updated: '2026-01-02 00:00:00.000Z', ...data }
    })
    const client = fakeClient({ mindMaps: { create } as any, assets: { getFullList: vi.fn().mockResolvedValue([]), upload, download: vi.fn() } as any })

    await sync({ client, currentUser: 'aife', syncFolderPath: '/cours', state: {} })

    expect(upload).toHaveBeenCalledWith('hash1', 'png', new Uint8Array([9, 9, 9]))
    // The asset must be uploaded before the record referencing it is saved,
    // so a concurrent reader's getFullList() never sees a record naming an
    // asset that isn't there yet.
    expect(callOrder).toEqual(['upload', 'create'])
  })

  it('does not re-upload a sidecar asset whose hash the server already knows', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)
    vi.mocked(loadMindMap).mockResolvedValue([])
    vi.mocked(exists).mockImplementation(async path => path === '/cours/a.assets')
    vi.mocked(readDir).mockImplementation(async path =>
      path === '/cours/a.assets'
        ? ([{ name: 'hash1.png', isDirectory: false, isFile: true, isSymlink: false }] as any)
        : []
    )
    const upload = vi.fn()
    const client = fakeClient({
      assets: { getFullList: vi.fn().mockResolvedValue([{ id: 'a1', hash: 'hash1', extension: 'png' }]), upload, download: vi.fn() } as any,
    })

    await sync({ client, currentUser: 'aife', syncFolderPath: '/cours', state: {} })

    expect(upload).not.toHaveBeenCalled()
  })

  it('never pushes a second local file that claims an id already pushed in this run', async () => {
    vi.mocked(scanFolder).mockResolvedValue([
      { type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' },
      { type: 'mindmap', name: 'b.zmap', path: '/cours/b.zmap' },
    ])
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE) // same id ('file-1') for both files
    vi.mocked(loadMindMap).mockResolvedValue([])
    const client = fakeClient()

    const result = await sync({ client, currentUser: 'aife', syncFolderPath: '/cours', state: {} })

    expect(client.mindMaps.create).toHaveBeenCalledTimes(1)
    expect(result.pushed).toBe(1)
    expect(result.errors).toEqual([
      { fileId: 'file-1', message: 'plusieurs fichiers locaux partagent le même identifiant de synchronisation' },
    ])
  })
})

describe('sync — pull', () => {
  const record: RemoteMindMapRecord = {
    id: 'rec-2',
    file_id: 'file-2',
    author: 'prof',
    path: 'b.zmap',
    content: JSON.stringify({ meta: { id: 'file-2', author: 'prof', role: 'prof', lastModified: '2026-01-01T00:00:00.000Z' }, cards: [] }),
    updated: '2026-01-02 00:00:00.000Z',
  }

  it('writes a new local file for a record authored by someone else', async () => {
    vi.mocked(scanFolder).mockResolvedValue([])
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([record]) } as any })

    const result = await sync({ client, currentUser: 'eleve1', syncFolderPath: '/cours', state: {} })

    expect(writeTextFile).toHaveBeenCalledWith('/cours/b.zmap', record.content)
    expect(result.pulled).toBe(1)
  })

  it('never pulls a record authored by the current user', async () => {
    vi.mocked(scanFolder).mockResolvedValue([])
    const own = { ...record, author: 'eleve1' }
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([own]) } as any })

    const result = await sync({ client, currentUser: 'eleve1', syncFolderPath: '/cours', state: {} })

    expect(writeTextFile).not.toHaveBeenCalled()
    expect(result.pulled).toBe(0)
  })

  it('skips a record already up to date in the cache', async () => {
    vi.mocked(scanFolder).mockResolvedValue([])
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([record]) } as any })
    const state: SyncState = { 'file-2': { lastSyncedModified: 'x', lastSyncedUpdated: record.updated } }

    const result = await sync({ client, currentUser: 'eleve1', syncFolderPath: '/cours', state })

    expect(writeTextFile).not.toHaveBeenCalled()
    expect(result.pulled).toBe(0)
  })

  it('downloads only the assets referenced in the pulled content', async () => {
    const withAsset = {
      ...record,
      content: JSON.stringify({
        meta: { id: 'file-2', author: 'prof', role: 'prof', lastModified: '2026-01-01T00:00:00.000Z' },
        cards: [{ id: 'c1', level: 1, title: 'x', parentId: null, order: 0, content: [{ type: 'image', asset: 'hash1.png' }] }],
      }),
    }
    const asset: RemoteAssetRecord = { id: 'a1', hash: 'hash1', extension: 'png' }
    const download = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]))
    const client = fakeClient({
      mindMaps: { getFullList: vi.fn().mockResolvedValue([withAsset]) } as any,
      assets: { getFullList: vi.fn().mockResolvedValue([asset]), upload: vi.fn(), download } as any,
    })
    vi.mocked(scanFolder).mockResolvedValue([])

    await sync({ client, currentUser: 'eleve1', syncFolderPath: '/cours', state: {} })

    expect(download).toHaveBeenCalledWith(asset)
    expect(writeAsset).toHaveBeenCalledWith('/cours/b.zmap', new Uint8Array([1, 2, 3]), 'png')
  })

  it('refuses to overwrite a local file already at the target path that is not this record', async () => {
    vi.mocked(scanFolder).mockResolvedValue([])
    vi.mocked(exists).mockImplementation(async path => path === '/cours/b.zmap')
    // A locally-created, never-synced file — invisible to the push loop,
    // backed up nowhere — already sits where this record would be written.
    vi.mocked(loadMindMapMeta).mockResolvedValue(null)
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([record]) } as any })

    const result = await sync({ client, currentUser: 'eleve1', syncFolderPath: '/cours', state: {} })

    expect(writeTextFile).not.toHaveBeenCalled()
    expect(result.pulled).toBe(0)
    expect(result.errors).toEqual([
      { fileId: 'file-2', message: 'un fichier local existe déjà à cet emplacement et n’est pas ce fichier synchronisé' },
    ])
  })
})
