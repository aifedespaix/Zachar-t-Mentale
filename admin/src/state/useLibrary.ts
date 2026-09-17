import { create } from 'zustand'
import {
  MIND_MAPS,
  applyRelocation,
  applyRemoval,
  createFolder,
  createMap,
  fetchConflicts,
  fetchEvents,
  fetchFolders,
  fetchMaps,
  planRelocation,
  planRemoval,
  resolveConflict,
  updateMapType,
  type RemoteConflict,
  type RemoteSyncEvent,
} from '@/lib/api'
import { describeApiError } from '@/lib/pb'
import { buildTree, type LibraryFolder, type LibraryMap, type TreeNode } from '@/lib/tree'
import type { Card, UserRole } from '@app/types/card'

/**
 * Tout ce que l'écran affiche, en un seul endroit.
 *
 * Les erreurs sont stockées PAR SECTION plutôt que globalement, et c'est
 * volontaire : les collections de l'espace professeur sont facultatives, donc
 * un serveur pas encore migré répond 404 sur les conflits et le journal tout en
 * servant parfaitement l'arborescence. Une erreur globale ferait passer cette
 * installation pour cassée alors que sa fonction principale marche.
 */

interface LibraryState {
  maps: LibraryMap[]
  folders: LibraryFolder[]
  conflicts: RemoteConflict[]
  events: RemoteSyncEvent[]

  tree: TreeNode[]

  loadingLibrary: boolean
  loadingConflicts: boolean
  loadingEvents: boolean

  libraryError: string | null
  conflictsError: string | null
  eventsError: string | null

  /** Une opération en cours qui touche plusieurs enregistrements, pour l'afficher honnêtement. */
  busy: { label: string; done: number; total: number } | null

  refreshLibrary: () => Promise<void>
  refreshConflicts: () => Promise<void>
  refreshEvents: () => Promise<void>
  refreshAll: () => Promise<void>

  addFolder: (path: string, createdBy: string) => Promise<void>
  relocate: (fromPath: string, toPath: string, label: string) => Promise<void>
  remove: (path: string) => Promise<void>
  addMap: (params: { path: string; cards: readonly Card[]; author: string; role: UserRole; type: string }) => Promise<void>
  setMapType: (id: string, type: string) => Promise<void>
  /** Supprime des cartes par identifiant — l'arbitrage d'un doublon. */
  removeMaps: (ids: readonly string[]) => Promise<void>
  settleConflict: (
    conflict: RemoteConflict,
    resolution: 'kept-remote' | 'took-local' | 'dismissed',
    by: string
  ) => Promise<void>
}

export const useLibrary = create<LibraryState>((set, get) => ({
  maps: [],
  folders: [],
  conflicts: [],
  events: [],
  tree: [],
  loadingLibrary: false,
  loadingConflicts: false,
  loadingEvents: false,
  libraryError: null,
  conflictsError: null,
  eventsError: null,
  busy: null,

  refreshLibrary: async () => {
    set({ loadingLibrary: true, libraryError: null })
    try {
      // Les deux lectures sont indépendantes : les enchaîner doublerait
      // l'attente sur une connexion lente pour rien.
      const [maps, folders] = await Promise.all([fetchMaps(), fetchFolders().catch(() => [])])
      set({ maps, folders, tree: buildTree(maps, folders), loadingLibrary: false })
    } catch (error) {
      set({ libraryError: describeApiError(error, 'Lecture de la bibliothèque'), loadingLibrary: false })
    }
  },

  refreshConflicts: async () => {
    set({ loadingConflicts: true, conflictsError: null })
    try {
      set({ conflicts: await fetchConflicts(), loadingConflicts: false })
    } catch (error) {
      set({ conflictsError: describeApiError(error, 'Lecture des conflits'), loadingConflicts: false })
    }
  },

  refreshEvents: async () => {
    set({ loadingEvents: true, eventsError: null })
    try {
      set({ events: await fetchEvents(), loadingEvents: false })
    } catch (error) {
      set({ eventsError: describeApiError(error, 'Lecture du journal'), loadingEvents: false })
    }
  },

  refreshAll: async () => {
    await Promise.all([get().refreshLibrary(), get().refreshConflicts(), get().refreshEvents()])
  },

  addFolder: async (path, createdBy) => {
    await createFolder(path, createdBy)
    await get().refreshLibrary()
  },

  relocate: async (fromPath, toPath, label) => {
    const { maps, folders } = get()
    const plan = planRelocation(maps, folders, fromPath, toPath)
    if (plan.length === 0) return
    set({ busy: { label, done: 0, total: plan.length } })
    try {
      await applyRelocation(plan, (done, total) => set({ busy: { label, done, total } }))
    } finally {
      // Rafraîchir MÊME en cas d'échec : une opération interrompue à mi-chemin
      // a bel et bien déplacé une partie des fichiers, et laisser l'écran
      // afficher l'état d'avant serait le seul vrai mensonge possible ici.
      set({ busy: null })
      await get().refreshLibrary()
    }
  },

  remove: async path => {
    const { maps, folders } = get()
    const plan = planRemoval(maps, folders, path)
    if (plan.length === 0) return
    set({ busy: { label: 'Suppression', done: 0, total: plan.length } })
    try {
      await applyRemoval(plan, (done, total) => set({ busy: { label: 'Suppression', done, total } }))
    } finally {
      set({ busy: null })
      await get().refreshLibrary()
    }
  },

  addMap: async params => {
    await createMap(params)
    await get().refreshLibrary()
  },

  setMapType: async (id, type) => {
    await updateMapType(id, type)
    await get().refreshLibrary()
  },

  removeMaps: async ids => {
    if (ids.length === 0) return
    set({ busy: { label: 'Suppression', done: 0, total: ids.length } })
    try {
      await applyRemoval(
        ids.map(id => ({ collection: MIND_MAPS, id })),
        (done, total) => set({ busy: { label: 'Suppression', done, total } })
      )
    } finally {
      // Même en cas d'échec à mi-parcours, une partie des fichiers a bel et
      // bien disparu : rafraîchir est la seule réponse honnête.
      set({ busy: null })
      await get().refreshLibrary()
    }
  },

  settleConflict: async (conflict, resolution, by) => {
    await resolveConflict(conflict, resolution, by)
    await Promise.all([get().refreshConflicts(), get().refreshLibrary()])
  },
}))

/** Combien de conflits attendent une décision — le chiffre du badge de navigation. */
export function openConflictCount(conflicts: readonly RemoteConflict[]): number {
  return conflicts.filter(entry => entry.status === 'open').length
}
