// src/components/sidebar/FileTreeRow.tsx
import { useEffect, useRef, useState } from 'react'
import { Folder, FolderOpen, FolderInput, FileJson, File, ChevronRight, ChevronDown, Pencil, Trash2, X, Download, Copy, CloudUpload, CloudOff, Check, Tag } from 'lucide-react'
import type { FileTreeNode } from '../../types/workspace'
import type { Card } from '../../types/card'
import { useWorkspaceStore, describeError } from '../../state/useWorkspaceStore'
import { useTreeDragStore } from '../../state/useTreeDragStore'
import { renamePath, deletePath, duplicatePath, freeSiblingPath } from '../../persistence/fileOps'
import { countDescendants } from '../../persistence/fileTree'
import { parentDirOf, separatorOf, fileNameOf, mindMapBaseName, withMindMapExtension, isInsideFolder } from '../../persistence/paths'
import { loadMindMap, mindMapExists, setMindMapType } from '../../persistence/fileStore'
import { beginTreeDrag, consumeSwallowedClick, isValidDropTarget } from './treeDrag'
import { flattenFolders, isRowVisible, type FolderOption } from './treeFilter'
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
import { MAP_TYPES, MAP_TYPE_LABELS, type MapType } from '../../types/mapType'
import { MapTypeBadge } from './MapTypeBadge'

/**
 * The class list shared by every row: the base, then whichever state modifiers
 * apply. One function rather than a template string at each call site, so a row
 * can never end up half-styled — the drop highlight and the in-flight fade come
 * from the same place as the active / locked wash they replace.
 */
function rowClassName(modifiers: Array<string | false | undefined>): string {
  return ['file-tree-row', ...modifiers.filter(Boolean)].join(' ')
}

/**
 * « Déplacer vers… » — the drag & drop's keyboard and touch equivalent.
 *
 * The drag is the fast path, but it is only a pointer gesture: this menu is how
 * the same move stays reachable without one, and it is also what makes the
 * destinations discoverable on a long tree, where the folder you want may be
 * scrolled out of sight and therefore impossible to drag onto.
 */
function MoveToSubmenu({
  destinations,
  onSelect,
}: {
  destinations: FolderOption[]
  onSelect: (path: string) => void
}) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <FolderInput size={14} /> Déplacer vers…
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        {destinations.map(option => (
          <ContextMenuItem key={option.path} onSelect={() => onSelect(option.path)}>
            {/* Indentation, not a tree widget: the menu only has to say which
                folder is a subfolder of which. */}
            <span style={{ width: option.depth * 10, flexShrink: 0 }} />
            {option.name}
          </ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  )
}

interface FileTreeRowProps {
  node: FileTreeNode
  depth: number
  onOpenFile: (path: string) => void
  isRoot?: boolean
  onRemoveRoot?: (path: string) => void
  /** Whether files the app cannot open (`type: 'other'`) are shown at all. */
  showUnreadable?: boolean
  /**
   * Folders the search has opened by itself. A view, never persisted: the row
   * treats them as expanded without writing anything to `expandedPaths`, so
   * clearing the field restores the tree exactly as it was.
   */
  forcedExpanded?: ReadonlySet<string>
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
  forcedExpanded,
}: FileTreeRowProps) {
  const expandedPaths = useWorkspaceStore(s => s.expandedPaths)
  const currentFilePath = useWorkspaceStore(s => s.currentFilePath)
  const toggleExpanded = useWorkspaceStore(s => s.toggleExpanded)
  const refreshFolder = useWorkspaceStore(s => s.refreshFolder)
  const setCurrentFile = useWorkspaceStore(s => s.setCurrentFile)
  const setWorkspaceError = useWorkspaceStore(s => s.setWorkspaceError)
  const rootFolders = useWorkspaceStore(s => s.rootFolders)
  const moveNode = useWorkspaceStore(s => s.moveNode)
  // Two booleans, not the drag state itself: subscribing a row to the pointer
  // position would re-render the whole tree on every mouse move.
  const dragging = useTreeDragStore(s => s.source?.path === node.path)
  const isDropTarget = useTreeDragStore(s => s.targetPath === node.path)

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

  /**
   * Where « Déplacer vers… » may send this row. Exactly the destinations the
   * gesture itself accepts, from the same predicate: a menu option that would
   * be refused on drop is not offered at all.
   */
  const moveDestinations = flattenFolders(rootFolders).filter(option =>
    isValidDropTarget(
      { path: node.path, name: node.name, kind: node.type === 'folder' ? 'folder' : 'mindmap' },
      option.path
    )
  )

  /** Moves this row through the store, which owns every consequence of a move. */
  function moveTo(destFolderPath: string) {
    void moveNode(node.path, destFolderPath, node.type === 'folder')
  }

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
  async function classify(type: MapType) {
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
    const isExpanded = expandedPaths.has(node.path) || forcedExpanded?.has(node.path) === true
    return (
      // The whole branch is a drop zone, not just the header: `dropTargetAt`
      // walks up to it, so dropping on any file means « dans ce dossier ».
      <div data-drop-folder={node.path}>
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
                  className={rowClassName([
                    isDropTarget && 'file-tree-row--drop-target',
                    dragging && 'file-tree-row--dragging',
                  ])}
                  data-tree-row={node.path}
                  data-tree-kind="folder"
                  onPointerDown={event => {
                    // A configured root is workspace configuration, not content:
                    // it can receive a drop but never be dragged out of the list.
                    if (isRoot) return
                    beginTreeDrag(event, { path: node.path, name: node.name, kind: 'folder' })
                  }}
                  onClick={() => toggleExpanded(node.path)}
                  onDoubleClick={() => {
                    if (!isRoot) setRenaming(true)
                  }}
                  aria-expanded={isExpanded}
                  style={{ ...indent }}
                >
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  {isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />}
                  <span className="file-tree-row__name">{node.name}</span>
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
            {!isRoot && moveDestinations.length > 0 && (
              <MoveToSubmenu destinations={moveDestinations} onSelect={moveTo} />
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
            .filter(child => isRowVisible(child, showUnreadable))
            .map(child => (
              <FileTreeRow
                key={child.path}
                node={child}
                depth={depth + 1}
                onOpenFile={onOpenFile}
                showUnreadable={showUnreadable}
                forcedExpanded={forcedExpanded}
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
                  onClick={() => {
                    // The click that follows the pointerup ending a drag is not
                    // a request to open the map: the map just moved.
                    if (consumeSwallowedClick()) return
                    onOpenFile(node.path)
                  }}
                  onDoubleClick={() => setRenaming(true)}
                  title={displayName === node.name ? undefined : node.name}
                  className={rowClassName([
                    isLocked && 'file-tree-row--locked',
                    isActive && 'file-tree-row--active',
                    isDropTarget && 'file-tree-row--drop-target',
                    dragging && 'file-tree-row--dragging',
                  ])}
                  data-tree-row={node.path}
                  data-tree-kind="mindmap"
                  onPointerDown={event =>
                    beginTreeDrag(event, { path: node.path, name: displayName, kind: 'mindmap' })
                  }
                  style={{ ...indent }}
                >
                  {isLocked ? (
                    // The app's own mark rather than a padlock: the row keeps
                    // saying which FILE it is (the logo), and the orange says who
                    // may edit it. The accessible name and the tooltip are
                    // deliberately unchanged — they are what tells WHOSE file it
                    // is, and a screen reader has no colour to read.
                    <span
                      className="file-tree-row__logo"
                      role="img"
                      aria-label={`Fichier de ${meta?.author}, lecture seule`}
                      title={`Fichier de ${meta?.author}, lecture seule`}
                    />
                  ) : formatValid ? (
                    <img src="/favicon.svg" width={16} height={16} alt="" />
                  ) : (
                    <FileJson size={16} />
                  )}
                  <span className="file-tree-row__name">{displayName}</span>
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
            {moveDestinations.length > 0 && (
              <MoveToSubmenu destinations={moveDestinations} onSelect={moveTo} />
            )}
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
                  <ContextMenuItem onSelect={() => void classify('default')}>
                    {meta?.type === undefined || meta?.type === 'default' ? (
                      <Check size={14} />
                    ) : (
                      <span style={{ width: 14 }} />
                    )}
                    {MAP_TYPE_LABELS.default}
                  </ContextMenuItem>
                </ContextMenuSubContent>
              </ContextMenuSub>
            ) : (
              // Le `title` est porté par l’enveloppe, jamais par l’item : Radix
              // sort l’item désactivé du hit-testing (`data-disabled:pointer-events-none`),
              // donc un `title` posé dessus ne serait jamais montré.
              <div
                title={
                  classifyBlockedBecauseDraft
                    ? 'Publiez cette carte pour pouvoir la classer'
                    : 'Seul l’auteur ou un prof peut classer cette carte'
                }
              >
                <ContextMenuItem disabled aria-disabled>
                  <Tag size={14} /> Type
                </ContextMenuItem>
              </div>
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
