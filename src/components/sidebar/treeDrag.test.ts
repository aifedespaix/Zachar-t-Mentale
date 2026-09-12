import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { beginTreeDrag, dropTargetAt, isValidDropTarget, HOVER_EXPAND_MS } from './treeDrag'
import { useTreeDragStore } from '../../state/useTreeDragStore'
import { useWorkspaceStore, createWorkspaceStore } from '../../state/useWorkspaceStore'

vi.mock('../../persistence/fileOps', () => ({ movePath: vi.fn() }))
vi.mock('../../persistence/fileTree', () => ({ scanFolder: vi.fn().mockResolvedValue([]) }))
vi.mock('../../persistence/sessionState', () => ({
  loadSessionState: vi.fn().mockReturnValue({ currentFilePath: null, expandedPaths: [] }),
  saveSessionState: vi.fn(),
}))

import { movePath } from '../../persistence/fileOps'
import { scanFolder } from '../../persistence/fileTree'

/** jsdom has no `elementFromPoint` at all, so it is installed rather than spied on. */
const originalElementFromPoint = document.elementFromPoint as
  | ((x: number, y: number) => Element | null)
  | undefined

function pointAt(element: Element | null) {
  vi.mocked(document.elementFromPoint).mockReturnValue(element)
}

function pointerEvent(type: string, init: PointerEventInit): Event {
  // jsdom implements PointerEvent; the fallback is for an engine that only has
  // MouseEvent — the handlers read nothing but the coordinates.
  const Constructor = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent
  return new Constructor(type, init)
}

/** The press that starts the gesture. Only `button` and the coordinates are read. */
function press(x: number, y: number): ReactPointerEvent<HTMLElement> {
  return { button: 0, clientX: x, clientY: y } as ReactPointerEvent<HTMLElement>
}

function drag(source: { path: string; name: string; kind: 'folder' | 'mindmap' }, to: { x: number; y: number }) {
  beginTreeDrag(press(10, 10), source)
  window.dispatchEvent(pointerEvent('pointermove', { clientX: to.x, clientY: to.y }))
}

const FILE = { path: '/cours/Chapitre 1/a.zmap', name: 'a', kind: 'mindmap' as const }
const FOLDER = { path: '/cours/Chapitre 1', name: 'Chapitre 1', kind: 'folder' as const }

describe('dropTargetAt', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'elementFromPoint', { value: vi.fn(() => null), writable: true, configurable: true })
    document.body.innerHTML = `
      <div data-drop-folder="/cours">
        <div><button data-tree-row="/cours" data-tree-kind="folder">cours</button></div>
        <div data-drop-folder="/cours/Chapitre 1">
          <div>
            <button data-tree-row="/cours/Chapitre 1" data-tree-kind="folder">Chapitre 1</button>
            <button data-tree-row="/cours/Chapitre 1/a.zmap" data-tree-kind="mindmap">a</button>
          </div>
        </div>
      </div>
    `
  })

  afterEach(() => {
    document.body.innerHTML = ''
    if (originalElementFromPoint === undefined) {
      delete (document as unknown as Record<string, unknown>).elementFromPoint
    } else {
      document.elementFromPoint = originalElementFromPoint
    }
  })

  it('reads the folder header under the pointer', () => {
    pointAt(document.querySelector('[data-tree-row="/cours/Chapitre 1"]'))
    expect(dropTargetAt(10, 10)).toBe('/cours/Chapitre 1')
  })

  it('resolves a file to the folder that encloses it', () => {
    pointAt(document.querySelector('[data-tree-row="/cours/Chapitre 1/a.zmap"]'))
    expect(dropTargetAt(10, 10)).toBe('/cours/Chapitre 1')
  })

  it('finds no destination in the gap below the tree', () => {
    pointAt(null)
    expect(dropTargetAt(10, 10)).toBeNull()
  })
})

describe('isValidDropTarget', () => {
  it('accepts any other folder, including one level back up the tree', () => {
    expect(isValidDropTarget(FILE, '/cours/Chapitre 2')).toBe(true)
    // Back up to the root is a real move, not the no-op below: the row lives in
    // « Chapitre 1 », one level deeper.
    expect(isValidDropTarget(FILE, '/cours')).toBe(true)
  })

  it('refuses the row itself, the folder it is already in, and a folder inside a dragged folder', () => {
    expect(isValidDropTarget(FILE, null)).toBe(false)
    expect(isValidDropTarget(FILE, '')).toBe(false)
    expect(isValidDropTarget(FILE, FILE.path)).toBe(false)
    // Its OWN folder: the drop would move it nowhere.
    expect(isValidDropTarget(FILE, '/cours/Chapitre 1')).toBe(false)
    expect(isValidDropTarget(FOLDER, '/cours/Chapitre 1/Sous-chapitre')).toBe(false)
    expect(isValidDropTarget(FOLDER, FOLDER.path)).toBe(false)
  })

  it('compares the current folder the way the filesystem does, whatever the case', () => {
    expect(isValidDropTarget(FILE, '/Cours/Chapitre 1')).toBe(false)
  })
})

describe('beginTreeDrag', () => {
  beforeEach(() => {
    vi.mocked(movePath).mockReset().mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockReset().mockResolvedValue([])
    useTreeDragStore.setState({ source: null, pointer: null, targetPath: null })
    const pristine = createWorkspaceStore().getState()
    useWorkspaceStore.setState({
      rootFolders: pristine.rootFolders,
      expandedPaths: pristine.expandedPaths,
      currentFilePath: pristine.currentFilePath,
      workspaceError: pristine.workspaceError,
    })
    document.body.innerHTML = '<div><button data-tree-row="/cours/Chapitre 2" data-tree-kind="folder">c</button></div>'
    Object.defineProperty(document, 'elementFromPoint', { value: vi.fn(() => null), writable: true, configurable: true })
  })

  afterEach(() => {
    // Releases the window listeners of a gesture a test left in flight, so the
    // next test's `pointerup` cannot fire the previous drag.
    window.dispatchEvent(pointerEvent('pointercancel', {}))
    useTreeDragStore.getState().end()
    vi.useRealTimers()
  })

  it('moves the row into the folder it is released on', async () => {
    pointAt(document.querySelector('[data-tree-row="/cours/Chapitre 2"]'))
    drag(FILE, { x: 60, y: 60 })

    expect(useTreeDragStore.getState().targetPath).toBe('/cours/Chapitre 2')

    window.dispatchEvent(pointerEvent('pointerup', {}))

    await vi.waitFor(() => expect(movePath).toHaveBeenCalledWith(FILE.path, '/cours/Chapitre 2', false))
    expect(useTreeDragStore.getState().source).toBeNull()
  })

  it('carries the folder flag through when what is dragged is a folder', async () => {
    pointAt(document.querySelector('[data-tree-row="/cours/Chapitre 2"]'))
    drag(FOLDER, { x: 60, y: 60 })
    window.dispatchEvent(pointerEvent('pointerup', {}))

    await vi.waitFor(() => expect(movePath).toHaveBeenCalledWith(FOLDER.path, '/cours/Chapitre 2', true))
  })

  it('does not move anything when the release lands on no useful folder', async () => {
    // The row's own folder is a no-op, so the highlight is never shown for it —
    // and a release there must do nothing at all.
    pointAt(document.querySelector('[data-tree-row="/cours/Chapitre 2"]'))
    drag({ path: '/cours/Chapitre 2/b.zmap', name: 'b', kind: 'mindmap' }, { x: 60, y: 60 })

    expect(useTreeDragStore.getState().targetPath).toBeNull()

    window.dispatchEvent(pointerEvent('pointerup', {}))
    expect(movePath).not.toHaveBeenCalled()
  })

  it('never becomes a drag before the pointer has actually moved', async () => {
    beginTreeDrag(press(10, 10), FILE)

    window.dispatchEvent(pointerEvent('pointerup', {}))

    expect(useTreeDragStore.getState().source).toBeNull()
    expect(movePath).not.toHaveBeenCalled()
  })

  it('opens a collapsed folder the drag rests on, so a destination one level down is reachable', () => {
    vi.useFakeTimers()
    pointAt(document.querySelector('[data-tree-row="/cours/Chapitre 2"]'))
    drag(FILE, { x: 60, y: 60 })

    expect(useWorkspaceStore.getState().expandedPaths.has('/cours/Chapitre 2')).toBe(false)
    vi.advanceTimersByTime(HOVER_EXPAND_MS)
    expect(useWorkspaceStore.getState().expandedPaths.has('/cours/Chapitre 2')).toBe(true)
  })

  it('cancels on Échap, leaving both the tree and the disk alone', () => {
    pointAt(document.querySelector('[data-tree-row="/cours/Chapitre 2"]'))
    drag(FILE, { x: 60, y: 60 })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    window.dispatchEvent(pointerEvent('pointerup', {}))

    expect(useTreeDragStore.getState().source).toBeNull()
    expect(movePath).not.toHaveBeenCalled()
  })
})
