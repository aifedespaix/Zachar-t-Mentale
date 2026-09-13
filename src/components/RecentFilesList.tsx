// src/components/RecentFilesList.tsx
import { useState } from 'react'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { FileJson, FolderSearch, ClipboardCopy, Download, Pencil, X } from 'lucide-react'
import { fileNameOf, mindMapBaseName, parentDirOf, separatorOf, mindMapExtensionSuffix } from '../persistence/paths'
import { renamePath } from '../persistence/fileOps'
import { loadMindMap } from '../persistence/fileStore'
import { validateCards } from '../validation/cardsValidation'
import type { Card } from '../types/card'
import { formatRelativeTime } from '../utils/relativeTime'
import type { RecentFile } from '../persistence/sessionState'
import { useMindMapAuthor } from '../hooks/useMindMapAuthor'
import { useWorkspaceStore, describeError } from '../state/useWorkspaceStore'
import { MapTypeBadge } from './sidebar/MapTypeBadge'
import { TooltipProvider } from './ui/tooltip'
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from './ui/context-menu'
import { MoveToSubmenu } from './sidebar/FileTreeRow'
import { flattenFolders } from './sidebar/treeFilter'
import { isValidDropTarget } from './sidebar/treeDrag'
import { ExportDialog } from './sidebar/ExportDialog'
import { NameDialog } from './sidebar/NameDialog'

interface RecentFilesListProps {
  /** Newest first, already filtered down to files that still exist. */
  files: RecentFile[]
  onOpen: (path: string) => void
}

/**
 * Reopen shortcuts for the empty-state screen. The parent folder name rides
 * along under each title so two mind maps sharing a name in different
 * folders — a common shape for course material split into chapters — stay
 * tellable apart without showing the full path.
 */
export function RecentFilesList({ files, onOpen }: RecentFilesListProps) {
  if (files.length === 0) return null

  return (
    // Own provider: this list lives in the main area, outside the one
    // `FileSidebar` mounts for its own tree's badges — without it, Radix
    // throws the moment a row's `MapTypeBadge` renders a `Tooltip`.
    <TooltipProvider>
      <div className="recent-files">
        <div className="recent-files__title">Cartes ouvertes récemment</div>
        <ul className="recent-files__list">
          {files.map(file => (
            <RecentFileRow key={file.path} file={file} onOpen={onOpen} />
          ))}
        </ul>
      </div>
    </TooltipProvider>
  )
}

function RecentFileRow({ file, onOpen }: { file: RecentFile; onOpen: (path: string) => void }) {
  // Same badge as the sidebar's tree row, and the same source for it: the
  // map's own `meta.type` header, read straight off disk.
  const meta = useMindMapAuthor(file.path)
  const setWorkspaceError = useWorkspaceStore(s => s.setWorkspaceError)
  const removeRecentFile = useWorkspaceStore(s => s.removeRecentFile)
  const renameRecentFile = useWorkspaceStore(s => s.renameRecentFile)
  const rootFolders = useWorkspaceStore(s => s.rootFolders)
  const moveNode = useWorkspaceStore(s => s.moveNode)
  const refreshFolder = useWorkspaceStore(s => s.refreshFolder)

  const [renaming, setRenaming] = useState(false)
  const [exportCards, setExportCards] = useState<Card[] | null>(null)

  /**
   * Where « Déplacer vers… » may send this row — same predicate the tree's
   * own drag & drop and context menu use, so a destination refused there is
   * never offered here either.
   */
  const moveDestinations = flattenFolders(rootFolders).filter(option =>
    isValidDropTarget({ path: file.path, name: fileNameOf(file.path), kind: 'mindmap' }, option.path)
  )

  function moveTo(destFolderPath: string) {
    void moveNode(file.path, destFolderPath, false)
  }

  function revealInExplorer() {
    void revealItemInDir(file.path).catch(error =>
      setWorkspaceError(`Impossible d’ouvrir l’explorateur : ${describeError(error)}`)
    )
  }

  function copyPath() {
    // Best-effort, like the canvas's own « Copier le texte » — the system
    // clipboard needs a secure context and a user gesture, and a rejected
    // write must not take the click down with it.
    void navigator.clipboard?.writeText(file.path).catch(() => {})
  }

  async function openExport() {
    let raw: Card[] | null
    try {
      raw = await loadMindMap(file.path)
    } catch (error) {
      setWorkspaceError(`Impossible d’exporter « ${mindMapBaseName(file.path)} » : ${describeError(error)}`)
      return
    }
    if (raw === null) {
      setWorkspaceError(`Impossible d’exporter « ${mindMapBaseName(file.path)} » : ce fichier n’existe plus.`)
      return
    }
    if (!validateCards(raw).valid) {
      setWorkspaceError(`Impossible d’exporter « ${mindMapBaseName(file.path)} » : la structure du fichier est invalide.`)
      return
    }
    setExportCards(raw)
  }

  /**
   * Same NameDialog-based flow the toolbar's own « Renommer » uses for the
   * currently open file — this row, like that one, has no adjacent editable
   * name to swap for an inline input the way a tree row does.
   */
  async function submitRename(baseName: string) {
    setRenaming(false)
    const parentPath = parentDirOf(file.path)
    const separator = separatorOf(file.path)
    const newName = `${baseName}${mindMapExtensionSuffix(file.path)}`
    const newPath = `${parentPath}${separator}${newName}`
    if (newPath === file.path) return
    try {
      await renamePath(file.path, newPath)
    } catch (error) {
      setWorkspaceError(`Impossible de renommer « ${mindMapBaseName(file.path)} » en « ${newName} » : ${describeError(error)}`)
      return
    }
    renameRecentFile(file.path, newPath)
    await refreshFolder(parentPath)
  }

  return (
    <li>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button type="button" className="recent-files__row" onClick={() => onOpen(file.path)}>
            <FileJson size={16} className="recent-files__icon" aria-hidden="true" />
            <span className="recent-files__text">
              <span className="recent-files__name">{mindMapBaseName(file.path)}</span>
              <span className="recent-files__folder">{fileNameOf(parentDirOf(file.path))}</span>
            </span>
            <MapTypeBadge type={meta?.type} />
            <span className="recent-files__time">{formatRelativeTime(file.openedAt)}</span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {moveDestinations.length > 0 && <MoveToSubmenu destinations={moveDestinations} onSelect={moveTo} />}
          <ContextMenuItem onSelect={revealInExplorer}>
            <FolderSearch size={14} /> Afficher dans l’explorateur
          </ContextMenuItem>
          <ContextMenuItem onSelect={copyPath}>
            <ClipboardCopy size={14} /> Copier le chemin
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void openExport()}>
            <Download size={14} /> Exporter
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => setRenaming(true)}>
            <Pencil size={14} /> Renommer
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => removeRecentFile(file.path)}>
            <X size={14} /> Retirer de la liste récente
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {renaming && (
        <NameDialog
          title={`Renommer « ${mindMapBaseName(file.path)} »`}
          initialName={mindMapBaseName(file.path)}
          confirmLabel="Renommer"
          onConfirm={submitRename}
          onCancel={() => setRenaming(false)}
        />
      )}

      {exportCards && (
        <ExportDialog
          fileName={fileNameOf(file.path)}
          filePath={file.path}
          cards={exportCards}
          open
          onClose={() => setExportCards(null)}
          onError={setWorkspaceError}
        />
      )}
    </li>
  )
}
