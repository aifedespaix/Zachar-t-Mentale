import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createWorkspaceStore } from './useWorkspaceStore'

vi.mock('../persistence/workspaceConfig', () => ({
  loadWorkspaceConfig: vi.fn(),
  saveWorkspaceConfig: vi.fn(),
}))
vi.mock('../persistence/fileTree', () => ({ scanFolder: vi.fn() }))
vi.mock('../persistence/sessionState', () => ({
  loadSessionState: vi.fn(),
  saveSessionState: vi.fn(),
}))

import { loadWorkspaceConfig, saveWorkspaceConfig } from '../persistence/workspaceConfig'
import { scanFolder } from '../persistence/fileTree'
import { loadSessionState, saveSessionState } from '../persistence/sessionState'

describe('useWorkspaceStore', () => {
  beforeEach(() => {
    vi.mocked(loadWorkspaceConfig).mockReset()
    vi.mocked(saveWorkspaceConfig).mockReset().mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockReset()
    vi.mocked(loadSessionState)
      .mockReset()
      .mockReturnValue({ currentFilePath: null, expandedPaths: [] })
    vi.mocked(saveSessionState).mockReset()
  })

  it('init loads configured root folders and scans each one', async () => {
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootFolders: ['/cours-svt', '/cours-maths'] })
    vi.mocked(scanFolder).mockImplementation(async (path: string) => [
      { type: 'mindmap', name: 'a.json', path: `${path}/a.json` },
    ])
    const store = createWorkspaceStore()

    await store.getState().init()

    expect(store.getState().rootFolders).toEqual([
      { path: '/cours-svt', tree: [{ type: 'mindmap', name: 'a.json', path: '/cours-svt/a.json' }] },
      { path: '/cours-maths', tree: [{ type: 'mindmap', name: 'a.json', path: '/cours-maths/a.json' }] },
    ])
  })

  it('addRootFolder scans the folder, adds it, and persists the config', async () => {
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootFolders: [] })
    vi.mocked(scanFolder).mockResolvedValue([])
    const store = createWorkspaceStore()
    await store.getState().init()

    await store.getState().addRootFolder('/cours-histoire')

    expect(store.getState().rootFolders).toEqual([{ path: '/cours-histoire', tree: [] }])
    expect(saveWorkspaceConfig).toHaveBeenCalledWith({ rootFolders: ['/cours-histoire'] })
  })

  it('addRootFolder does not add the same folder twice', async () => {
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootFolders: ['/cours'] })
    vi.mocked(scanFolder).mockResolvedValue([])
    const store = createWorkspaceStore()
    await store.getState().init()

    await store.getState().addRootFolder('/cours')

    expect(store.getState().rootFolders).toHaveLength(1)
  })

  it('removeRootFolder drops the folder and persists the config', async () => {
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootFolders: ['/a', '/b'] })
    vi.mocked(scanFolder).mockResolvedValue([])
    const store = createWorkspaceStore()
    await store.getState().init()

    await store.getState().removeRootFolder('/a')

    expect(store.getState().rootFolders).toEqual([{ path: '/b', tree: [] }])
    expect(saveWorkspaceConfig).toHaveBeenCalledWith({ rootFolders: ['/b'] })
  })

  it('refreshFolder rescans a root folder and replaces its tree', async () => {
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootFolders: ['/cours'] })
    vi.mocked(scanFolder).mockResolvedValueOnce([])
    const store = createWorkspaceStore()
    await store.getState().init()

    vi.mocked(scanFolder).mockResolvedValueOnce([{ type: 'mindmap', name: 'new.json', path: '/cours/new.json' }])
    await store.getState().refreshFolder('/cours')

    expect(store.getState().rootFolders).toEqual([
      { path: '/cours', tree: [{ type: 'mindmap', name: 'new.json', path: '/cours/new.json' }] },
    ])
  })

  it('refreshFolder rescans a nested subfolder and splices its new children into place', async () => {
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootFolders: ['/cours'] })
    vi.mocked(scanFolder).mockResolvedValueOnce([
      { type: 'folder', name: 'chimie', path: '/cours/chimie', children: [] },
    ])
    const store = createWorkspaceStore()
    await store.getState().init()

    vi.mocked(scanFolder).mockResolvedValueOnce([
      { type: 'mindmap', name: 'atomes.json', path: '/cours/chimie/atomes.json' },
    ])
    await store.getState().refreshFolder('/cours/chimie')

    expect(store.getState().rootFolders).toEqual([
      {
        path: '/cours',
        tree: [
          {
            type: 'folder',
            name: 'chimie',
            path: '/cours/chimie',
            children: [{ type: 'mindmap', name: 'atomes.json', path: '/cours/chimie/atomes.json' }],
          },
        ],
      },
    ])
  })

  // A rejected `Promise.all` used to leave rootFolders empty, so the next
  // add/remove persisted that empty list — permanently erasing every other
  // configured folder from workspace.json.
  it('init keeps a root folder whose scan failed, with an empty tree and an explicit error', async () => {
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootFolders: ['/cours-svt', '/hors-home', '/cours-maths'] })
    vi.mocked(scanFolder).mockImplementation(async (path: string) => {
      if (path === '/hors-home') throw new Error('forbidden path')
      return [{ type: 'mindmap', name: 'a.json', path: `${path}/a.json` }]
    })
    const store = createWorkspaceStore()

    await store.getState().init()

    expect(store.getState().rootFolders.map(f => f.path)).toEqual(['/cours-svt', '/hors-home', '/cours-maths'])
    expect(store.getState().rootFolders[1].tree).toEqual([])
    expect(store.getState().rootFolders[0].tree).toHaveLength(1)
    expect(store.getState().workspaceError).toMatch(/hors-home/)
  })

  it('a later addRootFolder never drops a root folder that merely failed to scan at init', async () => {
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootFolders: ['/cassé', '/ok'] })
    vi.mocked(scanFolder).mockImplementation(async (path: string) => {
      if (path === '/cassé') throw new Error('unreadable')
      return []
    })
    const store = createWorkspaceStore()
    await store.getState().init()

    await store.getState().addRootFolder('/nouveau')

    expect(saveWorkspaceConfig).toHaveBeenCalledWith({ rootFolders: ['/cassé', '/ok', '/nouveau'] })
  })

  it('init reports a config read failure instead of failing silently', async () => {
    vi.mocked(loadWorkspaceConfig).mockRejectedValue(new Error('disque illisible'))
    const store = createWorkspaceStore()

    await store.getState().init()

    expect(store.getState().workspaceError).toMatch(/disque illisible/)
  })

  it('addRootFolder reports a scan failure and adds nothing', async () => {
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootFolders: [] })
    vi.mocked(scanFolder).mockRejectedValue(new Error('accès refusé'))
    const store = createWorkspaceStore()
    await store.getState().init()

    await store.getState().addRootFolder('/interdit')

    expect(store.getState().rootFolders).toEqual([])
    expect(saveWorkspaceConfig).not.toHaveBeenCalled()
    expect(store.getState().workspaceError).toMatch(/accès refusé/)
  })

  it('removeRootFolder keeps the folder listed when the config write fails, and says so', async () => {
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootFolders: ['/a'] })
    vi.mocked(scanFolder).mockResolvedValue([])
    const store = createWorkspaceStore()
    await store.getState().init()
    vi.mocked(saveWorkspaceConfig).mockRejectedValue(new Error('lecture seule'))

    await store.getState().removeRootFolder('/a')

    expect(store.getState().rootFolders.map(f => f.path)).toEqual(['/a'])
    expect(store.getState().workspaceError).toMatch(/lecture seule/)
  })

  it('refreshFolder reports a scan failure and leaves the existing tree in place', async () => {
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootFolders: ['/cours'] })
    vi.mocked(scanFolder).mockResolvedValueOnce([{ type: 'mindmap', name: 'a.json', path: '/cours/a.json' }])
    const store = createWorkspaceStore()
    await store.getState().init()

    vi.mocked(scanFolder).mockRejectedValueOnce(new Error('dossier introuvable'))
    await store.getState().refreshFolder('/cours')

    expect(store.getState().rootFolders[0].tree).toHaveLength(1)
    expect(store.getState().workspaceError).toMatch(/dossier introuvable/)
  })

  it('refreshAll re-scans every root folder', async () => {
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootFolders: ['/a', '/b'] })
    vi.mocked(scanFolder).mockResolvedValue([])
    const store = createWorkspaceStore()
    await store.getState().init()

    vi.mocked(scanFolder).mockImplementation(async (path: string) => [
      { type: 'mindmap', name: 'neuf.json', path: `${path}/neuf.json` },
    ])
    await store.getState().refreshAll()

    expect(store.getState().rootFolders).toEqual([
      { path: '/a', tree: [{ type: 'mindmap', name: 'neuf.json', path: '/a/neuf.json' }] },
      { path: '/b', tree: [{ type: 'mindmap', name: 'neuf.json', path: '/b/neuf.json' }] },
    ])
    expect(store.getState().workspaceError).toBeNull()
  })

  it('refreshAll keeps the existing tree of a folder that fails, refreshes the others, and reports it', async () => {
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootFolders: ['/a', '/b'] })
    vi.mocked(scanFolder).mockImplementation(async (path: string) => [
      { type: 'mindmap', name: 'vieux.json', path: `${path}/vieux.json` },
    ])
    const store = createWorkspaceStore()
    await store.getState().init()

    vi.mocked(scanFolder).mockImplementation(async (path: string) => {
      if (path === '/a') throw new Error('disparu')
      return [{ type: 'mindmap', name: 'neuf.json', path: `${path}/neuf.json` }]
    })
    await store.getState().refreshAll()

    expect(store.getState().rootFolders).toEqual([
      { path: '/a', tree: [{ type: 'mindmap', name: 'vieux.json', path: '/a/vieux.json' }] },
      { path: '/b', tree: [{ type: 'mindmap', name: 'neuf.json', path: '/b/neuf.json' }] },
    ])
    expect(store.getState().workspaceError).toMatch(/« a »/)
  })

  it('setWorkspaceError sets and clears the message', () => {
    const store = createWorkspaceStore()
    store.getState().setWorkspaceError('Impossible de créer le dossier.')
    expect(store.getState().workspaceError).toBe('Impossible de créer le dossier.')

    store.getState().setWorkspaceError(null)
    expect(store.getState().workspaceError).toBeNull()
  })

  it('toggleExpanded adds then removes a path from the expanded set', () => {
    const store = createWorkspaceStore()
    store.getState().toggleExpanded('/cours/chimie')
    expect(store.getState().expandedPaths.has('/cours/chimie')).toBe(true)

    store.getState().toggleExpanded('/cours/chimie')
    expect(store.getState().expandedPaths.has('/cours/chimie')).toBe(false)
  })

  it('setCurrentFile updates the currently open file path', () => {
    const store = createWorkspaceStore()
    store.getState().setCurrentFile('/cours/chapitre1.json')
    expect(store.getState().currentFilePath).toBe('/cours/chapitre1.json')

    store.getState().setCurrentFile(null)
    expect(store.getState().currentFilePath).toBeNull()
  })

  it('init restores the open file and expanded folders from the saved session', async () => {
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootFolders: ['/cours'] })
    vi.mocked(scanFolder).mockResolvedValue([])
    vi.mocked(loadSessionState).mockReturnValue({
      currentFilePath: '/cours/fractions.json',
      expandedPaths: ['/cours'],
    })
    const store = createWorkspaceStore()

    await store.getState().init()

    expect(store.getState().currentFilePath).toBe('/cours/fractions.json')
    expect(store.getState().expandedPaths.has('/cours')).toBe(true)
  })

  it('setCurrentFile persists the session', () => {
    const store = createWorkspaceStore()
    store.getState().setCurrentFile('/cours/chapitre1.json')

    expect(saveSessionState).toHaveBeenLastCalledWith({
      currentFilePath: '/cours/chapitre1.json',
      expandedPaths: [],
    })
  })

  it('toggleExpanded persists the session', () => {
    const store = createWorkspaceStore()
    store.getState().toggleExpanded('/cours/chimie')

    expect(saveSessionState).toHaveBeenLastCalledWith({
      currentFilePath: null,
      expandedPaths: ['/cours/chimie'],
    })
  })
})
