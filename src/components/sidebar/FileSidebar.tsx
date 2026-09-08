import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { FolderPlus, PanelLeftClose, PanelLeftOpen, RefreshCw, X } from 'lucide-react'
import { Button } from '../ui/button'
import { useWorkspaceStore, describeError } from '../../state/useWorkspaceStore'
import { FileTreeRow } from './FileTreeRow'
import {
  clampSidebarWidth,
  loadSidebarWidth,
  saveSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
} from '../../persistence/sidebarWidth'
import type { FileTreeNode } from '../../types/workspace'

/** How far one arrow-key press moves the border, for a keyboard resize. */
const KEYBOARD_RESIZE_STEP = 16

function folderDisplayName(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] ?? path
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
  const setWorkspaceError = useWorkspaceStore(s => s.setWorkspaceError)
  const [collapsed, setCollapsed] = useState(false)
  // Read synchronously on the first render — an effect would paint the
  // default width for a frame and then visibly snap to the saved one.
  const [width, setWidth] = useState(loadSidebarWidth)
  const [resizing, setResizing] = useState(false)
  const handleRef = useRef<HTMLDivElement>(null)

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

  function handleRemoveRoot(path: string) {
    removeRootFolder(path).catch(error =>
      setWorkspaceError(`Impossible de retirer le dossier : ${describeError(error)}`)
    )
  }

  if (collapsed) {
    return (
      <div style={{ width: 32, borderRight: '1px solid var(--border)', display: 'flex', justifyContent: 'center', paddingTop: 8 }}>
        <Button variant="ghost" size="icon-sm" aria-label="Déplier la barre latérale" onClick={() => setCollapsed(false)}>
          <PanelLeftOpen size={16} />
        </Button>
      </div>
    )
  }

  return (
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Cartes mentales</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <Button variant="ghost" size="icon-sm" aria-label="Ajouter un dossier" onClick={handleAddFolder}>
            <FolderPlus size={16} />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Rafraîchir" onClick={handleRefreshAll}>
            <RefreshCw size={16} />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Replier la barre latérale" onClick={() => setCollapsed(true)}>
            <PanelLeftClose size={16} />
          </Button>
        </div>
      </div>
      {workspaceError && (
        <div role="alert" className="status-banner">
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
            />
          )
        })}
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
    </div>
  )
}
