import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { FileTreeNode, RootFolder } from '../types/workspace'
import { loadWorkspaceConfig, saveWorkspaceConfig } from '../persistence/workspaceConfig'
import { scanFolder } from '../persistence/fileTree'
import { loadSessionState, saveSessionState } from '../persistence/sessionState'

interface WorkspaceState {
  rootFolders: RootFolder[]
  expandedPaths: Set<string>
  currentFilePath: string | null
  /**
   * Last workspace/filesystem failure, in plain French, for the sidebar to
   * show. `null` means "nothing went wrong that the user still needs to see".
   * The app's first principle is "aucun état caché sans explication": a failed
   * fs operation must never just leave the tree unchanged with no signal.
   */
  workspaceError: string | null
  /**
   * Bumped whenever a `.zmap`'s `meta` header changed under an EXISTING path —
   * publishing a file, or pulling one during a sync.
   *
   * `useMindMapAuthor` keys its read on the path, so without this a row's lock
   * badge would keep showing the metadata it read at mount: the file is the
   * same file, only its header moved.
   */
  fileMetaRevision: number
  bumpFileMetaRevision: () => void
  init: () => Promise<void>
  addRootFolder: (path: string) => Promise<void>
  removeRootFolder: (path: string) => Promise<void>
  refreshFolder: (folderPath: string) => Promise<void>
  refreshAll: () => Promise<void>
  toggleExpanded: (path: string) => void
  /**
   * Expands every folder in `paths` (a root-to-leaf trail), so a file created
   * somewhere the user cannot currently see is revealed rather than opened
   * into a collapsed tree with no visible trace.
   */
  expandPaths: (paths: string[]) => void
  setCurrentFile: (path: string | null) => void
  setWorkspaceError: (message: string | null) => void
}

export type WorkspaceStore = UseBoundStore<StoreApi<WorkspaceState>>

/** Human-readable tail for an error message, never an empty string. */
export function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return 'erreur inconnue'
}

function folderDisplayName(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] ?? path
}

/**
 * Message for root folders whose scan failed. They stay in the list on
 * purpose (see `init`), so the wording has to explain why they look empty
 * rather than implying they were dropped.
 */
function scanFailureMessage(paths: string[]): string {
  const names = paths.map(p => `« ${folderDisplayName(p)} »`).join(', ')
  const subject = paths.length > 1 ? `les dossiers ${names}` : `le dossier ${names}`
  return `Impossible de lire ${subject} : déplacé, supprimé, ou accès refusé. ${
    paths.length > 1 ? 'Ils restent' : 'Il reste'
  } dans la liste mais ${paths.length > 1 ? 'leur contenu' : 'son contenu'} n’est pas affiché.`
}

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
    workspaceError: null,
    fileMetaRevision: 0,
    bumpFileMetaRevision: () => set(state => ({ fileMetaRevision: state.fileMetaRevision + 1 })),
    init: async () => {
      let configuredPaths: string[]
      try {
        configuredPaths = (await loadWorkspaceConfig()).rootFolders
      } catch (error) {
        set({ workspaceError: `Impossible de lire la configuration des dossiers : ${describeError(error)}` })
        return
      }
      // `allSettled`, never `all`: one unreadable root folder must not take the
      // others down with it. A rejected `all` used to leave `rootFolders`
      // empty, and the next add/remove would then persist that empty list —
      // silently erasing every other configured folder from workspace.json.
      // A folder that fails to scan is KEPT here with an empty tree so its
      // path survives into the next `saveWorkspaceConfig` payload.
      const results = await Promise.allSettled(configuredPaths.map(path => scanFolder(path)))
      const failed: string[] = []
      const rootFolders = configuredPaths.map((path, index) => {
        const result = results[index]
        if (result.status === 'fulfilled') return { path, tree: result.value }
        failed.push(path)
        return { path, tree: [] }
      })
      // `state.currentFilePath` may already be set by the time this scan
      // resolves — the user opened a file while init was still in flight.
      // That choice wins; the session is only a fallback for a truly fresh
      // start, never something that overrides what's already on screen.
      const session = loadSessionState()
      set(state => ({
        rootFolders,
        workspaceError: failed.length > 0 ? scanFailureMessage(failed) : null,
        currentFilePath: state.currentFilePath ?? session.currentFilePath,
        expandedPaths: new Set([...state.expandedPaths, ...session.expandedPaths]),
      }))
    },
    addRootFolder: async path => {
      if (get().rootFolders.some(f => f.path === path)) return
      let tree: FileTreeNode[]
      try {
        tree = await scanFolder(path)
      } catch (error) {
        set({ workspaceError: `Impossible de lire le dossier « ${folderDisplayName(path)} » : ${describeError(error)}` })
        return
      }
      // Config first, state second: no optimistic tree update before the
      // operation is confirmed (spec, "Gestion d'erreurs").
      const rootFolders = [...get().rootFolders, { path, tree }]
      try {
        await saveWorkspaceConfig({ rootFolders: rootFolders.map(f => f.path) })
      } catch (error) {
        set({ workspaceError: `Impossible d’enregistrer la liste des dossiers : ${describeError(error)}` })
        return
      }
      set({ rootFolders, workspaceError: null })
    },
    removeRootFolder: async path => {
      const rootFolders = get().rootFolders.filter(f => f.path !== path)
      try {
        await saveWorkspaceConfig({ rootFolders: rootFolders.map(f => f.path) })
      } catch (error) {
        set({ workspaceError: `Impossible d’enregistrer la liste des dossiers : ${describeError(error)}` })
        return
      }
      set({ rootFolders, workspaceError: null })
    },
    refreshFolder: async folderPath => {
      let newChildren: FileTreeNode[]
      try {
        newChildren = await scanFolder(folderPath)
      } catch (error) {
        set({
          workspaceError: `Impossible de rafraîchir le dossier « ${folderDisplayName(folderPath)} » : ${describeError(error)}`,
        })
        return
      }
      set(state => ({
        workspaceError: null,
        rootFolders: state.rootFolders.map(f =>
          f.path === folderPath ? { ...f, tree: newChildren } : { ...f, tree: replaceChildren(f.tree, folderPath, newChildren) }
        ),
      }))
    },
    refreshAll: async () => {
      const current = get().rootFolders
      // Same allSettled contract as `init`: a folder that cannot be re-scanned
      // keeps the tree it already had rather than being emptied or dropped.
      const results = await Promise.allSettled(current.map(f => scanFolder(f.path)))
      const failed: string[] = []
      const rootFolders = current.map((folder, index) => {
        const result = results[index]
        if (result.status === 'fulfilled') return { path: folder.path, tree: result.value }
        failed.push(folder.path)
        return folder
      })
      set({ rootFolders, workspaceError: failed.length > 0 ? scanFailureMessage(failed) : null })
    },
    expandPaths: paths =>
      set(state => {
        const next = new Set(state.expandedPaths)
        for (const path of paths) next.add(path)
        saveSessionState({ currentFilePath: state.currentFilePath, expandedPaths: [...next] })
        return { expandedPaths: next }
      }),
    toggleExpanded: path =>
      set(state => {
        const next = new Set(state.expandedPaths)
        if (next.has(path)) next.delete(path)
        else next.add(path)
        saveSessionState({ currentFilePath: state.currentFilePath, expandedPaths: [...next] })
        return { expandedPaths: next }
      }),
    setCurrentFile: path =>
      set(state => {
        saveSessionState({ currentFilePath: path, expandedPaths: [...state.expandedPaths] })
        return { currentFilePath: path }
      }),
    setWorkspaceError: message => set({ workspaceError: message }),
  }))
}

export const useWorkspaceStore = createWorkspaceStore()
