import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { CloudSync, Eye, EyeOff, FolderPlus, PanelLeftClose, PanelLeftOpen, RefreshCw, X } from 'lucide-react'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { ContextMenu, ContextMenuTrigger, ContextMenuContent } from '../ui/context-menu'
import { CommandButton } from '../commands/CommandButton'
import { useWorkspaceStore, describeError } from '../../state/useWorkspaceStore'
import { useSyncStore } from '../../state/useSyncStore'
import { syncResultLabel } from '../../sync/syncResultLabel'
import { formatRelativeTime } from '../../utils/relativeTime'
import { FileTreeRow } from './FileTreeRow'
import {
  clampSidebarWidth,
  loadSidebarWidth,
  saveSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
} from '../../persistence/sidebarWidth'
import { loadShowUnreadableFiles, saveShowUnreadableFiles } from '../../persistence/showUnreadableFiles'
import { createSubfolder, freeSiblingPath } from '../../persistence/fileOps'
import { fileNameOf, parentDirOf } from '../../persistence/paths'
import { NameDialog } from './NameDialog'
import { useFolderCreation } from './useFolderCreation'
import { useCommand } from '../../hooks/useCommand'
import type { FileTreeNode } from '../../types/workspace'

/** How far one arrow-key press moves the border, for a keyboard resize. */
const KEYBOARD_RESIZE_STEP = 16

function folderDisplayName(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] ?? path
}

/**
 * One icon in the sidebar's action bar, for the actions that are NOT commands.
 *
 * `CommandButton` covers everything the app catalogues; this is its counterpart
 * for the toggle that only exists here (« fichiers non lisibles ») — same
 * tooltip contract (the label, plus a one-line hint), without a command id the
 * catalogue would then have to grow.
 */
function SidebarIconButton({
  label,
  hint,
  active = false,
  onClick,
  children,
}: {
  label: string
  hint?: string
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={active ? 'secondary' : 'ghost'}
          size="icon-sm"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {hint && <span style={{ opacity: 0.7, marginLeft: 8 }}>{hint}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

interface FileSidebarProps {
  onOpenFile: (path: string) => void
}

export function FileSidebar({ onOpenFile }: FileSidebarProps) {
  const rootFolders = useWorkspaceStore(s => s.rootFolders)
  const init = useWorkspaceStore(s => s.init)
  const addRootFolder = useWorkspaceStore(s => s.addRootFolder)
  const removeRootFolder = useWorkspaceStore(s => s.removeRootFolder)
  const refreshAll = useWorkspaceStore(s => s.refreshAll)
  const workspaceError = useWorkspaceStore(s => s.workspaceError)
  const refreshFolder = useWorkspaceStore(s => s.refreshFolder)
  const expandPaths = useWorkspaceStore(s => s.expandPaths)
  const setWorkspaceError = useWorkspaceStore(s => s.setWorkspaceError)
  const syncStatus = useSyncStore(s => s.status)
  const syncError = useSyncStore(s => s.error)
  const lastResult = useSyncStore(s => s.lastResult)
  const syncNow = useSyncStore(s => s.syncNow)
  const syncProgress = useSyncStore(s => s.progress)
  const cancelSync = useSyncStore(s => s.cancelSync)
  const pendingCount = useSyncStore(s => s.pendingCount)
  const localOnlyCount = useSyncStore(s => s.localOnlyCount)
  const lastSuccessAt = useSyncStore(s => s.lastSuccessAt)
  const refreshPendingCount = useSyncStore(s => s.refreshPendingCount)
  // The username, not the object: a fresh `{username, role}` on every auth tick
  // would make the effect below walk the sync folder for nothing.
  const syncUserName = useSyncStore(s => s.currentUser?.username ?? null)
  const syncFolderPath = useSyncStore(s => s.syncFolderPath)
  const [collapsed, setCollapsed] = useState(false)
  /** The folder « Nouveau dossier » is about to create in — `null` when the dialog is closed. */
  const [newFolderParent, setNewFolderParent] = useState<string | null>(null)
  // Same reason as the width below: read synchronously so the tree doesn't
  // flash unreadable files for a frame before hiding them again.
  const [showUnreadable, setShowUnreadable] = useState(loadShowUnreadableFiles)
  // Read synchronously on the first render — an effect would paint the
  // default width for a frame and then visibly snap to the saved one.
  const [width, setWidth] = useState(loadSidebarWidth)
  const [resizing, setResizing] = useState(false)
  /**
   * Hides the sync feedback the user has already read. Local state, not a store
   * field: the settings panel shows the same result as its own record of the
   * run, and closing the sidebar's copy must not blank it there.
   */
  const [syncFeedbackDismissed, setSyncFeedbackDismissed] = useState(false)
  const handleRef = useRef<HTMLDivElement>(null)

  // Right-clicking the sidebar's own empty space (the header, the gap under the
  // tree, the footer bar) targets the FIRST configured folder: it is the one
  // the user is implicitly working in, and it is the only folder a menu with no
  // row under the cursor can name. Folder rows keep their own menu, richer
  // because they know which folder they are.
  const firstRoot = rootFolders[0]
  const folderCreation = useFolderCreation(firstRoot?.path ?? '', onOpenFile)

  // A new failure, or a new result, is news again — the dismissal only ever
  // covers the run it was clicked on.
  useEffect(() => {
    setSyncFeedbackDismissed(false)
  }, [syncError, lastResult])

  useEffect(() => {
    // Recompute the « à envoyer » count on the events that can change it: the
    // account, the folder, a re-scanned tree, a finished sync. The walk reads
    // one header per .zmap, so it is deliberately NOT run on every render —
    // publishing refreshes it itself, from the hook that changed the file.
    void refreshPendingCount()
  }, [refreshPendingCount, syncFolderPath, syncUserName, rootFolders, lastResult])

  // Writing on every pointer move would hammer `localStorage` a hundred times
  // per drag for a value only the NEXT launch reads, so the width is persisted
  // once the gesture ends. Keyboard resizes go through the same helper.
  const commitWidth = useCallback((next: number) => {
    const clamped = clampSidebarWidth(next)
    setWidth(clamped)
    saveSidebarWidth(clamped)
  }, [])

  function handleResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    // Pointer capture, not window listeners: the border keeps receiving moves
    // even when the cursor outruns it (a fast drag), and the browser cancels
    // the capture for us if the window loses focus mid-gesture.
    event.preventDefault()
    // Called optionally: jsdom — and any engine without the Pointer Events
    // capture API — has no such method, and the drag works without it (only
    // the "cursor outruns the border" case degrades).
    handleRef.current?.setPointerCapture?.(event.pointerId)
    setResizing(true)
  }

  function handleResizeMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!resizing) return
    // Measured from the sidebar's own left edge rather than from the pointer's
    // delta, so the width can never drift away from the cursor over a long
    // drag (or after a clamp at either bound).
    const left = handleRef.current?.parentElement?.getBoundingClientRect().left ?? 0
    setWidth(clampSidebarWidth(event.clientX - left))
  }

  function handleResizeEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (!resizing) return
    handleRef.current?.releasePointerCapture?.(event.pointerId)
    setResizing(false)
    saveSidebarWidth(width)
  }

  function handleResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      commitWidth(width - KEYBOARD_RESIZE_STEP)
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      commitWidth(width + KEYBOARD_RESIZE_STEP)
    }
  }

  useEffect(() => {
    // The store already reports its own failures; this catch covers anything
    // unexpected so a rejected init can never end as an unhandled rejection
    // with nothing on screen.
    init().catch(error => setWorkspaceError(`Impossible de charger la liste des dossiers : ${describeError(error)}`))
  }, [init, setWorkspaceError])

  async function handleAddFolder() {
    try {
      const selected = await open({ directory: true })
      if (typeof selected === 'string') await addRootFolder(selected)
    } catch (error) {
      setWorkspaceError(`Impossible d’ajouter le dossier : ${describeError(error)}`)
    }
  }

  async function handleRefreshAll() {
    try {
      await refreshAll()
    } catch (error) {
      setWorkspaceError(`Impossible de rafraîchir les dossiers : ${describeError(error)}`)
    }
  }

  /**
   * The sync button, and nothing more.
   *
   * Following what a run relocated — re-pointing `currentFilePath`, refreshing
   * the tree — belongs to `App`, which already owns the open path and the
   * pending autosave, and which is the one place all THREE sync triggers reach
   * (this button, the background timer, the settings panel). Doing it here left
   * an automatic run recreating the old file through the debounced autosave.
   * `syncNow` reports its own failures through the store's `error`, shown in the
   * banner above the buttons, so a dead network is a banner rather than a crash.
   */
  function handleSync() {
    void syncNow()
  }

  function handleToggleShowUnreadable() {
    const next = !showUnreadable
    setShowUnreadable(next)
    saveShowUnreadableFiles(next)
  }

  function handleRemoveRoot(path: string) {
    removeRootFolder(path).catch(error =>
      setWorkspaceError(`Impossible de retirer le dossier : ${describeError(error)}`)
    )
  }

  /**
   * Where « Nouveau dossier » creates, when it is invoked from the keyboard
   * rather than from a folder's own right-click menu: beside the map you have
   * open, or failing that in the first configured root.
   *
   * A folder row knows its own path; a shortcut does not, and asking « dans
   * quel dossier ? » for the commonest case — a sibling of what you are
   * working on — would be a dialog spent on a question with an obvious answer.
   */
  function defaultFolderTarget(): string | null {
    const openFile = useWorkspaceStore.getState().currentFilePath
    const beside = openFile === null ? '' : parentDirOf(openFile)
    if (beside !== '') return beside
    return rootFolders[0]?.path ?? null
  }

  async function submitNewFolder(name: string) {
    const parent = newFolderParent
    setNewFolderParent(null)
    if (parent === null) return
    try {
      const path = await freeSiblingPath(parent, name, true)
      await createSubfolder(parent, fileNameOf(path))
      await refreshFolder(parent)
      // So a folder created several levels down is actually visible, rather
      // than added to a branch that happens to be collapsed.
      expandPaths([parent])
    } catch (error) {
      setWorkspaceError(`Impossible de créer le dossier : ${describeError(error)}`)
    }
  }

  // Registered before the collapsed early-return below, so folding the sidebar
  // away does not take « Ctrl + B » — the very shortcut that unfolds it — with it.
  useCommand(
    'view.toggleSidebar',
    () => setCollapsed(current => !current),
    true,
    collapsed ? 'Afficher l’arborescence' : 'Masquer l’arborescence'
  )
  useCommand('file.addRootFolder', () => void handleAddFolder())
  useCommand('file.refresh', () => void handleRefreshAll())
  useCommand(
    'file.newFolder',
    () => setNewFolderParent(defaultFolderTarget()),
    rootFolders.length > 0
  )
  // Also registered before the early return: the sync button only exists in the
  // unfolded bar, but the shortcut and the command palette should still reach it
  // while the tree is folded away.
  useCommand(
    'sync.now',
    () => void handleSync(),
    syncStatus !== 'syncing',
    syncStatus === 'syncing' ? 'Synchronisation…' : undefined
  )

  const newFolderDialog = newFolderParent !== null && (
    <NameDialog
      title="Nouveau dossier"
      inputLabel="Nom du dossier"
      initialName="Nouveau dossier"
      confirmLabel="Créer"
      onCancel={() => setNewFolderParent(null)}
      onConfirm={name => void submitNewFolder(name)}
    />
  )

  if (collapsed) {
    return (
      <TooltipProvider>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              style={{
                width: 32,
                borderRight: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'center',
                // Bottom-aligned on purpose: folding and unfolding happen in the
                // same corner of the screen, so the control does not appear to jump
                // across the window between the two states.
                alignItems: 'flex-end',
                paddingBottom: 8,
              }}
            >
              <CommandButton
                command="view.toggleSidebar"
                icon={PanelLeftOpen}
                label="Déplier la barre latérale"
                variant="ghost"
                size="icon-sm"
              />
            </div>
          </ContextMenuTrigger>
          {firstRoot !== undefined && (
            <ContextMenuContent>{folderCreation.menuItems}</ContextMenuContent>
          )}
        </ContextMenu>
        {newFolderDialog}
        {folderCreation.dialog}
      </TooltipProvider>
    )
  }

  const syncRunning = syncStatus === 'syncing'
  // While a run is in flight, the running banner IS the message: showing last
  // run's result beside it would describe a state that no longer holds.
  const showSyncError = syncError !== null && !syncFeedbackDismissed && !syncRunning
  const showSyncResult =
    syncError === null && lastResult !== null && !syncFeedbackDismissed && !syncRunning
  // The per-file failures are far too long to list in a 240 px column; they stay
  // readable in the tooltip, and in full in Réglages → Synchronisation.
  // Both lists are far too long for a 240 px column, and both are detailed in
  // Réglages → Synchronisation: the tooltip is the summary's memory aid.
  const syncResultDetail =
    showSyncResult && (lastResult.conflicts.length > 0 || lastResult.errors.length > 0)
      ? [
          ...lastResult.conflicts.map(
            conflict => `conflit : ${conflict.path} (ici ${conflict.localModified}, serveur ${conflict.remoteUpdated})`
          ),
          ...lastResult.errors.map(error => `${error.fileId} : ${error.message}`),
        ].join('\n')
      : undefined

  /**
   * What the sync button's tooltip adds to its name: the two facts the footer
   * would otherwise make the user click to discover. Each part is dropped when
   * it cannot be known, and the count is also on the badge, for the glance that
   * does not hover anything.
   */
  // « à publier » comes first and matters most: those maps need a gesture, and
  // without them a folder full of chapters happily reports « rien à envoyer ».
  const localOnlyDetail =
    localOnlyCount === null || localOnlyCount === 0
      ? null
      : `${localOnlyCount} carte${localOnlyCount > 1 ? 's' : ''} à publier`
  const pendingDetail =
    pendingCount === null
      ? null
      : pendingCount === 0
        ? 'rien à envoyer'
        : `${pendingCount} carte${pendingCount > 1 ? 's' : ''} à envoyer`
  const lastSyncDetail =
    lastSuccessAt === null
      ? syncUserName === null
        ? null
        : 'jamais synchronisé'
      : `dernière synchro ${formatRelativeTime(lastSuccessAt) ?? 'inconnue'}`
  const syncTooltipDetail =
    syncRunning || (localOnlyDetail === null && pendingDetail === null && lastSyncDetail === null)
      ? undefined
      : [localOnlyDetail, pendingDetail, lastSyncDetail].filter(part => part !== null).join(' · ')

  return (
    <TooltipProvider>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            style={{
              // `flexShrink: 0` so the canvas beside it, not the sidebar, gives way
              // when the window gets narrow — otherwise a drag to 500px would be
              // silently undone by the flex layout the moment the window shrank.
              width,
              flexShrink: 0,
              borderRight: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
            }}
          >
            {/*
              The header is the title and nothing else. Every action lives in the
              footer bar below, so the tree starts right under the heading that
              names it and the buttons sit where the file rows end — one bar, one
              place to look, instead of a header cluster and a footer one.
            */}
            <div style={{ padding: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Cartes mentales</span>
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {rootFolders.length === 0 && (
                <p style={{ padding: 8, fontSize: 13, color: 'var(--muted-foreground)' }}>Aucun dossier configuré.</p>
              )}
              {rootFolders.map(root => {
                const rootNode: FileTreeNode = {
                  type: 'folder',
                  name: folderDisplayName(root.path),
                  path: root.path,
                  children: root.tree,
                }
                return (
                  <FileTreeRow
                    key={root.path}
                    node={rootNode}
                    depth={0}
                    onOpenFile={onOpenFile}
                    isRoot
                    onRemoveRoot={handleRemoveRoot}
                    showUnreadable={showUnreadable}
                  />
                )
              })}
            </div>

            {/*
              Messages sit immediately above the bar that produced them — a failed
              sync is explained next to the button that was clicked, not at the far
              end of the panel from it.
            */}
            {(workspaceError !== null || syncRunning || showSyncError || showSyncResult) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 8px 6px', flexShrink: 0 }}>
                {syncRunning && (
                  <div role="status" className="status-banner status-banner--info" style={{ margin: 0 }}>
                    <span style={{ flex: 1 }}>
                      {syncProgress === null
                        ? 'Synchronisation…'
                        : `Synchronisation ${syncProgress.done}/${syncProgress.total}…`}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Annuler la synchronisation"
                      onClick={cancelSync}
                    >
                      <X size={14} />
                    </Button>
                  </div>
                )}
                {workspaceError && (
                  <div role="alert" className="status-banner" style={{ margin: 0 }}>
                    <span style={{ flex: 1 }}>{workspaceError}</span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Masquer le message d’erreur"
                      onClick={() => setWorkspaceError(null)}
                    >
                      <X size={14} />
                    </Button>
                  </div>
                )}
                {showSyncError && (
                  <div role="alert" className="status-banner" style={{ margin: 0 }}>
                    <span style={{ flex: 1 }}>{syncError}</span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Masquer le message de synchronisation"
                      onClick={() => setSyncFeedbackDismissed(true)}
                    >
                      <X size={14} />
                    </Button>
                  </div>
                )}
                {showSyncResult && (
                  <div
                    role="status"
                    className={
                      lastResult.conflicts.length > 0 || lastResult.errors.length > 0
                        ? 'status-banner'
                        : 'status-banner status-banner--info'
                    }
                    style={{ margin: 0 }}
                    title={syncResultDetail}
                  >
                    <span style={{ flex: 1 }}>{syncResultLabel(lastResult)}</span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Masquer le message de synchronisation"
                      onClick={() => setSyncFeedbackDismissed(true)}
                    >
                      <X size={14} />
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/*
              The action bar, at the bottom rather than in the header: read left to
              right it is « what the tree shows », then « exchange with the server »,
              then the panel control, each group separated by a hairline. The sync
              button is the one boxed control — it is the deliberate, occasional
              action of the bar, and the only one that can take noticeable time.
            */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                rowGap: 4,
                // A safety net for the 180 px minimum width: wrapping onto a second
                // line beats clipping a button the user cannot reach.
                flexWrap: 'wrap',
                padding: '6px 8px',
                borderTop: '1px solid var(--border)',
                flexShrink: 0,
              }}
            >
              <CommandButton command="file.addRootFolder" icon={FolderPlus} variant="ghost" size="icon-sm" />
              <CommandButton command="file.refresh" icon={RefreshCw} variant="ghost" size="icon-sm" />
              <SidebarIconButton
                label={showUnreadable ? 'Masquer les fichiers non lisibles' : 'Afficher les fichiers non lisibles'}
                hint="Fichiers que l’application ne peut pas ouvrir"
                active={showUnreadable}
                onClick={handleToggleShowUnreadable}
              >
                {showUnreadable ? <Eye size={16} /> : <EyeOff size={16} />}
              </SidebarIconButton>

              <span className="toolbar-separator" aria-hidden />

              {/*
                The badge sits OUTSIDE the button (absolutely positioned over it) so
                the button's own hit area, its accessible name and its tooltip are
                untouched by a number that changes on its own.
              */}
              <span style={{ position: 'relative', display: 'inline-flex' }}>
                <CommandButton
                  command="sync.now"
                  icon={CloudSync}
                  variant="outline"
                  size="icon-sm"
                  spinning={syncRunning}
                  tooltipDetail={syncTooltipDetail}
                />
                {(pendingCount ?? 0) + (localOnlyCount ?? 0) > 0 && (
                  <span
                    role="status"
                    style={{
                      position: 'absolute',
                      top: -4,
                      right: -4,
                      minWidth: 14,
                      height: 14,
                      padding: '0 3px',
                      borderRadius: 999,
                      background: 'var(--primary)',
                      color: 'var(--primary-foreground)',
                      fontSize: 9,
                      fontWeight: 600,
                      lineHeight: '14px',
                      textAlign: 'center',
                      pointerEvents: 'none',
                    }}
                  >
                    {(pendingCount ?? 0) + (localOnlyCount ?? 0)}
                  </span>
                )}
              </span>

              <span style={{ marginLeft: 'auto' }} aria-hidden />

              <CommandButton
                command="view.toggleSidebar"
                icon={PanelLeftClose}
                label="Replier la barre latérale"
                variant="ghost"
                size="icon-sm"
              />
            </div>

            {/*
              The drag target for the resize. It straddles the border (a 5px strip
              centred on it) rather than sitting inside the sidebar: a 1px border is
              far too small a target to hit, and widening the border itself would
              move the content. `role="separator"` with the aria-value* trio is the
              standard split-pane contract, so the width is also adjustable with the
              arrow keys once the handle has focus.
            */}
            <div
              ref={handleRef}
              role="separator"
              aria-label="Redimensionner la barre latérale"
              aria-orientation="vertical"
              aria-valuenow={width}
              aria-valuemin={MIN_SIDEBAR_WIDTH}
              aria-valuemax={MAX_SIDEBAR_WIDTH}
              tabIndex={0}
              onPointerDown={handleResizeStart}
              onPointerMove={handleResizeMove}
              onPointerUp={handleResizeEnd}
              onPointerCancel={handleResizeEnd}
              onDoubleClick={() => commitWidth(DEFAULT_SIDEBAR_WIDTH)}
              onKeyDown={handleResizeKeyDown}
              title="Glisser pour redimensionner (double-clic : largeur par défaut)"
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                right: -3,
                width: 5,
                cursor: 'col-resize',
                // Invisible until it is being used or hovered: the 1px border is
                // already the visual edge, this only has to be grabbable.
                background: resizing ? 'var(--ring)' : 'transparent',
                transition: 'background 0.12s ease',
                // Above the tree's rows, so a drag started right on the border is
                // never stolen by whatever row happens to sit under it.
                zIndex: 5,
                touchAction: 'none',
              }}
              onMouseEnter={event => {
                if (!resizing) event.currentTarget.style.background = 'color-mix(in oklch, var(--ring), transparent 60%)'
              }}
              onMouseLeave={event => {
                if (!resizing) event.currentTarget.style.background = 'transparent'
              }}
            />
            {newFolderDialog}
            {folderCreation.dialog}
          </div>
        </ContextMenuTrigger>
        {firstRoot !== undefined && (
          <ContextMenuContent>{folderCreation.menuItems}</ContextMenuContent>
        )}
      </ContextMenu>
    </TooltipProvider>
  )
}
