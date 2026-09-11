import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn().mockResolvedValue(false),
  writeTextFile: vi.fn(),
  readTextFile: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  copyFile: vi.fn(),
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

import { exists, writeTextFile, readDir, rename } from '@tauri-apps/plugin-fs'
import { loadMindMap, loadMindMapMeta } from '../persistence/fileStore'
import { scanFolder } from '../persistence/fileTree'
import { readAssetBytes, writeAsset } from '../persistence/assets'
import {
  flattenMindMapPaths,
  isConflict,
  planPush,
  surveySyncFolder,
  sync,
  type SyncClient,
  type SyncParams,
  type RemoteMindMapRecord,
  type RemoteAssetRecord,
} from './syncService'
import { hashContent } from './contentHash'
import { emptySyncState, type SyncState, type SyncStateEntry } from '../persistence/syncState'
import type { MindMapMeta, SyncUser } from '../types/card'

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

/** Un document v2 avec les entrées voulues pour le serveur de test. */
function memory(entries: Record<string, SyncStateEntry> = {}, syncFolderPath: string | null = '/cours'): SyncState {
  return { version: 2, servers: { 'https://pb.test': { syncFolderPath, entries, tombstones: [] } } }
}

/**
 * `sync` avec tout ce qui ne varie pas d'un test à l'autre.
 *
 * Une SURCHARGE partielle plutôt qu'un `Omit` : les tests qui se connectent en
 * élève ont besoin de changer `currentUser`/`currentRole`, et geler ces deux-là
 * dans le type du helper les en empêchait.
 */
function runSync(params: Partial<SyncParams> & { client: SyncClient }) {
  return sync({ currentUser: 'aife', currentRole: 'prof', serverUrl: 'https://pb.test', syncFolderPath: '/cours', state: emptySyncState(), ...params })
}

const AIFE: MindMapMeta = { id: 'file-1', author: 'aife', role: 'prof', lastModified: '2026-01-01T00:00:00.000Z' }

const AIFE_USER: SyncUser = { username: 'aife', role: 'prof' }
const ELEVE_USER: SyncUser = { username: 'eleve1', role: 'eleve' }

beforeEach(() => {
  vi.mocked(exists).mockReset().mockResolvedValue(false)
  vi.mocked(writeTextFile).mockReset()
  vi.mocked(readDir).mockReset().mockResolvedValue([])
  vi.mocked(loadMindMap).mockReset()
  vi.mocked(loadMindMapMeta).mockReset()
  vi.mocked(scanFolder).mockReset()
  vi.mocked(rename).mockReset().mockResolvedValue(undefined)
  vi.mocked(readAssetBytes).mockReset()
  vi.mocked(writeAsset).mockReset()
})

describe('planPush', () => {
  const known = { lastSyncedModified: AIFE.lastModified, lastSyncedUpdated: 'x', lastSyncedPath: 'a.zmap' }

  it('sends the content of a map we authored and changed', () => {
    expect(
      planPush({
        meta: { ...AIFE, lastModified: '2026-01-02T00:00:00.000Z' },
        relPath: 'a.zmap',
        currentUser: AIFE_USER,
        entry: known,
      })
    ).toEqual({ content: true, path: false })
  })

  it('sends the content of a map we never pushed, and lets the creation carry the path', () => {
    // Sans entrée, on ne sait pas quel chemin le serveur connaît : annoncer un
    // déplacement serait une invention, et le `create` envoie le chemin de
    // toute façon.
    expect(planPush({ meta: AIFE, relPath: 'a.zmap', currentUser: AIFE_USER, entry: undefined })).toEqual({
      content: true,
      path: false,
    })
  })

  it('treats a v1-migrated entry as "no path change", not as a move of every file', () => {
    // `lastSyncedPath` absent veut dire INCONNU. Le lire comme « différent »
    // ferait annoncer « N à envoyer » au premier lancement après mise à jour,
    // pour des fichiers qu'un sync n'enverrait pas.
    const migrated = { lastSyncedModified: AIFE.lastModified, lastSyncedUpdated: 'x' }
    expect(planPush({ meta: AIFE, relPath: 'a.zmap', currentUser: AIFE_USER, entry: migrated })).toEqual({
      content: false,
      path: false,
    })
  })

  it('sends a renamed map for its path alone, with no content change', () => {
    expect(planPush({ meta: AIFE, relPath: 'Chimie/a.zmap', currentUser: AIFE_USER, entry: known })).toEqual({
      content: false,
      path: true,
    })
  })

  it('sends nothing when neither content nor path moved', () => {
    expect(planPush({ meta: AIFE, relPath: 'a.zmap', currentUser: AIFE_USER, entry: known })).toEqual({
      content: false,
      path: false,
    })
  })

  it('never sends the CONTENT of a map we do not author, however new it looks', () => {
    const scan = planPush({
      meta: { ...AIFE, author: 'eleve1', lastModified: '2027-01-01T00:00:00.000Z' },
      relPath: 'a.zmap',
      currentUser: AIFE_USER,
      entry: known,
    })
    expect(scan.content).toBe(false)
  })

  it('lets a prof push the PATH of an eleve s map — that is how a class folder follows', () => {
    expect(
      planPush({ meta: { ...AIFE, author: 'eleve1' }, relPath: 'Chimie/a.zmap', currentUser: AIFE_USER, entry: known })
    ).toEqual({ content: false, path: true })
  })

  it('refuses an eleve the path of a map they do not own', () => {
    expect(
      planPush({ meta: { ...AIFE, author: 'aife' }, relPath: 'Chimie/a.zmap', currentUser: ELEVE_USER, entry: known })
    ).toEqual({ content: false, path: false })
  })
})

describe('isConflict', () => {
  const entry = { lastSyncedModified: 'm1', lastSyncedUpdated: 'u1', lastSyncedContentHash: 'aaaa' }
  const remote = { id: 'r', file_id: 'file-1', author: 'aife', path: 'a.zmap', content: '{}', updated: 'u2' }

  it('is a conflict when the remote CONTENT changed and so did mine', () => {
    expect(isConflict({ ...AIFE, lastModified: 'm2' }, entry, remote, 'bbbb')).toBe(true)
  })

  it('is NOT a conflict when the remote content is the one I already have — a path-only change', () => {
    // Le prof a déplacé le fichier : `updated` a bougé, le contenu non.
    expect(isConflict({ ...AIFE, lastModified: 'm2' }, entry, remote, 'aaaa')).toBe(false)
  })

  it('is not a conflict when I did not touch my copy', () => {
    expect(isConflict(AIFE, entry, remote, 'bbbb')).toBe(false)
  })

  it('is not a conflict when there is nothing to disagree with', () => {
    expect(isConflict({ ...AIFE, lastModified: 'm2' }, undefined, remote, 'bbbb')).toBe(false)
    expect(isConflict({ ...AIFE, lastModified: 'm2' }, entry, undefined, 'bbbb')).toBe(false)
  })

  it('falls back to the revision when the hash is unknown, as in a migrated entry', () => {
    const migrated = { lastSyncedModified: 'm1', lastSyncedUpdated: 'u1' }
    expect(isConflict({ ...AIFE, lastModified: 'm2' }, migrated, remote, 'bbbb')).toBe(true)
    expect(isConflict({ ...AIFE, lastModified: 'm2' }, { ...migrated, lastSyncedUpdated: 'u9' }, remote, 'bbbb')).toBe(false)
  })
})

describe('flattenMindMapPaths', () => {
  it('walks the whole tree, subfolders included, and ignores everything else', () => {
    const paths = flattenMindMapPaths([
      { type: 'mindmap', name: 'racine.zmap', path: '/cours/racine.zmap' },
      { type: 'other', name: 'notes.pdf', path: '/cours/notes.pdf' },
      {
        type: 'folder',
        name: 'chapitre 1',
        path: '/cours/chapitre 1',
        children: [
          { type: 'mindmap', name: 'a.zmap', path: '/cours/chapitre 1/a.zmap' },
          {
            type: 'folder',
            name: 'approfondissement',
            path: '/cours/chapitre 1/approfondissement',
            children: [{ type: 'mindmap', name: 'b.zmap', path: '/cours/chapitre 1/approfondissement/b.zmap' }],
          },
        ],
      },
    ])

    expect(paths).toEqual([
      '/cours/racine.zmap',
      '/cours/chapitre 1/a.zmap',
      '/cours/chapitre 1/approfondissement/b.zmap',
    ])
  })
})

describe('surveySyncFolder', () => {
  it('tells apart what a sync would send from what has never been published', async () => {
    vi.mocked(scanFolder).mockResolvedValue([
      { type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' },
      { type: 'mindmap', name: 'b.zmap', path: '/cours/b.zmap' },
      { type: 'mindmap', name: 'c.zmap', path: '/cours/c.zmap' },
      { type: 'mindmap', name: 'neuve.zmap', path: '/cours/neuve.zmap' },
    ])
    vi.mocked(loadMindMapMeta).mockImplementation(async path => {
      if (path === '/cours/b.zmap') return { ...AIFE, id: 'b' }
      if (path === '/cours/c.zmap') return { ...AIFE, id: 'c', author: 'someone-else' }
      if (path === '/cours/neuve.zmap') return null
      return { ...AIFE, id: 'a' }
    })

    const survey = await surveySyncFolder({
      syncFolderPath: '/cours',
      currentUser: AIFE_USER,
      entries: { b: { lastSyncedModified: AIFE.lastModified, lastSyncedUpdated: 'x' } },
    })

    // 'a' never pushed; 'b' unchanged; 'c' is not ours; 'neuve' has no identity.
    expect(survey.pending).toEqual(['/cours/a.zmap'])
    expect(survey.localOnly).toEqual(['/cours/neuve.zmap'])
  })

  it('ignores a file that is not a mind map rather than calling it unpublished', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'donnees.json', path: '/cours/donnees.json' }])
    vi.mocked(loadMindMapMeta).mockRejectedValue(new Error('pas une carte'))

    const survey = await surveySyncFolder({ syncFolderPath: '/cours', currentUser: AIFE_USER, entries: {} })

    expect(survey).toEqual({ pending: [], localOnly: [] })
  })

  it('counts a renamed file as pending, which it never did before', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a 2.zmap', path: '/cours/a 2.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)

    const survey = await surveySyncFolder({
      syncFolderPath: '/cours',
      currentUser: AIFE_USER,
      entries: { 'file-1': { lastSyncedModified: AIFE.lastModified, lastSyncedUpdated: 'x', lastSyncedPath: 'a.zmap' } },
    })

    expect(survey.pending).toEqual(['/cours/a 2.zmap'])
  })

  it('counts a file an eleve owns inside the prof s folder, and not the prof s own files', async () => {
    vi.mocked(scanFolder).mockResolvedValue([
      { type: 'mindmap', name: 'moi.zmap', path: '/cours/moi.zmap' },
      { type: 'mindmap', name: 'eleve.zmap', path: '/cours/eleve.zmap' },
    ])
    vi.mocked(loadMindMapMeta).mockImplementation(async path =>
      path === '/cours/eleve.zmap' ? { ...AIFE, id: 'eleve-file', author: 'eleve1' } : { ...AIFE, id: 'mine' }
    )

    const survey = await surveySyncFolder({
      syncFolderPath: '/cours',
      currentUser: AIFE_USER,
      entries: {
        mine: { lastSyncedModified: AIFE.lastModified, lastSyncedUpdated: 'x', lastSyncedPath: 'moi.zmap' },
        'eleve-file': { lastSyncedModified: AIFE.lastModified, lastSyncedUpdated: 'x', lastSyncedPath: 'vieux.zmap' },
      },
    })

    // Le prof peut répercuter le chemin du fichier de l'élève (il a bougé dans
    // son arbre) ; le sien n'a ni contenu ni chemin en attente.
    expect(survey.pending).toEqual(['/cours/eleve.zmap'])
  })

  it('lets an unreadable folder throw, so the caller can answer "unknown"', async () => {
    vi.mocked(scanFolder).mockRejectedValue(new Error('dossier disparu'))

    await expect(
      surveySyncFolder({ syncFolderPath: '/cours', currentUser: AIFE_USER, entries: {} })
    ).rejects.toThrow('dossier disparu')
  })
})

describe('sync — push', () => {
  it('creates a remote record for a locally-authored file never synced before', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)
    vi.mocked(loadMindMap).mockResolvedValue([])
    const client = fakeClient()
    const state = emptySyncState()

    const result = await runSync({ client, state })

    // The second argument is the request options the sync threads through
    // (cancellation); the payload is what this test is about.
    expect(client.mindMaps.create).toHaveBeenCalledWith(
      expect.objectContaining({ file_id: 'file-1', author: 'aife', path: 'a.zmap' }),
      expect.anything()
    )
    expect(result.pushed).toBe(1)
    expect(state.servers['https://pb.test'].entries['file-1']).toEqual({
      lastSyncedModified: AIFE.lastModified,
      lastSyncedUpdated: '2026-01-02 00:00:00.000Z',
      lastSyncedPath: 'a.zmap',
      lastSyncedContentHash: expect.any(String),
    })
  })

  it('updates the existing remote record when one already exists for that file_id', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)
    vi.mocked(loadMindMap).mockResolvedValue([])
    const existing: RemoteMindMapRecord = { id: 'rec-1', file_id: 'file-1', author: 'aife', path: 'a.zmap', content: '[]', updated: '2025-01-01 00:00:00.000Z' }
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([existing]) } as any })

    await runSync({ client, state: emptySyncState() })

    // Le contenu à son auteur, le chemin à qui peut réarranger : ici le fichier
    // est déjà au bon endroit côté serveur, donc seul le contenu part.
    expect(client.mindMaps.update).toHaveBeenCalledWith('rec-1', { content: expect.any(String) }, expect.anything())
    expect(client.mindMaps.create).not.toHaveBeenCalled()
  })

  it('skips a file already up to date in the cache', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)
    const client = fakeClient()
    const state = memory({ 'file-1': { lastSyncedModified: AIFE.lastModified, lastSyncedUpdated: 'x' } })

    const result = await runSync({ client, state })

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

    const result = await runSync({ client, state: emptySyncState() })

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

    const result = await runSync({ client, state: emptySyncState() })

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

    await runSync({ client, state: emptySyncState() })

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

    await runSync({ client, state: emptySyncState() })

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

    const result = await runSync({ client, state: emptySyncState() })

    expect(client.mindMaps.create).toHaveBeenCalledTimes(1)
    expect(result.pushed).toBe(1)
    expect(result.errors).toEqual([
      { fileId: 'file-1', message: 'plusieurs fichiers locaux partagent le même identifiant de synchronisation' },
    ])
  })
})

describe('sync — journal des transferts', () => {
  it('lists what actually moved, in order, for a detailed journal', async () => {
    vi.mocked(scanFolder).mockResolvedValue([
      { type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' },
      { type: 'mindmap', name: 'b.zmap', path: '/cours/b.zmap' },
    ])
    vi.mocked(loadMindMapMeta).mockImplementation(async path => ({
      ...AIFE,
      id: path.includes('a.zmap') ? 'file-1' : 'file-2',
    }))
    vi.mocked(loadMindMap).mockResolvedValue([])
    const foreign: RemoteMindMapRecord = {
      id: 'rec-3',
      file_id: 'file-3',
      author: 'prof',
      path: 'sous/c.zmap',
      content: JSON.stringify({ cards: [] }),
      updated: '2026-01-02 00:00:00.000Z',
    }
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([foreign]) } as any })

    const result = await runSync({ client, state: emptySyncState() })

    expect(result.transferred).toEqual([
      { fileId: 'file-1', path: 'a.zmap', direction: 'push' },
      { fileId: 'file-2', path: 'b.zmap', direction: 'push' },
      { fileId: 'file-3', path: 'sous/c.zmap', direction: 'pull' },
    ])
  })

  it('lists nothing for files it skipped', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue({ ...AIFE, author: 'quelqu-un-dautre' })
    const client = fakeClient()

    const result = await runSync({ client, state: emptySyncState() })

    expect(result.transferred).toEqual([])
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

    await runSync({
      client,
      state: emptySyncState(),
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

    const result = await runSync({
      client,
      state: emptySyncState(),
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
    const state = emptySyncState()

    const result = await runSync({
      client,
      state,
      signal: controller.signal,
    })

    expect(result.cancelled).toBe(true)
    expect(result.pushed).toBe(1)
    expect(client.mindMaps.create).toHaveBeenCalledTimes(1)
    // The cache remembers the file that DID go through, so the next run does
    // not send it a second time.
    expect(Object.keys(state.servers['https://pb.test'].entries)).toEqual(['a'])
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

    const result = await runSync({ client, state: emptySyncState() })

    expect(result.errors).toEqual([])
    expect(result.cancelled).toBe(true)
  })
})

describe('sync — conflits', () => {
  const CACHED: Record<string, SyncStateEntry> = {
    'file-1': { lastSyncedModified: '2026-01-01T00:00:00.000Z', lastSyncedUpdated: '2026-01-01 00:00:00.000Z' },
  }

  function localFile(lastModified: string) {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue({ ...AIFE, lastModified })
    vi.mocked(loadMindMap).mockResolvedValue([])
  }

  function remoteFile(updated: string): RemoteMindMapRecord {
    return {
      id: 'rec-1',
      file_id: 'file-1',
      author: 'aife',
      path: 'a.zmap',
      content: '[]',
      updated,
    }
  }

  it('detects the one case the fork model cannot rule out: both sides moved', async () => {
    localFile('2026-02-01T00:00:00.000Z')
    const client = fakeClient({
      mindMaps: { getFullList: vi.fn().mockResolvedValue([remoteFile('2026-02-01 10:00:00.000Z')]) } as any,
    })

    const result = await runSync({ client, state: memory({ ...CACHED }) })

    expect(client.mindMaps.update).not.toHaveBeenCalled()
    expect(client.mindMaps.create).not.toHaveBeenCalled()
    expect(result.pushed).toBe(0)
    expect(result.conflicts).toEqual([
      {
        fileId: 'file-1',
        path: 'a.zmap',
        localModified: '2026-02-01T00:00:00.000Z',
        remoteUpdated: '2026-02-01 10:00:00.000Z',
      },
    ])
  })

  it('is not a conflict when only we moved — that is an ordinary push', async () => {
    localFile('2026-02-01T00:00:00.000Z')
    const client = fakeClient({
      mindMaps: { getFullList: vi.fn().mockResolvedValue([remoteFile('2026-01-01 00:00:00.000Z')]) } as any,
    })

    const result = await runSync({ client, state: memory({ ...CACHED }) })

    expect(result.conflicts).toEqual([])
    expect(result.pushed).toBe(1)
  })

  it('is not a conflict when only the server moved — the pull pass handles it', async () => {
    localFile(AIFE.lastModified)
    const client = fakeClient({
      mindMaps: { getFullList: vi.fn().mockResolvedValue([remoteFile('2026-02-01 10:00:00.000Z')]) } as any,
    })

    const result = await runSync({ client, state: memory({ ...CACHED }) })

    expect(result.conflicts).toEqual([])
  })

  it('is never a conflict on a first push — nothing to disagree with', async () => {
    localFile('2026-02-01T00:00:00.000Z')
    const client = fakeClient({
      mindMaps: { getFullList: vi.fn().mockResolvedValue([remoteFile('2026-02-01 10:00:00.000Z')]) } as any,
    })

    const result = await runSync({ client, state: emptySyncState() })

    expect(result.conflicts).toEqual([])
    expect(result.pushed).toBe(1)
  })

  it('does not let one conflicted file stop the others', async () => {
    vi.mocked(scanFolder).mockResolvedValue([
      { type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' },
      { type: 'mindmap', name: 'b.zmap', path: '/cours/b.zmap' },
    ])
    vi.mocked(loadMindMapMeta).mockImplementation(async path => ({
      ...AIFE,
      id: path.includes('a.zmap') ? 'file-1' : 'file-2',
      lastModified: '2026-02-01T00:00:00.000Z',
    }))
    vi.mocked(loadMindMap).mockResolvedValue([])
    const client = fakeClient({
      mindMaps: { getFullList: vi.fn().mockResolvedValue([remoteFile('2026-02-01 10:00:00.000Z')]) } as any,
    })

    const result = await runSync({ client, state: memory({ ...CACHED }) })

    expect(result.conflicts).toHaveLength(1)
    expect(result.pushed).toBe(1) // b.zmap went through
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

    const result = await sync({ client, currentUser: 'eleve1', currentRole: 'eleve', serverUrl: 'https://pb.test', syncFolderPath: '/cours', state: emptySyncState() })

    expect(writeTextFile).toHaveBeenCalledWith('/cours/b.zmap', record.content)
    expect(result.pulled).toBe(1)
  })

  it('never pulls a record authored by the current user', async () => {
    vi.mocked(scanFolder).mockResolvedValue([])
    const own = { ...record, author: 'eleve1' }
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([own]) } as any })

    const result = await sync({ client, currentUser: 'eleve1', currentRole: 'eleve', serverUrl: 'https://pb.test', syncFolderPath: '/cours', state: emptySyncState() })

    expect(writeTextFile).not.toHaveBeenCalled()
    expect(result.pulled).toBe(0)
  })

  it('skips a record already up to date in the cache', async () => {
    vi.mocked(scanFolder).mockResolvedValue([])
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([record]) } as any })
    const state = memory({ 'file-2': { lastSyncedModified: 'x', lastSyncedUpdated: record.updated } })

    const result = await sync({ client, currentUser: 'eleve1', currentRole: 'eleve', serverUrl: 'https://pb.test', syncFolderPath: '/cours', state })

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

    await sync({ client, currentUser: 'eleve1', currentRole: 'eleve', serverUrl: 'https://pb.test', syncFolderPath: '/cours', state: emptySyncState() })

    expect(download).toHaveBeenCalledWith(asset, expect.anything())
    expect(writeAsset).toHaveBeenCalledWith('/cours/b.zmap', new Uint8Array([1, 2, 3]), 'png')
  })

  it('refuses to pull a record whose path escapes the sync folder', async () => {
    vi.mocked(scanFolder).mockResolvedValue([])
    const traversal = { ...record, path: '../../evil.zmap' }
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([traversal]) } as any })

    const result = await sync({ client, currentUser: 'eleve1', currentRole: 'eleve', serverUrl: 'https://pb.test', syncFolderPath: '/cours', state: emptySyncState() })

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

    const result = await sync({ client, currentUser: 'eleve1', currentRole: 'eleve', serverUrl: 'https://pb.test', syncFolderPath: '/cours', state: emptySyncState() })

    expect(writeTextFile).not.toHaveBeenCalled()
    expect(result.pulled).toBe(0)
    expect(result.errors).toEqual([
      { fileId: 'file-2', message: 'un fichier local existe déjà à cet emplacement et n’est pas ce fichier synchronisé' },
    ])
  })
})

describe('sync — reconciliation des chemins', () => {
  it('relocates the local file when the server moved it, instead of leaving a duplicate behind', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)
    vi.mocked(exists).mockResolvedValue(false)
    const remote: RemoteMindMapRecord = {
      id: 'rec-1',
      file_id: 'file-1',
      author: 'aife',
      path: 'Chimie/a du carbone.zmap',
      content: JSON.stringify({ cards: [] }),
      updated: 'u1',
    }
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([remote]) } as any })

    const result = await runSync({
      client,
      state: memory({ 'file-1': { lastSyncedModified: AIFE.lastModified, lastSyncedUpdated: 'u0', lastSyncedPath: 'a.zmap' } }),
    })

    expect(rename).toHaveBeenCalledWith('/cours/a.zmap', '/cours/Chimie/a du carbone.zmap')
    expect(result.relocated).toBe(1)
    expect(result.moved).toEqual([{ fileId: 'file-1', from: '/cours/a.zmap', to: '/cours/Chimie/a du carbone.zmap' }])
  })

  it('reports a relocation that would collide with ANOTHER file instead of destroying it', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' }])
    // Ce qui occupe la destination est un AUTRE fichier : c'est le seul cas où
    // replacer écrase le travail de quelqu'un.
    vi.mocked(loadMindMapMeta).mockImplementation(async path =>
      path === '/cours/Chimie/a.zmap' ? { ...AIFE, id: 'autre-file' } : AIFE
    )
    vi.mocked(exists).mockResolvedValue(true)
    const remote: RemoteMindMapRecord = {
      id: 'rec-1',
      file_id: 'file-1',
      author: 'aife',
      path: 'Chimie/a.zmap',
      content: JSON.stringify({ cards: [] }),
      updated: 'u1',
    }
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([remote]) } as any })

    const result = await runSync({
      client,
      state: memory({ 'file-1': { lastSyncedModified: AIFE.lastModified, lastSyncedUpdated: 'u0', lastSyncedPath: 'a.zmap' } }),
    })

    expect(rename).not.toHaveBeenCalled()
    expect(result.relocated).toBe(0)
    expect(result.errors[0]?.message).toContain('existe déjà')
  })

  it('treats a rename that only changes the case as the same file, not as a collision', async () => {
    // Sous Windows `exists()` ignore la casse : refuser ici condamnerait le
    // fichier à une relocalisation refusée à CHAQUE synchronisation, pour
    // toujours, alors que c'est le même `file_id` qui est déjà là.
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'chapitre.zmap', path: '/cours/chapitre.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)
    vi.mocked(exists).mockResolvedValue(true)
    const remote: RemoteMindMapRecord = {
      id: 'rec-1',
      file_id: 'file-1',
      author: 'aife',
      path: 'Chapitre.zmap',
      content: JSON.stringify({ cards: [] }),
      updated: 'u1',
    }
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([remote]) } as any })

    const result = await runSync({
      client,
      state: memory({ 'file-1': { lastSyncedModified: AIFE.lastModified, lastSyncedUpdated: 'u0', lastSyncedPath: 'chapitre.zmap' } }),
    })

    expect(rename).toHaveBeenCalledWith('/cours/chapitre.zmap', '/cours/Chapitre.zmap')
    expect(result.errors).toEqual([])
    expect(result.relocated).toBe(1)
  })

  it('applies the server path and says so when the two sides moved differently', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'local.zmap', path: '/cours/local.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)
    const remote: RemoteMindMapRecord = {
      id: 'rec-1',
      file_id: 'file-1',
      author: 'aife',
      path: 'distant.zmap',
      content: JSON.stringify({ cards: [] }),
      updated: 'u1',
    }
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([remote]) } as any })

    const result = await runSync({
      client,
      state: memory({ 'file-1': { lastSyncedModified: AIFE.lastModified, lastSyncedUpdated: 'u0', lastSyncedPath: 'ancien.zmap' } }),
    })

    expect(rename).toHaveBeenCalledWith('/cours/local.zmap', '/cours/distant.zmap')
    expect(result.notices).toEqual([
      { fileId: 'file-1', message: '« distant.zmap » a été déplacé des deux côtés : le chemin du serveur a été appliqué' },
    ])
  })

  it('re-anchors the base on the remote path when the two sides ended up at the same path', async () => {
    // `reconcilePath` ne fait rien ici, mais la base doit suivre : sans ça, un
    // renommage local ULTÉRIEUR serait lu comme « les deux ont bougé
    // différemment » puis annulé par une relocalisation — une action de
    // l'utilisateur silencieusement défaite.
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)
    const remote: RemoteMindMapRecord = {
      id: 'rec-1',
      file_id: 'file-1',
      author: 'aife',
      path: 'a.zmap',
      content: JSON.stringify({ cards: [] }),
      updated: 'u1',
    }
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([remote]) } as any })
    const state = memory({ 'file-1': { lastSyncedModified: AIFE.lastModified, lastSyncedUpdated: 'u0', lastSyncedPath: 'vieux.zmap' } })

    await runSync({ client, state })

    expect(state.servers['https://pb.test'].entries['file-1'].lastSyncedPath).toBe('a.zmap')
  })

  it('leaves everything alone when the sync folder itself changed', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a.zmap', path: '/autre/a.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([]) } as any })

    await runSync({
      client,
      syncFolderPath: '/autre',
      state: { version: 2, servers: { 'https://pb.test': { syncFolderPath: '/cours', entries: { 'file-1': { lastSyncedModified: 'm0', lastSyncedUpdated: 'u0', lastSyncedPath: 'a.zmap' } }, tombstones: [] } } },
    })

    expect(rename).not.toHaveBeenCalled()
  })

  it('repairs a path the pre-v2 versions left stale, on the first sync after the migration', async () => {
    // Entrée migrée : `lastSyncedPath` inconnu. La racine n'a pas bougé, donc
    // l'amarrage prend le chemin DISTANT — ce qui rend « j'ai bougé » vrai et
    // déclenche enfin l'envoi du chemin que le renommage n'avait jamais poussé.
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'Chapitre 2.zmap', path: '/cours/Chapitre 2.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue({ ...AIFE, lastModified: '2026-01-05T00:00:00.000Z' })
    vi.mocked(loadMindMap).mockResolvedValue([])
    const update = vi.fn().mockResolvedValue({ id: 'rec-1', file_id: 'file-1', author: 'aife', path: 'Chapitre 2.zmap', content: 'c', updated: 'u2' })
    const client = fakeClient({
      mindMaps: {
        getFullList: vi.fn().mockResolvedValue([{ id: 'rec-1', file_id: 'file-1', author: 'aife', path: 'Chapitre 1.zmap', content: 'vieux', updated: 'u1' }]),
        update,
      } as any,
    })

    await runSync({
      client,
      // Entrée SANS `lastSyncedPath` : c'est la signature d'une entrée migrée.
      state: memory({ 'file-1': { lastSyncedModified: '2026-01-01T00:00:00.000Z', lastSyncedUpdated: 'u1' } }),
    })

    expect(update).toHaveBeenCalled()
  })
})

describe('sync — chemins normalisés', () => {
  it('reads a Windows path and its canonical slash form as the same file', async () => {
    // Séparateur local dans le chemin, forme canonique à slashes côté état :
    // sans normalisation, chaque fichier serait lu comme « déplacé », en attente
    // perpétuelle, avec une relocalisation tentée à chaque sync.
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a.zmap', path: 'C:\\cours\\Chimie\\a.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)

    const survey = await surveySyncFolder({
      syncFolderPath: 'C:\\cours',
      currentUser: AIFE_USER,
      entries: { 'file-1': { lastSyncedModified: AIFE.lastModified, lastSyncedUpdated: 'x', lastSyncedPath: 'Chimie/a.zmap' } },
    })

    expect(survey.pending).toEqual([])
  })

  it('reads a POSIX path the same way', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a.zmap', path: '/cours/Chimie/a.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)

    const survey = await surveySyncFolder({
      syncFolderPath: '/cours',
      currentUser: AIFE_USER,
      entries: { 'file-1': { lastSyncedModified: AIFE.lastModified, lastSyncedUpdated: 'x', lastSyncedPath: 'Chimie/a.zmap' } },
    })

    expect(survey.pending).toEqual([])
  })
})

describe('sync — push par champ', () => {
  it('sends only the content when the author edited, leaving the path the prof set alone', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'Chimie/a.zmap', path: '/cours/Chimie/a.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue({ ...AIFE, lastModified: '2026-02-01T00:00:00.000Z' })
    vi.mocked(loadMindMap).mockResolvedValue([])
    const update = vi.fn().mockResolvedValue({ id: 'rec-1', file_id: 'file-1', author: 'aife', path: 'Chimie/a.zmap', content: 'c', updated: 'u2' })
    const client = fakeClient({
      mindMaps: {
        getFullList: vi.fn().mockResolvedValue([{ id: 'rec-1', file_id: 'file-1', author: 'aife', path: 'Chimie/a.zmap', content: 'vieux', updated: 'u1' }]),
        update,
      } as any,
    })

    await runSync({
      client,
      state: memory({ 'file-1': { lastSyncedModified: AIFE.lastModified, lastSyncedUpdated: 'u1', lastSyncedPath: 'Chimie/a.zmap' } }),
    })

    expect(update).toHaveBeenCalledWith('rec-1', { content: expect.any(String) }, expect.anything())
    expect(vi.mocked(update).mock.calls[0][1]).not.toHaveProperty('path')
  })

  it('sends only the path when a prof moved an eleve s map, and never touches its content', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'Chimie/b.zmap', path: '/cours/Chimie/b.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue({ ...AIFE, id: 'file-2', author: 'eleve1', role: 'eleve' })
    const update = vi.fn().mockResolvedValue({ id: 'rec-2', file_id: 'file-2', author: 'eleve1', path: 'Chimie/b.zmap', content: 'x', updated: 'u9' })
    const client = fakeClient({
      mindMaps: {
        getFullList: vi.fn().mockResolvedValue([{ id: 'rec-2', file_id: 'file-2', author: 'eleve1', path: 'b.zmap', content: 'x', updated: 'u1' }]),
        update,
      } as any,
    })
    const state = memory({ 'file-2': { lastSyncedModified: 'm-eleve', lastSyncedUpdated: 'u1', lastSyncedPath: 'b.zmap', lastSyncedContentHash: await hashContent('x') } })

    await runSync({ client, state })

    expect(update).toHaveBeenCalledWith('rec-2', { path: 'Chimie/b.zmap' }, expect.anything())
    // La BOUCLE, pas seulement le compteur : un push de chemin ne lit ni ne
    // réécrit le contenu d'un élève — c'est exactement la faute que la
    // séparation par champ existe pour éviter.
    expect(loadMindMap).not.toHaveBeenCalled()
    expect(writeTextFile).not.toHaveBeenCalled()
    // La révision de CONTENU vue par ce client ne doit pas bouger : un prof
    // n'écrit pas le contenu d'un élève.
    expect(state.servers['https://pb.test'].entries['file-2'].lastSyncedModified).toBe('m-eleve')
  })

  it('refuses to push the path of an eleve s map when the account is an eleve', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'Chimie/b.zmap', path: '/cours/Chimie/b.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue({ ...AIFE, id: 'file-2', author: 'aife' })
    const update = vi.fn()
    const client = fakeClient({ mindMaps: { update } as any })

    await runSync({
      client,
      currentUser: 'eleve1',
      currentRole: 'eleve',
      state: memory({ 'file-2': { lastSyncedModified: 'm', lastSyncedUpdated: 'u1', lastSyncedPath: 'b.zmap' } }),
    })

    expect(update).not.toHaveBeenCalled()
  })

  it('remembers the path and the content hash after a pull, so the next run compares like with like', async () => {
    vi.mocked(scanFolder).mockResolvedValue([])
    vi.mocked(exists).mockResolvedValue(false)
    const content = JSON.stringify({ cards: [] })
    const client = fakeClient({
      mindMaps: {
        getFullList: vi.fn().mockResolvedValue([{ id: 'r', file_id: 'file-9', author: 'prof', path: 'sous/c.zmap', content, updated: 'u3' }]),
      } as any,
    })
    const state = memory()

    await runSync({ client, state })

    expect(state.servers['https://pb.test'].entries['file-9']).toEqual({
      lastSyncedModified: 'u3',
      lastSyncedUpdated: 'u3',
      lastSyncedPath: 'sous/c.zmap',
      lastSyncedContentHash: await hashContent(content),
    })
  })

  it('stores the hash of the exact string it sent, asserted on what the client received', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)
    vi.mocked(loadMindMap).mockResolvedValue([])
    const client = fakeClient()
    const state = emptySyncState()

    await runSync({ client, state })

    // L'argument RÉELLEMENT reçu par le faux client, pas une constante
    // recalculée : hacher un jumeau sérialisé différemment du même contenu
    // rendrait la comparaison de conflit « toujours différente », et aucun test
    // ne tomberait — le symptôme est un conflit permanent, pas une erreur.
    const sent = vi.mocked(client.mindMaps.create).mock.calls[0][0]
    expect(sent.content).toContain('"file-1"')
    expect(state.servers['https://pb.test'].entries['file-1'].lastSyncedContentHash).toBe(await hashContent(sent.content))
  })
})
