// src/components/sidebar/FileTreeRow.tsx
import { useState } from 'react'
import {
  Folder,
  FolderOpen,
  FolderPlus,
  FileJson,
  FilePlus,
  File,
  ChevronRight,
  ChevronDown,
  Pencil,
  Trash2,
  X,
  Download,
  FileUp,
  type LucideIcon,
} from 'lucide-react'
import type { FileTreeNode } from '../../types/workspace'
import type { Card } from '../../types/card'
import { useWorkspaceStore, describeError } from '../../state/useWorkspaceStore'
import { createMindMapFile, createSubfolder, renamePath, deletePath, freeMindMapPath } from '../../persistence/fileOps'
import { countDescendants } from '../../persistence/fileTree'
import { parentDirOf, separatorOf, fileNameOf } from '../../persistence/paths'
import { loadMindMap, saveMindMap } from '../../persistence/fileStore'
import { pickXmindFile, readBinaryFile } from '../../persistence/exportIO'
import { readXmindFile } from '../../xmind/importXmind'
import { validateCards } from '../../validation/cardsValidation'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { ExportDialog } from './ExportDialog'

interface FileTreeRowProps {
  node: FileTreeNode
  depth: number
  onOpenFile: (path: string) => void
  isRoot?: boolean
  onRemoveRoot?: (path: string) => void
}

function ActionButton({ label, icon: Icon, onClick }: { label: string; icon: LucideIcon; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick}>
          <Icon size={14} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
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

export function FileTreeRow({ node, depth, onOpenFile, isRoot = false, onRemoveRoot }: FileTreeRowProps) {
  const expandedPaths = useWorkspaceStore(s => s.expandedPaths)
  const currentFilePath = useWorkspaceStore(s => s.currentFilePath)
  const toggleExpanded = useWorkspaceStore(s => s.toggleExpanded)
  const refreshFolder = useWorkspaceStore(s => s.refreshFolder)
  const setCurrentFile = useWorkspaceStore(s => s.setCurrentFile)
  const setWorkspaceError = useWorkspaceStore(s => s.setWorkspaceError)

  const [creatingKind, setCreatingKind] = useState<'mindmap' | 'folder' | null>(null)
  const [draftCreateName, setDraftCreateName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [draftRenameName, setDraftRenameName] = useState(node.name)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [exportCards, setExportCards] = useState<Card[] | null>(null)

  const indent = { paddingLeft: 8 + depth * 16 }

  async function submitCreate() {
    const name = draftCreateName.trim()
    const kind = creatingKind
    setCreatingKind(null)
    if (!name) return
    try {
      if (kind === 'mindmap') {
        const path = await createMindMapFile(node.path, name)
        await refreshFolder(node.path)
        onOpenFile(path)
      } else if (kind === 'folder') {
        await createSubfolder(node.path, name)
        await refreshFolder(node.path)
      }
    } catch (error) {
      // A read-only folder, an illegal filename, a name already taken: the
      // tree would otherwise just not change, with nothing to explain why.
      const what = kind === 'mindmap' ? 'la carte mentale' : 'le dossier'
      setWorkspaceError(`Impossible de créer ${what} « ${name} » : ${describeError(error)}`)
      return
    }
    setDraftCreateName('')
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
    // every file under it too, so the open file's path has to follow. Handling
    // only the exact match left `currentFilePath` pointing into a directory
    // that no longer exists — autosave stayed armed and wrote to nowhere, and
    // the active-file highlight vanished from the tree with no explanation.
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
      // Refresh BEFORE reporting the error: a successful refreshFolder resets
      // workspaceError to null as part of its own state update, which would
      // otherwise immediately clobber the message we're about to set below.
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

  if (node.type === 'folder') {
    const isExpanded = expandedPaths.has(node.path)
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => toggleExpanded(node.path)}
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
          <TooltipProvider>
            <ActionButton
              label="Nouvelle carte mentale"
              icon={FilePlus}
              onClick={() => {
                setCreatingKind('mindmap')
                setDraftCreateName('')
              }}
            />
            <ActionButton
              label="Nouveau sous-dossier"
              icon={FolderPlus}
              onClick={() => {
                setCreatingKind('folder')
                setDraftCreateName('')
              }}
            />
            <ActionButton label="Importer XMind" icon={FileUp} onClick={handleImportXmind} />
            {!isRoot && <ActionButton label="Renommer" icon={Pencil} onClick={() => setRenaming(true)} />}
            {!isRoot && <ActionButton label="Supprimer" icon={Trash2} onClick={() => setConfirmDeleteOpen(true)} />}
            {isRoot && (
              <ActionButton
                label={`Retirer ${node.name} de la liste`}
                icon={X}
                onClick={() => onRemoveRoot?.(node.path)}
              />
            )}
          </TooltipProvider>
        </div>

        {renaming && (
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
            style={{ ...indent, display: 'block', width: '100%' }}
          />
        )}

        {creatingKind && (
          <input
            autoFocus
            aria-label={creatingKind === 'mindmap' ? 'Nom de la nouvelle carte mentale' : 'Nom du nouveau dossier'}
            value={draftCreateName}
            onChange={e => setDraftCreateName(e.target.value)}
            onBlur={submitCreate}
            onKeyDown={e => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setCreatingKind(null)
            }}
            style={{ paddingLeft: 8 + (depth + 1) * 16, display: 'block', width: '100%' }}
          />
        )}

        {confirmDeleteOpen && (
          <ConfirmDeleteDialog
            title={`Supprimer le dossier « ${node.name} » et son contenu (${countDescendants(node)} éléments) ?`}
            onCancel={() => setConfirmDeleteOpen(false)}
            onConfirm={confirmDelete}
          />
        )}

        {isExpanded &&
          node.children.map(child => <FileTreeRow key={child.path} node={child} depth={depth + 1} onOpenFile={onOpenFile} />)}
      </div>
    )
  }

  if (node.type === 'mindmap') {
    const isActive = node.path === currentFilePath
    return (
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
            onClick={() => onOpenFile(node.path)}
            style={{
              ...indent,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flex: 1,
              background: isActive ? 'var(--muted)' : 'transparent',
              border: 'none',
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            <FileJson size={16} />
            <span>{node.name}</span>
          </button>
        )}
        <TooltipProvider>
          <ActionButton label="Renommer" icon={Pencil} onClick={() => setRenaming(true)} />
          <ActionButton label="Exporter" icon={Download} onClick={openExport} />
          <ActionButton label="Supprimer" icon={Trash2} onClick={() => setConfirmDeleteOpen(true)} />
        </TooltipProvider>

        {confirmDeleteOpen && (
          <ConfirmDeleteDialog
            title={`Supprimer le fichier « ${node.name} » ?`}
            onCancel={() => setConfirmDeleteOpen(false)}
            onConfirm={confirmDelete}
          />
        )}

        {exportCards && (
          <ExportDialog
            fileName={node.name}
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
