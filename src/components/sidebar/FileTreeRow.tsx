// src/components/sidebar/FileTreeRow.tsx
import { useEffect, useRef, useState } from 'react'
import { Folder, FolderOpen, FileJson, File, ChevronRight, ChevronDown, Pencil, Trash2, X, Download, Copy, Lock, CloudUpload, CloudOff, Check, Tag } from 'lucide-react'
import type { FileTreeNode } from '../../types/workspace'
import type { Card } from '../../types/card'
import { useWorkspaceStore, describeError } from '../../state/useWorkspaceStore'
import { renamePath, deletePath, duplicatePath, freeSiblingPath } from '../../persistence/fileOps'
import { countDescendants } from '../../persistence/fileTree'
import { parentDirOf, separatorOf, fileNameOf, mindMapBaseName, withMindMapExtension, isInsideFolder } from '../../persistence/paths'
import { loadMindMap, mindMapExists, setMindMapType } from '../../persistence/fileStore'
import { isAssetsSidecarName } from '../../persistence/assets'
import { validateCards } from '../../validation/cardsValidation'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Button } from '../ui/button'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from '../ui/context-menu'
import { ExportDialog } from './ExportDialog'
import { NameDialog } from './NameDialog'
import { useFolderCreation } from './useFolderCreation'
import { useMindMapFormatValid } from '../../hooks/useMindMapFormatValid'
import { useMindMapAuthor } from '../../hooks/useMindMapAuthor'
import { usePublishMindMap } from '../../hooks/usePublishMindMap'
import { useSyncStore } from '../../state/useSyncStore'
import { canClassify } from '../../sync/permissions'
import { MAP_TYPES, MAP_TYPE_LABELS } from '../../types/mapType'
import { MapTypeBadge } from './MapTypeBadge'

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
  // Le classement est le geste d'un compte sur une carte qui a déjà une
  // identité de synchronisation : `canClassify` en est la SEULE définition,
  // partagée avec la synchronisation.
  const classifyAllowed = currentUser !== null && canClassify(meta, currentUser)
  const classifyBlockedBecauseDraft = meta === null
  const syncFolderPath = useSyncStore(s => s.syncFolderPath)
  /**
   * Une carte publiée mais sortie du dossier de synchronisation : elle a un
   * enregistrement distant, et plus rien ne la poussera. Le badge est le seul
   * endroit qui l'explique — sinon le fichier disparaît du compteur sans un mot.
   */
  const outOfSyncFolder = meta !== null && syncFolderPath !== null && !isInsideFolder(node.path, syncFolderPath)
  const { canPublish, publish } = usePublishMindMap()
  // Offered only where the action means something (see the hook): a local map,
  // inside the sync folder, with an account to stamp it with. An already-synced
  // file has nothing to publish, and a locked one is entered through
  // « Personnaliser » on the canvas.
  const publishable = canPublish(node.path, meta)
  // The creation trio (« Nouvelle carte mentale », « Nouveau sous-dossier »,
  // « Importer XMind ») is shared with the file sidebar's own empty-area menu,
  // which targets the first root folder.
  const { menuItems: folderCreationItems, dialog: folderCreationDialog } = useFolderCreation(node.path, onOpenFile)

  const indent = { paddingLeft: 8 + depth * 16 }

  /**
   * What the row shows for a mind map. The extension is only worth a row's
   * width while unopenable files are listed: there it is what tells
   * « chapitre.zmap » from « notes.pdf ». With those hidden, every remaining
   * file is a mind map the app can open, so « .zmap » / « .json » on every line
   * is noise — and on a deep tree it is noise that pushes the actual names out
   * of view. The real file name stays reachable (the rename field's label, and
   * the row's `title`), and it is what the rename and delete dialogs say.
   */
  const displayName = node.type === 'mindmap' && !showUnreadable ? mindMapBaseName(node.name) : node.name

  /**
   * How much of the file name a rename pre-selects: the name the user gave the
   * map, never its extension.
   *
   * Opening a rename field with the name already selected is what makes typing
   * replace it; a selection that ALSO covered « .zmap » would take the extension
   * with the first keystroke, and a rename would silently change the file's
   * type. The extension is the app's business, not the user's.
   */
  const renameSelectionLength =
    node.type === 'mindmap' ? mindMapBaseName(node.name).length : node.name.length

  const renameInputRef = useRef<HTMLInputElement>(null)

  // Applied in an effect rather than at mount: the field has to exist and be
  // focused before a selection range sticks, and `autoFocus` only focuses it
  // during the commit — this runs right after that.
  useEffect(() => {
    if (!renaming) return
    renameInputRef.current?.setSelectionRange(0, renameSelectionLength)
  }, [renaming, renameSelectionLength])

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

  /**
   * Classe la carte. Le rafraîchissement est exactement celui de la
   * publication : la nouvelle métadonnée est écrite dans le fichier, donc
   * l'arbre (badge, auteur) et le compteur de synchronisation doivent la
   * relire au même instant.
   */
  async function classify(type: (typeof MAP_TYPES)[number]) {
    try {
      await setMindMapType(node.path, type)
      useWorkspaceStore.getState().bumpFileMetaRevision()
      await refreshFolder(parentDirOf(node.path))
      await useSyncStore.getState().refreshPendingCount()
    } catch (error) {
      setWorkspaceError('Impossible de classer « ' + node.name + ' » : ' + describeError(error))
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
                  ref={renameInputRef}
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
            {folderCreationItems}
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

        {/* The creation trio owns its own dialog: it is shared with the file
            sidebar's empty-area menu, so it cannot reuse `namingAction`. */}
        {folderCreationDialog}

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
                  ref={renameInputRef}
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
                  title={displayName === node.name ? undefined : node.name}
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
                    // The `<title>` child is the badge's tooltip: Lucide's own props
                    // type has no `title`, and an SVG one is what a browser renders
                    // on hover. The aria-label stays, since it is what names the
                    // badge for assistive tech (and for the tests).
                    <Lock size={16} aria-label={`Fichier de ${meta?.author}, lecture seule`}>
                      <title>{`Fichier de ${meta?.author}, lecture seule`}</title>
                    </Lock>
                  ) : formatValid ? (
                    <img src="/favicon.svg" width={16} height={16} alt="" />
                  ) : (
                    <FileJson size={16} />
                  )}
                  <span>{displayName}</span>
                  <MapTypeBadge type={meta?.type} />
                  {outOfSyncFolder && (
                    <CloudOff size={13} aria-label="Hors du dossier de synchronisation" style={{ opacity: 0.7, flexShrink: 0 }}>
                      <title>Hors du dossier de synchronisation : cette carte ne sera plus envoyée.</title>
                    </CloudOff>
                  )}
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
            {publishable && (
              <>
                <ContextMenuItem onSelect={() => void publish(node.path)}>
                  <CloudUpload size={14} /> Publier pour la synchronisation
                </ContextMenuItem>
                <ContextMenuSeparator />
              </>
            )}
            <ContextMenuItem onSelect={openDuplicateDialog}>
              <Copy size={14} /> Dupliquer
            </ContextMenuItem>
            <ContextMenuItem onSelect={openExport}>
              <Download size={14} /> Exporter
            </ContextMenuItem>
            {classifyAllowed ? (
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <Tag size={14} /> Type
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  {MAP_TYPES.map(type => (
                    <ContextMenuItem key={type} onSelect={() => void classify(type)}>
                      {meta?.type === type ? <Check size={14} /> : <span style={{ width: 14 }} />}
                      {MAP_TYPE_LABELS[type]}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            ) : (
              <ContextMenuItem
                disabled
                title={
                  classifyBlockedBecauseDraft
                    ? 'Publiez cette carte pour pouvoir la classer'
                    : 'Seul l’auteur ou un prof peut classer cette carte'
                }
              >
                <Tag size={14} /> Type
              </ContextMenuItem>
            )}
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
