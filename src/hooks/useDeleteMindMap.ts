import { useCallback } from 'react'
import { deletePath } from '../persistence/fileOps'
import { loadMindMapMeta } from '../persistence/fileStore'
import { scanFolder } from '../persistence/fileTree'
import { isInsideFolder, isMindMapPath } from '../persistence/paths'
import { loadServerSyncState, saveSyncState, serverStateOf } from '../persistence/syncState'
import { flattenMindMapPaths } from '../sync/syncService'
import { canReorder } from '../sync/permissions'
import { useSyncStore } from '../state/useSyncStore'

/**
 * « Supprimer », partagé par `FileTreeRow` et `AppToolbar` — sur le modèle de
 * `usePublishMindMap.ts` — pour que poser une tombstone ne dépende pas de
 * quel bouton on a cliqué.
 *
 * Ce que `deletePath` seul ne fait pas : prévenir le serveur. Sans tombstone,
 * une suppression locale ne va nulle part — le prochain sync republierait
 * même la carte si son contenu était encore connu ailleurs. Voir
 * `2026-09-15-suppression-publication-auto-sync-ciblee-design.md`.
 *
 * Ce hook ne change PAS ce qui est supprimé sur le disque — un dossier reste
 * supprimé en entier, comme avant. Il ajoute seulement : pour chaque carte du
 * sous-arbre qu'on a le droit de faire disparaître du serveur (`meta` posé et
 * `canReorder`), une tombstone est posée AVANT que le disque ne bouge — si
 * l'écriture de l'état échoue, rien n'a encore été supprimé.
 */
export function useDeleteMindMap() {
  const deleteEntry = useCallback(
    async (path: string, isFolder: boolean): Promise<{ error?: unknown }> => {
      const { currentUser: user, syncFolderPath: folder, serverUrl: url } = useSyncStore.getState()
      const eligible = user !== null && folder !== null && isInsideFolder(path, folder)

      if (eligible) {
        const mapPaths = isFolder
          ? flattenMindMapPaths(await scanFolder(path))
          : isMindMapPath(path)
            ? [path]
            : []
        const fileIds: string[] = []
        for (const mapPath of mapPaths) {
          const meta = await loadMindMapMeta(mapPath).catch(() => null)
          if (meta !== null && canReorder(meta, user)) fileIds.push(meta.id)
        }
        if (fileIds.length > 0) {
          try {
            const state = await loadServerSyncState(url, folder)
            const server = serverStateOf(state, url, folder)
            server.tombstones = [...new Set([...server.tombstones, ...fileIds])]
            await saveSyncState(state)
          } catch (error) {
            // L'état n'a pas pu être écrit : le disque n'a pas bougé, la
            // suppression n'a pas eu lieu, l'appelant le dit.
            return { error }
          }
        }
      }

      try {
        await deletePath(path, isFolder)
      } catch (error) {
        return { error }
      }
      return {}
    },
    // Volontairement vide : `deleteEntry` relit `useSyncStore.getState()` à
    // l'instant de l'appel, comme `usePublishMindMap.stampOne` — un handler
    // gardé en ref peut survivre bien après le rendu qui l'a créé.
    []
  )

  return { deleteEntry }
}
