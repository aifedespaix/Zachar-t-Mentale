// src/components/sidebar/FileTreeRow.tsx
import { useRef, useState } from 'react'
import { Folder, FolderOpen, FolderPlus, FileJson, FilePlus, File, ChevronRight, ChevronDown, Pencil, Trash2, X, Download, FileUp, Copy, Lock } from 'lucide-react'
import type { FileTreeNode } from '../../types/workspace'
import type { Card } from '../../types/card'
import { useWorkspaceStore, describeError } from '../../state/useWorkspaceStore'
import {
  createMindMapFile,
  createSubfolder,
  renamePath,
  deletePath,
  duplicatePath,
  freeMindMapPath,
  freeSiblingPath,
} from '../../persistence/fileOps'
import { countDescendants } from '../../persistence/fileTree'
import { parentDirOf, separatorOf, fileNameOf, mindMapBaseName, withMindMapExtension } from '../../persistence/paths'
import { loadMindMap, saveMindMap, mindMapExists } from '../../persistence/fileStore'
import { pickXmindFile, readBinaryFile } from '../../persistence/exportIO'
import { readXmindFile } from '../../xmind/importXmind'
import { isAssetsSidecarName } from '../../persistence/assets'
import { validateCards } from '../../validation/cardsValidation'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Button } from '../ui/button'
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '../ui/context-menu'
import { ExportDialog } from './ExportDialog'
import { NameDialog } from './NameDialog'
import { useMindMapFormatValid } from '../../hooks/useMindMapFormatValid'
import { useMindMapAuthor } from '../../hooks/useMindMapAuthor'
import { useSyncStore } from '../../state/useSyncStore'

interface FileTreeRowProps {
  node: FileTreeNode
  depth: number
  onOpenFile: (path: string) => void
  isRoot?: boolean
  onRemoveRoot?: (path: string) => void
  /** Whether files the app cannot open (`type: 'other'`) are shown at all. */
  showUnreadable?: boolean
}

interface NamingAction {
  title: string
  initialName: string
  confirmLabel: string
  onConfirm: (name: string) => void
  inputLabel?: string
}

function ConfirmDeleteDialog({
  title,
  onCancel,
  onConfirm,
}: {
  title: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Annuler
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Confirmer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function FileTreeRow({
  node,
  depth,
  onOpenFile,
  isRoot = false,
  onRemoveRoot,
  showUnreadable = false,
}: FileTreeRowProps) {
  const expandedPaths = useWorkspaceStore(s => s.expandedPaths)
  const currentFilePath = useWorkspaceStore(s => s.currentFilePath)
  const toggleExpanded = useWorkspaceStore(s => s.toggleExpanded)
  const refreshFolder = useWorkspaceStore(s => s.refreshFolder)
  const setCurrentFile = useWorkspaceStore(s => s.setCurrentFile)
  const setWorkspaceError = useWorkspaceStore(s => s.setWorkspaceError)

  const [renaming, setRenaming] = useState(false)
  const [draftRenameName, setDraftRenameName] = useState(node.name)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [exportCards, setExportCards] = useState<Card[] | null>(null)
  const [namingAction, setNamingAction] = useState<NamingAction | null>(null)
  // Set right before the deferred `setRenaming(true)` below, and consumed by
  // this row's `onCloseAutoFocus` handlers so the close-focus-restore
  // suppression they need for the rename race doesn't also apply to every
  // other menu close (Escape, another item, clicking outside).
  const renamingViaMenuRef = useRef(false)

  const formatValid = useMindMapFormatValid(node.type === 'mindmap' ? node.path : null)
  const currentUser = useSyncStore(s => s.currentUser)
  const meta = useMindMapAuthor(node.type === 'mindmap' ? node.path : null)
  const isLocked = meta !== null && meta.author !== currentUser?.username

  const indent = { paddingLeft: 8 + depth * 16 }

  /**
   * Entering rename mode from a menu item, not a double-click, needs a tick
   * of delay: Radix's context menu still owns focus (via its roving focus
   * group) at the moment `onSelect` fires, and closing the menu synchronously
   * afterward steals focus right back from the just-mounted, `autoFocus`ed
   * rename `<input>` — firing its `onBlur` (which submits/cancels the
   * rename) before the user ever sees it. Deferring past that lets the menu
   * finish closing first. In tests, this relies on `@testing-library/user-event`'s
   * handling of pending timers to observe the rename input after the deferred call.
   */
  function startRenaming() {
    renamingViaMenuRef.current = true
    setTimeout(() => setRenaming(true), 0)
  }

  async function submitRename() {
    const name = draftRenameName.trim()
    setRenaming(false)
    if (!name || name === node.name) return
    const parentPath = parentDirOf(node.path)
    const separator = separatorOf(node.path)
    const newPath = `${parentPath}${separator}${name}`
    try {
      await renamePath(node.path, newPath)
    } catch (error) {
      setWorkspaceError(`Impossible de renommer « ${node.name} » en « ${name} » : ${describeError(error)}`)
      return
    }
    // Same containment check `confirmDelete` uses: renaming a FOLDER moves
    // every file under it too, so the open file's path has to follow.
    if (node.path === currentFilePath) setCurrentFile(newPath)
    else if (currentFilePath?.startsWith(node.path + separator)) {
      setCurrentFile(newPath + currentFilePath.slice(node.path.length))
    }
    await refreshFolder(parentPath)
  }

  async function confirmDelete() {
    setConfirmDeleteOpen(false)
    const parentPath = parentDirOf(node.path)
    const separator = separatorOf(node.path)
    try {
      await deletePath(node.path, node.type === 'folder')
    } catch (error) {
      setWorkspaceError(`Impossible de supprimer « ${node.name} » : ${describeError(error)}`)
      return
    }
    if (currentFilePath === node.path || currentFilePath?.startsWith(node.path + separator)) setCurrentFile(null)
    await refreshFolder(parentPath)
  }

  async function handleImportXmind() {
    let path: string | null = null
    let sheetsWritten = 0
    try {
      path = await pickXmindFile()
      if (!path) return
      const bytes = await readBinaryFile(path)
      const sheets = await readXmindFile(bytes)
      for (const sheet of sheets) {
        const target = await freeMindMapPath(node.path, sheet.sheetTitle)
        await saveMindMap(target, sheet.cards)
        sheetsWritten += 1
      }
      await refreshFolder(node.path)
    } catch (error) {
      if (sheetsWritten > 0) await refreshFolder(node.path)
      const partial = sheetsWritten > 0 ? ` (${sheetsWritten} carte(s) mentale(s) déjà importée(s) avant l’échec)` : ''
      setWorkspaceError(`Impossible d’importer « ${path ? fileNameOf(path) : 'le fichier XMind'} » : ${describeError(error)}${partial}`)
    }
  }

  async function openExport() {
    let raw: Card[] | null
    try {
      raw = await loadMindMap(node.path)
    } catch (error) {
      setWorkspaceError(`Impossible d’exporter « ${node.name} » : ${describeError(error)}`)
      return
    }
    if (raw === null) {
      setWorkspaceError(`Impossible d’exporter « ${node.name} » : ce fichier n’existe plus.`)
      return
    }
    if (!validateCards(raw).valid) {
      setWorkspaceError(`Impossible d’exporter « ${node.name} » : la structure du fichier est invalide.`)
      return
    }
    setExportCards(raw)
  }

  async function openCreateMindMapDialog() {
    const fullPath = await freeSiblingPath(node.path, 'Nouvelle carte mentale', false)
    const name = mindMapBaseName(fileNameOf(fullPath))
    setNamingAction({
      title: 'Nouvelle carte mentale',
      initialName: name,
      confirmLabel: 'Créer',
      onConfirm: submitCreateMindMap,
      inputLabel: 'Nom de la nouvelle carte mentale',
    })
  }

  async function submitCreateMindMap(name: string) {
    setNamingAction(null)
    const destPath = `${node.path}${separatorOf(node.path)}${withMindMapExtension(name)}`
    if (await mindMapExists(destPath)) {
      setWorkspaceError(
        `Impossible de créer la carte mentale « ${name} » : un fichier « ${withMindMapExtension(name)} » existe déjà.`
      )
      return
    }
    try {
      const path = await createMindMapFile(node.path, name)
      await refreshFolder(node.path)
      onOpenFile(path)
    } catch (error) {
      setWorkspaceError(`Impossible de créer la carte mentale « ${name} » : ${describeError(error)}`)
    }
  }

  async function openCreateFolderDialog() {
    const fullPath = await freeSiblingPath(node.path, 'Nouveau dossier', true)
    const name = fileNameOf(fullPath)
    setNamingAction({
      title: 'Nouveau sous-dossier',
      initialName: name,
      confirmLabel: 'Créer',
      onConfirm: submitCreateFolder,
      inputLabel: 'Nom du nouveau dossier',
    })
  }

  async function submitCreateFolder(name: string) {
    setNamingAction(null)
    try {
      await createSubfolder(node.path, name)
      await refreshFolder(node.path)
    } catch (error) {
      setWorkspaceError(`Impossible de créer le dossier « ${name} » : ${describeError(error)}`)
    }
  }

  async function openDuplicateDialog() {
    const parentPath = parentDirOf(node.path)
    const isFolder = node.type === 'folder'
    const currentBaseName = isFolder ? node.name : mindMapBaseName(node.name)
    const fullPath = await freeSiblingPath(parentPath, `${currentBaseName} (copie)`, isFolder)
    setNamingAction({
      title: `Dupliquer « ${node.name} »`,
      initialName: isFolder ? fileNameOf(fullPath) : mindMapBaseName(fileNameOf(fullPath)),
      confirmLabel: 'Dupliquer',
      onConfirm: submitDuplicate,
    })
  }

  async function submitDuplicate(name: string) {
    setNamingAction(null)
    const parentPath = parentDirOf(node.path)
    const separator = separatorOf(node.path)
    const isFolder = node.type === 'folder'
    const destPath = `${parentPath}${separator}${isFolder ? name : withMindMapExtension(name)}`
    if (!isFolder && (await mindMapExists(destPath))) {
      setWorkspaceError(
        `Impossible de dupliquer « ${node.name} » : un fichier « ${withMindMapExtension(name)} » existe déjà.`
      )
      return
    }
    try {
      await duplicatePath(node.path, destPath, isFolder)
      await refreshFolder(parentPath)
      if (!isFolder) onOpenFile(destPath)
    } catch (error) {
      setWorkspaceError(`Impossible de dupliquer « ${node.name} » : ${describeError(error)}`)
    }
  }

  if (node.type === 'folder') {
    const isExpanded = expandedPaths.has(node.path)
    return (
      <div>
        <ContextMenu>
          <ContextMenuTrigger asChild disabled={renaming}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {renaming ? (
                <input
                  autoFocus
                  aria-label={`Renommer ${node.name}`}
                  value={draftRenameName}
                  onChange={e => setDraftRenameName(e.target.value)}
                  onBlur={submitRename}
                  onKeyDown={e => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') {
                      setDraftRenameName(node.name)
                      setRenaming(false)
                    }
                  }}
                  style={{ ...indent, display: 'block', flex: 1 }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => toggleExpanded(node.path)}
                  onDoubleClick={() => {
                    if (!isRoot) setRenaming(true)
                  }}
                  aria-expanded={isExpanded}
                  style={{
                    ...indent,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    flex: 1,
                    background: 'transparent',
                    border: 'none',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  {isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />}
                  <span>{node.name}</span>
                </button>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent
            onCloseAutoFocus={e => {
              if (renamingViaMenuRef.current) {
                e.preventDefault()
                renamingViaMenuRef.current = false
              }
            }}
          >
            <ContextMenuItem onSelect={openCreateMindMapDialog}>
              <FilePlus size={14} /> Nouvelle carte mentale
            </ContextMenuItem>
            <ContextMenuItem onSelect={openCreateFolderDialog}>
              <FolderPlus size={14} /> Nouveau sous-dossier
            </ContextMenuItem>
            <ContextMenuItem onSelect={handleImportXmind}>
              <FileUp size={14} /> Importer XMind
            </ContextMenuItem>
            {!isRoot && (
              <ContextMenuItem onSelect={openDuplicateDialog}>
                <Copy size={14} /> Dupliquer
              </ContextMenuItem>
            )}
            {!isRoot && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={startRenaming}>
                  <Pencil size={14} /> Renommer
                </ContextMenuItem>
                <ContextMenuItem variant="destructive" onSelect={() => setConfirmDeleteOpen(true)}>
                  <Trash2 size={14} /> Supprimer
                </ContextMenuItem>
              </>
            )}
            {isRoot && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => onRemoveRoot?.(node.path)}>
                  <X size={14} /> Retirer {node.name} de la liste
                </ContextMenuItem>
              </>
            )}
          </ContextMenuContent>
        </ContextMenu>

        {confirmDeleteOpen && (
          <ConfirmDeleteDialog
            title={`Supprimer le dossier « ${node.name} » et son contenu (${countDescendants(node)} éléments) ?`}
            onCancel={() => setConfirmDeleteOpen(false)}
            onConfirm={confirmDelete}
          />
        )}

        {namingAction && (
          <NameDialog
            title={namingAction.title}
            initialName={namingAction.initialName}
            confirmLabel={namingAction.confirmLabel}
            onConfirm={namingAction.onConfirm}
            onCancel={() => setNamingAction(null)}
            inputLabel={namingAction.inputLabel}
          />
        )}

        {isExpanded &&
          node.children
            .filter(child => (isAssetsSidecarName(child.name) ? showUnreadable : showUnreadable || child.type !== 'other'))
            .map(child => (
              <FileTreeRow
                key={child.path}
                node={child}
                depth={depth + 1}
                onOpenFile={onOpenFile}
                showUnreadable={showUnreadable}
              />
            ))}
      </div>
    )
  }

  if (node.type === 'mindmap') {
    const isActive = node.path === currentFilePath
    return (
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <ContextMenu>
          <ContextMenuTrigger asChild disabled={renaming}>
            <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
              {renaming ? (
                <input
                  autoFocus
                  aria-label={`Renommer ${node.name}`}
                  value={draftRenameName}
                  onChange={e => setDraftRenameName(e.target.value)}
                  onBlur={submitRename}
                  onKeyDown={e => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') {
                      setDraftRenameName(node.name)
                      setRenaming(false)
                    }
                  }}
                  style={{ ...indent, display: 'block', flex: 1 }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onOpenFile(node.path)}
                  onDoubleClick={() => setRenaming(true)}
                  style={{
                    ...indent,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    flex: 1,
                    background: isLocked
                      ? 'color-mix(in oklch, var(--primary), transparent 92%)'
                      : isActive
                        ? 'var(--muted)'
                        : 'transparent',
                    border: 'none',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  {isLocked ? (
                    <Lock size={16} aria-label={`Fichier de ${meta?.author}, lecture seule`} />
                  ) : formatValid ? (
                    <img src="/favicon.svg" width={16} height={16} alt="" />
                  ) : (
                    <FileJson size={16} />
                  )}
                  <span>{node.name}</span>
                </button>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent
            onCloseAutoFocus={e => {
              if (renamingViaMenuRef.current) {
                e.preventDefault()
                renamingViaMenuRef.current = false
              }
            }}
          >
            <ContextMenuItem onSelect={openDuplicateDialog}>
              <Copy size={14} /> Dupliquer
            </ContextMenuItem>
            <ContextMenuItem onSelect={openExport}>
              <Download size={14} /> Exporter
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={startRenaming}>
              <Pencil size={14} /> Renommer
            </ContextMenuItem>
            <ContextMenuItem variant="destructive" onSelect={() => setConfirmDeleteOpen(true)}>
              <Trash2 size={14} /> Supprimer
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        {confirmDeleteOpen && (
          <ConfirmDeleteDialog
            title={`Supprimer le fichier « ${node.name} » ?`}
            onCancel={() => setConfirmDeleteOpen(false)}
            onConfirm={confirmDelete}
          />
        )}

        {namingAction && (
          <NameDialog
            title={namingAction.title}
            initialName={namingAction.initialName}
            confirmLabel={namingAction.confirmLabel}
            onConfirm={namingAction.onConfirm}
            onCancel={() => setNamingAction(null)}
            inputLabel={namingAction.inputLabel}
          />
        )}

        {exportCards && (
          <ExportDialog
            fileName={node.name}
            filePath={node.path}
            cards={exportCards}
            open
            onClose={() => setExportCards(null)}
            onError={setWorkspaceError}
          />
        )}
      </div>
    )
  }

  return (
    <div aria-disabled style={{ ...indent, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted-foreground)' }}>
      <File size={16} />
      <span>{node.name}</span>
    </div>
  )
}
