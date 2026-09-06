import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { FileTreeNode, RootFolder } from '../types/workspace'
import { loadWorkspaceConfig, saveWorkspaceConfig } from '../persistence/workspaceConfig'
import { scanFolder } from '../persistence/fileTree'

interface WorkspaceState {
  rootFolders: RootFolder[]
  expandedPaths: Set<string>
  currentFilePath: string | null
  init: () => Promise<void>
  addRootFolder: (path: string) => Promise<void>
  removeRootFolder: (path: string) => Promise<void>
  refreshFolder: (folderPath: string) => Promise<void>
  toggleExpanded: (path: string) => void
  setCurrentFile: (path: string | null) => void
}

export type WorkspaceStore = UseBoundStore<StoreApi<WorkspaceState>>

/**
 * Splices freshly-scanned children into whichever folder node (root or
 * nested) matches `folderPath`, leaving the rest of the tree untouched — a
 * refresh only ever re-scans the one directory that just changed, never the
 * whole workspace.
 */
function replaceChildren(nodes: FileTreeNode[], folderPath: string, newChildren: FileTreeNode[]): FileTreeNode[] {
  return nodes.map(node => {
    if (node.type !== 'folder') return node
    if (node.path === folderPath) return { ...node, children: newChildren }
    return { ...node, children: replaceChildren(node.children, folderPath, newChildren) }
  })
}

export function createWorkspaceStore(): WorkspaceStore {
  return create<WorkspaceState>((set, get) => ({
    rootFolders: [],
    expandedPaths: new Set(),
    currentFilePath: null,
    init: async () => {
      const config = await loadWorkspaceConfig()
      const rootFolders = await Promise.all(
        config.rootFolders.map(async path => ({ path, tree: await scanFolder(path) }))
      )
      set({ rootFolders })
    },
    addRootFolder: async path => {
      if (get().rootFolders.some(f => f.path === path)) return
      const tree = await scanFolder(path)
      const rootFolders = [...get().rootFolders, { path, tree }]
      set({ rootFolders })
      await saveWorkspaceConfig({ rootFolders: rootFolders.map(f => f.path) })
    },
    removeRootFolder: async path => {
      const rootFolders = get().rootFolders.filter(f => f.path !== path)
      set({ rootFolders })
      await saveWorkspaceConfig({ rootFolders: rootFolders.map(f => f.path) })
    },
    refreshFolder: async folderPath => {
      const newChildren = await scanFolder(folderPath)
      set(state => ({
        rootFolders: state.rootFolders.map(f =>
          f.path === folderPath ? { ...f, tree: newChildren } : { ...f, tree: replaceChildren(f.tree, folderPath, newChildren) }
        ),
      }))
    },
    toggleExpanded: path =>
      set(state => {
        const next = new Set(state.expandedPaths)
        if (next.has(path)) next.delete(path)
        else next.add(path)
        return { expandedPaths: next }
      }),
    setCurrentFile: path => set({ currentFilePath: path }),
  }))
}

export const useWorkspaceStore = createWorkspaceStore()
