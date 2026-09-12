import type { PointerEvent as ReactPointerEvent } from 'react'
import { isInsideFolder, isSameFilePath, parentDirOf } from '../../persistence/paths'
import { useTreeDragStore, type TreeDragSource } from '../../state/useTreeDragStore'
import { useWorkspaceStore } from '../../state/useWorkspaceStore'

/**
 * How far the pointer must travel before a press becomes a drag.
 *
 * Below it the gesture is still the click that opens a map (and the
 * double-click that renames it, and the right-click that opens the menu): the
 * sidebar has no drag handle, so the only thing separating the two is having
 * actually moved.
 */
export const DRAG_THRESHOLD_PX = 5

/**
 * How long a collapsed folder must be hovered mid-drag before it opens, so a
 * destination hidden one level down is reachable without letting go — the
 * behaviour Finder and Explorer trained everyone on.
 */
export const HOVER_EXPAND_MS = 600

/**
 * Set once a gesture has actually moved, and read back by the row's own click
 * handler: a drag ends with a `pointerup`, which the browser follows with a
 * `click`, and without this a map dropped back onto its own row would also
 * OPEN. Module state rather than store state because it is consumed exactly
 * once, by whichever row the click lands on, and it is cleared by the next
 * press — a click that reached no row can never swallow a later, genuine one.
 */
let swallowClick = false

/** Whether the click that is being handled is the tail of a drag, and must be ignored. */
export function consumeSwallowedClick(): boolean {
  if (!swallowClick) return false
  swallowClick = false
  return true
}

/**
 * The folder the pointer would drop into, or `null`.
 *
 * Two levels, because the sidebar's rows are not all potential destinations:
 * a folder's own header is one, while anywhere inside a folder's subtree — over
 * a file, or over a nested folder — still means that enclosing folder, which is
 * what makes the hit area the whole branch rather than a 20 px line of text.
 */
export function dropTargetAt(x: number, y: number): string | null {
  // Guarded rather than assumed: `elementFromPoint` is standard in the Tauri
  // webviews but absent from some non-browser DOM implementations, and this
  // runs inside a pointer handler where a throw would be swallowed silently.
  if (typeof document.elementFromPoint !== 'function') return null

  const element = document.elementFromPoint(x, y)
  if (element === null) return null

  const row = element.closest('[data-tree-row]')
  if (row?.getAttribute('data-tree-kind') === 'folder') return row.getAttribute('data-tree-row')

  return element.closest('[data-drop-folder]')?.getAttribute('data-drop-folder') ?? null
}

/**
 * Whether dropping `source` into `targetPath` would do something.
 *
 * The three refusals mirror `movePath`'s, one gesture earlier: the row itself,
 * a folder inside the dragged folder (an infinite tree), and the folder the
 * file already lives in (a no-op). Refusing them HERE is what keeps the drop
 * highlight honest — it is never shown for a drop that would fail or do
 * nothing.
 */
export function isValidDropTarget(source: TreeDragSource, targetPath: string | null): boolean {
  if (targetPath === null || targetPath === '') return false
  if (isSameFilePath(source.path, targetPath)) return false
  if (source.kind === 'folder' && isInsideFolder(targetPath, source.path)) return false
  if (isSameFilePath(parentDirOf(source.path), targetPath)) return false
  return true
}

/**
 * Starts tracking a press as a possible drag.
 *
 * Pointer events rather than HTML5 drag & drop, for two reasons: the Tauri
 * webview has its drag-drop handler enabled (it is what lets a `.zmap` or a
 * picture be dropped onto the window from the file manager), which makes
 * in-page `dragstart`/`drop` unreliable there, and this way the ghost and the
 * drop highlight are ordinary markup we style ourselves, not the browser's
 * opinion of what a drag looks like.
 *
 * Listeners are attached to the window, not the row: the rows are a scrollable
 * list the gesture reorders, so the pointer routinely leaves the element it
 * started on, and a mid-drag tree refresh can replace the row entirely.
 */
export function beginTreeDrag(event: ReactPointerEvent<HTMLElement>, source: TreeDragSource): void {
  swallowClick = false
  if (event.button !== 0) return

  const startX = event.clientX
  const startY = event.clientY
  let active = false
  let hoveredPath: string | null = null
  let expandTimer: number | null = null

  function cancelExpandTimer() {
    if (expandTimer !== null) window.clearTimeout(expandTimer)
    expandTimer = null
  }

  function stopListening() {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('blur', onCancel)
  }

  function onMove(move: PointerEvent) {
    if (!active) {
      if (Math.abs(move.clientX - startX) < DRAG_THRESHOLD_PX && Math.abs(move.clientY - startY) < DRAG_THRESHOLD_PX) return
      active = true
      useTreeDragStore.getState().begin(source, { x: move.clientX, y: move.clientY })
    }

    const drag = useTreeDragStore.getState()
    drag.movePointer({ x: move.clientX, y: move.clientY })
    const candidate = dropTargetAt(move.clientX, move.clientY)
    const target = isValidDropTarget(source, candidate) ? candidate : null
    drag.setTarget(target)

    if (target === hoveredPath) return
    hoveredPath = target
    cancelExpandTimer()
    // Only a folder that is actually closed, and only the one the pointer rests
    // on: opening everything the cursor sweeps across would fling the tree open.
    if (target !== null && !useWorkspaceStore.getState().expandedPaths.has(target)) {
      expandTimer = window.setTimeout(() => useWorkspaceStore.getState().expandPaths([target]), HOVER_EXPAND_MS)
    }
  }

  function onUp() {
    stopListening()
    cancelExpandTimer()
    const target = useTreeDragStore.getState().targetPath
    useTreeDragStore.getState().end()
    if (!active) return
    swallowClick = true
    if (target === null) return
    // The store owns the whole consequence of a move — the open path, the
    // expanded folders, both listings, and the error banner if it fails.
    void useWorkspaceStore.getState().moveNode(source.path, target, source.kind === 'folder')
  }

  function onCancel() {
    stopListening()
    cancelExpandTimer()
    if (active) swallowClick = true
    useTreeDragStore.getState().end()
  }

  function onKeyDown(key: KeyboardEvent) {
    if (key.key === 'Escape') onCancel()
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('blur', onCancel)
}
