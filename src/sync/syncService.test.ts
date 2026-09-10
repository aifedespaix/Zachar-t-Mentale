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
import {
  countPendingPushes,
  isPushPending,
  sync,
  type SyncClient,
  type RemoteMindMapRecord,
  type RemoteAssetRecord,
} from './syncService'
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

describe('isPushPending', () => {
  const known = { lastSyncedModified: AIFE.lastModified, lastSyncedUpdated: 'x' }

  it('is pending when we have never pushed it', () => {
    expect(isPushPending(AIFE, 'aife', undefined)).toBe(true)
  })

  it('is pending when the local file moved since the last push', () => {
    expect(isPushPending({ ...AIFE, lastModified: '2026-01-02T00:00:00.000Z' }, 'aife', known)).toBe(true)
  })

  it('is not pending when the cache already knows this exact version', () => {
    expect(isPushPending(AIFE, 'aife', known)).toBe(false)
  })

  it('never considers a map we do not author, or one that has no meta', () => {
    expect(isPushPending({ ...AIFE, author: 'someone-else' }, 'aife', undefined)).toBe(false)
    expect(isPushPending(null, 'aife', undefined)).toBe(false)
  })
})

describe('countPendingPushes', () => {
  it('counts only our own maps that moved since the last push', async () => {
    vi.mocked(scanFolder).mockResolvedValue([
      { type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' },
      { type: 'mindmap', name: 'b.zmap', path: '/cours/b.zmap' },
      { type: 'mindmap', name: 'c.zmap', path: '/cours/c.zmap' },
    ])
    vi.mocked(loadMindMapMeta).mockImplementation(async path => {
      if (path === '/cours/b.zmap') return { ...AIFE, id: 'b' }
      if (path === '/cours/c.zmap') return { ...AIFE, id: 'c', author: 'someone-else' }
      return { ...AIFE, id: 'a' }
    })

    const pending = await countPendingPushes({
      syncFolderPath: '/cours',
      currentUser: 'aife',
      state: { b: { lastSyncedModified: AIFE.lastModified, lastSyncedUpdated: 'x' } },
    })

    expect(pending).toBe(1) // 'a' never pushed; 'b' unchanged; 'c' is not ours
  })

  it('skips a map it cannot read rather than counting it', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' }])
    vi.mocked(loadMindMapMeta).mockRejectedValue(new Error('corrompu'))

    expect(await countPendingPushes({ syncFolderPath: '/cours', currentUser: 'aife', state: {} })).toBe(0)
  })

  it('lets an unreadable folder throw, so the caller can answer "unknown"', async () => {
    vi.mocked(scanFolder).mockRejectedValue(new Error('dossier disparu'))

    await expect(
      countPendingPushes({ syncFolderPath: '/cours', currentUser: 'aife', state: {} })
    ).rejects.toThrow('dossier disparu')
  })
})

describe('sync — push', () => {
  it('creates a remote record for a locally-authored file never synced before', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)
    vi.mocked(loadMindMap).mockResolvedValue([])
    const client = fakeClient()
    const state: SyncState = {}

    const result = await sync({ client, currentUser: 'aife', syncFolderPath: '/cours', state })

    // The second argument is the request options the sync threads through
    // (cancellation); the payload is what this test is about.
    expect(client.mindMaps.create).toHaveBeenCalledWith(
      expect.objectContaining({ file_id: 'file-1', author: 'aife', path: 'a.zmap' }),
      expect.anything()
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

    expect(client.mindMaps.update).toHaveBeenCalledWith('rec-1', expect.objectContaining({ path: 'a.zmap' }), expect.anything())
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

    expect(upload).toHaveBeenCalledWith('hash1', 'png', new Uint8Array([9, 9, 9]), expect.anything())
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

describe('sync — progression et annulation', () => {
  it('reports one step per file handled, over everything it knows about', async () => {
    vi.mocked(scanFolder).mockResolvedValue([
      { type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' },
      { type: 'mindmap', name: 'b.zmap', path: '/cours/b.zmap' },
    ])
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)
    vi.mocked(loadMindMap).mockResolvedValue([])
    const foreign: RemoteMindMapRecord = {
      id: 'rec-9',
      file_id: 'file-9',
      author: 'prof',
      path: 'c.zmap',
      content: JSON.stringify({ cards: [] }),
      updated: '2026-01-02 00:00:00.000Z',
    }
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([foreign]) } as any })
    const progress: Array<[number, number]> = []

    await sync({
      client,
      currentUser: 'aife',
      syncFolderPath: '/cours',
      state: {},
      onProgress: (done, total) => progress.push([done, total]),
    })

    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ])
  })

  it('touches no file when the signal is already aborted', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' }])
    const client = fakeClient()
    const controller = new AbortController()
    controller.abort()

    const result = await sync({
      client,
      currentUser: 'aife',
      syncFolderPath: '/cours',
      state: {},
      signal: controller.signal,
    })

    expect(result.cancelled).toBe(true)
    expect(client.mindMaps.create).not.toHaveBeenCalled()
  })

  it('stops mid-run when the signal aborts, keeping what already went through', async () => {
    vi.mocked(scanFolder).mockResolvedValue([
      { type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' },
      { type: 'mindmap', name: 'b.zmap', path: '/cours/b.zmap' },
    ])
    vi.mocked(loadMindMapMeta).mockImplementation(async path => ({
      ...AIFE,
      id: path.includes('a.zmap') ? 'a' : 'b',
    }))
    vi.mocked(loadMindMap).mockResolvedValue([])
    const controller = new AbortController()
    const client = fakeClient()
    vi.mocked(client.mindMaps.create).mockImplementation(async data => {
      // The user hit « Annuler » while this very file was in flight.
      controller.abort()
      return { id: 'rec-1', updated: '2026-01-02 00:00:00.000Z', ...data }
    })
    const state: SyncState = {}

    const result = await sync({
      client,
      currentUser: 'aife',
      syncFolderPath: '/cours',
      state,
      signal: controller.signal,
    })

    expect(result.cancelled).toBe(true)
    expect(result.pushed).toBe(1)
    expect(client.mindMaps.create).toHaveBeenCalledTimes(1)
    // The cache remembers the file that DID go through, so the next run does
    // not send it a second time.
    expect(Object.keys(state)).toEqual(['a'])
  })

  it('does not blame a file for a request the user cancelled', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)
    vi.mocked(loadMindMap).mockResolvedValue([])
    const abortError = Object.assign(new Error('The operation was aborted.'), { isAbort: true })
    const client = fakeClient({
      mindMaps: {
        getFullList: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockRejectedValue(abortError),
        update: vi.fn(),
      } as any,
    })

    const result = await sync({ client, currentUser: 'aife', syncFolderPath: '/cours', state: {} })

    expect(result.errors).toEqual([])
    expect(result.cancelled).toBe(true)
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

    expect(download).toHaveBeenCalledWith(asset, expect.anything())
    expect(writeAsset).toHaveBeenCalledWith('/cours/b.zmap', new Uint8Array([1, 2, 3]), 'png')
  })

  it('refuses to pull a record whose path escapes the sync folder', async () => {
    vi.mocked(scanFolder).mockResolvedValue([])
    const traversal = { ...record, path: '../../evil.zmap' }
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([traversal]) } as any })

    const result = await sync({ client, currentUser: 'eleve1', syncFolderPath: '/cours', state: {} })

    expect(writeTextFile).not.toHaveBeenCalled()
    expect(result.pulled).toBe(0)
    expect(result.errors).toEqual([{ fileId: 'file-2', message: 'chemin distant invalide, fichier ignoré' }])
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
