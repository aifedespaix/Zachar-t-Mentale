import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
}))
vi.mock('@tauri-apps/api/path', () => ({
  appConfigDir: vi.fn().mockResolvedValue('/config'),
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
}))

import { exists, readTextFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs'
import {
  emptySyncState,
  loadServerSyncState,
  loadSyncState,
  migrateLegacyState,
  resolveSyncState,
  saveSyncState,
  serverStateOf,
  type SyncState,
} from './syncState'

const V2: SyncState = {
  version: 2,
  servers: {
    'https://pb.test': {
      syncFolderPath: '/cours',
      entries: { 'file-1': { lastSyncedModified: 'm1', lastSyncedUpdated: 'u1', lastSyncedPath: 'a.zmap' } },
      tombstones: [],
    },
  },
}

describe('loadSyncState', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(readTextFile).mockReset()
  })

  it('reports nothing when no cache file exists yet', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    expect(await loadSyncState()).toEqual({ kind: 'none' })
  })

  it('reads a v2 file as it stands', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(V2))
    expect(await loadSyncState()).toEqual({ kind: 'v2', state: V2 })
  })

  it('recognises the flat v1 format instead of throwing it away', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    const legacy = { 'file-1': { lastSyncedModified: 'm1', lastSyncedUpdated: 'u1' } }
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(legacy))
    expect(await loadSyncState()).toEqual({ kind: 'legacy', entries: legacy })
  })

  it('discards a corrupted cache rather than throwing — it is cheap to rebuild', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue('{ not json')
    expect(await loadSyncState()).toEqual({ kind: 'none' })
  })
})

describe('migrateLegacyState', () => {
  const entries = { 'file-1': { lastSyncedModified: 'm1', lastSyncedUpdated: 'u1' } }

  it('files the flat entries under the configured server, paths unknown', () => {
    expect(migrateLegacyState(entries, 'https://pb.test', '/cours')).toEqual({
      version: 2,
      servers: { 'https://pb.test': { syncFolderPath: '/cours', entries, tombstones: [] } },
    })
  })

  it('drops them when no server is configured — a cache with nowhere to be filed', () => {
    expect(migrateLegacyState(entries, null, '/cours')).toEqual({ version: 2, servers: {} })
  })
})

describe('resolveSyncState', () => {
  it('passes a v2 file through untouched', () => {
    expect(resolveSyncState({ kind: 'v2', state: V2 }, 'https://pb.test', '/cours')).toBe(V2)
  })

  it('starts empty when there was nothing to read', () => {
    expect(resolveSyncState({ kind: 'none' }, 'https://pb.test', '/cours')).toEqual(emptySyncState())
  })
})

describe('serverStateOf', () => {
  it('creates the compartment on first use, and returns the same one afterwards', () => {
    const state = emptySyncState()
    const first = serverStateOf(state, 'https://pb.test', '/cours')
    expect(first).toEqual({ syncFolderPath: '/cours', entries: {}, tombstones: [] })
    first.entries['file-1'] = { lastSyncedModified: 'm', lastSyncedUpdated: 'u' }
    expect(serverStateOf(state, 'https://pb.test', '/cours').entries).toHaveProperty('file-1')
  })
})

describe('loadServerSyncState', () => {
  it('resolves the file for one server and guarantees its compartment exists', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(V2))
    const state = await loadServerSyncState('https://autre.test', '/cours')
    // Le compartiment du serveur demandé est créé, et celui de l'autre serveur
    // du fichier n'est pas dupliqué sous une clé approximative.
    expect(Object.keys(state.servers)).toEqual(['https://pb.test', 'https://autre.test'])
    expect(state.servers['https://autre.test']).toEqual({ syncFolderPath: '/cours', entries: {}, tombstones: [] })
  })
})

describe('saveSyncState', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(writeTextFile).mockReset()
    vi.mocked(mkdir).mockReset()
  })

  it('creates the config dir if missing, then writes the formatted JSON', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    await saveSyncState(V2)
    expect(mkdir).toHaveBeenCalledWith('/config', { recursive: true })
    expect(writeTextFile).toHaveBeenCalledWith('/config/sync-state.json', JSON.stringify(V2, null, 2))
  })
})
