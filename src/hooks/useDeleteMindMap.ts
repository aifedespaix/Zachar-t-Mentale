import { useCallback } from 'react'
import type { FileTreeNode } from '../types/workspace'
import type { MindMapMeta } from '../types/card'
import { loadMindMapMeta } from '../persistence/fileStore'
import { deletePath } from '../persistence/fileOps'
import { fileNameOf, isInsideFolder } from '../persistence/paths'
import { canReorder } from '../sync/permissions'
import { loadServerSyncState, saveSyncState, serverStateOf } from '../persistence/syncState'
import { useSyncStore } from '../state/useSyncStore'

/** Un fichier que la confirmation s'apprête à supprimer du disque. */
export interface PlannedDeleteFile {
  path: string
  kind: 'mindmap' | 'other'
  /** Le \`file_id\` à tombstoner, quand le fichier porte une méta. */
  fileId?: string
}

/**
 * Le plan d'une suppression locale, calculé sur le sous-arbre AVANT de toucher
 * au disque : ce qui part, ce qui reste, et ce qu'il faudra pousser.
 *
 * Le plan est la seule source de vérité de la suppression : l'interface
 * l'affiche, puis l'applique. Calculer les compteurs d'un côté et supprimer de
 * l'autre serait deux définitions de « ce que je possède ».
 */
export interface DeletePlan {
  targetPath: string
  isFolder: boolean
  /** Fichiers supprimables, dans l'ordre de parcours. */
  files: PlannedDeleteFile[]
  /** Cartes qu'on garde parce qu'on n'en est pas l'auteur (lecture seule). */
  keptCards: { path: string; name: string }[]
  /** Dossiers ABSOLUS du sous-arbre, du plus profond au plus haut. */
  folders: string[]
  /** Chemins RELATIFS des dossiers à tombstoner — prof uniquement. */
  folderTombstones: string[]
  /** Chemins relatifs des enregistrements du prof qui resteront (élève). */
  remainingFolders: string[]
}

export interface DeleteOutcome {
  deletedFiles: number
  /** Les suppressions locales qui ont échoué (fichier verrouillé). Aucune tombstone pour elles. */
  failed: { path: string; error: unknown }[]
}

/** Séparateurs normalisés, chemin relatif rendu en forme canonique (barres obliques). */
function relativeToFolder(root: string, path: string): string | null {
  const normalize = (value: string) => value.replace(/[\\/]+/g, '/').replace(/\/+$/, '')
  const canonicalRoot = normalize(root)
  const canonicalPath = normalize(path)
  if (canonicalPath === canonicalRoot) return ''
  if (!canonicalPath.startsWith(canonicalRoot + '/')) return null
  return canonicalPath.slice(canonicalRoot.length + 1)
}

function walkSubtree(
  node: FileTreeNode,
  files: FileTreeNode[],
  folders: string[]
): void {
  if (node.type === 'folder') {
    folders.push(node.path)
    for (const child of node.children) walkSubtree(child, files, folders)
  } else {
    files.push(node)
  }
}

/**
 * La suppression locale partagée par l'arborescence et la barre d'outils.
 *
 * Une suppression n'écrit RIEN sur le réseau : elle pose des intentions
 * (tombstones) que la synchronisation suivante applique. On ne supprime que ce
 * qu'on a le droit de supprimer — un dossier mitoyen garde les cartes du prof —
 * et l'on n'appelle plus \`deletePath(dossier, true)\`, qui garantissait la
 * suppression aveugle de ce qu'il contenait.
 *
 * Les entrées de synchronisation sont CONSERVÉES : la passe des tombstones en a
 * besoin pour comparer l'empreinte distante. On n'ajoute que les tombstones.
 */
export function useDeleteMindMap() {
  const planDelete = useCallback(async (node: FileTreeNode): Promise<DeletePlan> => {
    const { currentUser, syncFolderPath, serverUrl } = useSyncStore.getState()
    const fileNodes: FileTreeNode[] = []
    const folders: string[] = []
    walkSubtree(node, fileNodes, folders)
    // Du plus profond au plus haut : un dossier ne se retire qu'une fois vide.
    folders.reverse()

    let knownFolders = new Set<string>()
    if (syncFolderPath !== null && serverUrl !== '') {
      const state = await loadServerSyncState(serverUrl, syncFolderPath)
      knownFolders = new Set(serverStateOf(state, serverUrl, syncFolderPath).knownFolders)
    }

    const files: PlannedDeleteFile[] = []
    const keptCards: { path: string; name: string }[] = []
    for (const file of fileNodes) {
      if (file.type !== 'mindmap') {
        // Un fichier non-carte est purement local : il part sans discussion.
        files.push({ path: file.path, kind: 'other' })
        continue
      }
      let meta: MindMapMeta | null
      try {
        meta = await loadMindMapMeta(file.path)
      } catch {
        meta = null
      }
      // Une carte jamais publiée appartient à personne ; une carte publiée
      // n'est supprimable que par son auteur ou un prof.
      const deletable = meta === null || (currentUser !== null && canReorder(meta, currentUser))
      if (deletable) {
        files.push({ path: file.path, kind: 'mindmap', ...(meta === null ? {} : { fileId: meta.id }) })
      } else {
        keptCards.push({ path: file.path, name: fileNameOf(file.path) })
      }
    }

    const folderTombstones: string[] = []
    const remainingFolders: string[] = []
    // Les dossiers qu'on a le DROIT de retirer du disque une fois vidés. Un
    // dossier du prof n'en fait pas partie pour un élève : il reste, même vide.
    const removableFolders: string[] = []
    const insideSyncFolder = syncFolderPath !== null && isInsideFolder(node.path, syncFolderPath)
    if (!insideSyncFolder) {
      // Hors du dossier synchronisé : l'arbre est purement local.
      removableFolders.push(...folders)
    } else if (currentUser !== null && currentUser.role === 'prof') {
      removableFolders.push(...folders)
      for (const folder of folders) {
        const relative = relativeToFolder(syncFolderPath, folder)
        if (relative !== null && relative !== '') folderTombstones.push(relative)
      }
    } else {
      for (const folder of folders) {
        const relative = relativeToFolder(syncFolderPath, folder)
        // Un dossier dont le chemin est un enregistrement du prof n'est pas
        // supprimable par un élève : ni tombstone, ni retrait du disque.
        if (relative !== null && relative !== '' && knownFolders.has(relative)) {
          remainingFolders.push(relative)
          continue
        }
        removableFolders.push(folder)
      }
    }

    return {
      targetPath: node.path,
      isFolder: node.type === 'folder',
      files,
      keptCards,
      folders: removableFolders,
      folderTombstones,
      remainingFolders,
    }
  }, [])

  const applyDelete = useCallback(async (plan: DeletePlan): Promise<DeleteOutcome> => {
    const failed: { path: string; error: unknown }[] = []
    const tombstonedIds = plan.files.flatMap(file => (file.fileId === undefined ? [] : [file.fileId]))

    // Les tombstones D'ABORD, puis le disque : c'est l'ordre que la spec de
    // production impose, pour qu'un échec de l'écriture de l'état laisse le
    // disque intact plutôt que l'inverse. Une carte tombstonée dont le fichier
    // survit (suppression localement refusée) verra sa tombstone annulée par la
    // passe 3, qui constate que le fichier porte encore cet identifiant.
    const { syncFolderPath, serverUrl } = useSyncStore.getState()
    if (syncFolderPath !== null && serverUrl !== '' && (tombstonedIds.length > 0 || plan.folderTombstones.length > 0)) {
      try {
        const state = await loadServerSyncState(serverUrl, syncFolderPath)
        const server = serverStateOf(state, serverUrl, syncFolderPath)
        for (const id of tombstonedIds) {
          if (!server.tombstones.includes(id)) server.tombstones.push(id)
        }
        for (const path of plan.folderTombstones) {
          if (!server.folderTombstones.includes(path)) server.folderTombstones.push(path)
        }
        await saveSyncState(state)
      } catch (error) {
        // L'état n'a pas pu être écrit : le disque n'a pas bougé, la suppression
        // n'a pas eu lieu, l'appelant le dit.
        return { deletedFiles: 0, failed: [{ path: plan.targetPath, error }] }
      }
    }

    let deletedFiles = 0
    for (const file of plan.files) {
      try {
        await deletePath(file.path, false)
        deletedFiles += 1
      } catch (error) {
        failed.push({ path: file.path, error })
      }
    }

    // Remonter les dossiers devenus vides. Un dossier qui garde une carte du
    // prof n'est pas vide : la suppression échoue et il reste en place.
    if (plan.isFolder) {
      for (const folder of plan.folders) {
        try {
          await deletePath(folder, false)
        } catch {
          // Non vide ou verrouillé : rien à signaler, le dialogue a annoncé ce
          // qui resterait.
        }
      }
    }

    return { deletedFiles, failed }
  }, [])

  return { planDelete, applyDelete }
}
