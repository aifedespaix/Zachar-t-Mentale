import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createWorkspaceStore } from './useWorkspaceStore'

vi.mock('../persistence/workspaceConfig', () => ({
  loadWorkspaceConfig: vi.fn(),
  saveWorkspaceConfig: vi.fn(),
}))
vi.mock('../persistence/fileTree', () => ({ scanFolder: vi.fn() }))

import { loadWorkspaceConfig, saveWorkspaceConfig } from '../persistence/workspaceConfig'
import { scanFolder } from '../persistence/fileTree'

describe('useWorkspaceStore', () => {
  beforeEach(() => {
    vi.mocked(loadWorkspaceConfig).mockReset()
    vi.mocked(saveWorkspaceConfig).mockReset().mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockReset()
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
})
