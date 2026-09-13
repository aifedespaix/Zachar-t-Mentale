import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FileTreeRow, RENAME_CLICK_GRACE_MS } from './FileTreeRow'
import { TreeDragGhost } from './TreeDragGhost'
import { useWorkspaceStore, createWorkspaceStore } from '../../state/useWorkspaceStore'
import { useTreeDragStore } from '../../state/useTreeDragStore'
import type { FileTreeNode } from '../../types/workspace'

/**
 * The row's drag & drop, kept in its own file rather than appended to
 * `FileTreeRow.test.tsx`: this is a gesture, not an action — it owns pointer
 * listeners, a global store and a DOM hit test, and it is easier to read whole.
 */
vi.mock('../../persistence/fileOps', async importOriginal => {
  const actual = await importOriginal<typeof import('../../persistence/fileOps')>()
  return { ...actual, movePath: vi.fn() }
})
vi.mock('../../persistence/fileTree', async importOriginal => {
  const actual = await importOriginal<typeof import('../../persistence/fileTree')>()
  return { ...actual, scanFolder: vi.fn() }
})
vi.mock('../../persistence/fileStore', () => ({
  loadMindMap: vi.fn(),
  saveMindMap: vi.fn(),
  mindMapExists: vi.fn().mockResolvedValue(false),
  stampMindMapSyncMeta: vi.fn(),
  setMindMapType: vi.fn(),
}))
vi.mock('../../persistence/exportIO', () => ({ pickXmindFile: vi.fn(), readBinaryFile: vi.fn() }))
vi.mock('../../xmind/importXmind', () => ({ readXmindFile: vi.fn() }))
vi.mock('../../hooks/useMindMapFormatValid', () => ({ useMindMapFormatValid: vi.fn() }))
vi.mock('../../hooks/useMindMapAuthor', () => ({ useMindMapAuthor: vi.fn() }))

import { movePath } from '../../persistence/fileOps'
import { scanFolder } from '../../persistence/fileTree'
import { useMindMapFormatValid } from '../../hooks/useMindMapFormatValid'
import { useMindMapAuthor } from '../../hooks/useMindMapAuthor'

const ROOT: FileTreeNode = {
  type: 'folder',
  name: 'cours',
  path: '/cours',
  children: [
    { type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' },
    { type: 'folder', name: 'Chapitre 1', path: '/cours/Chapitre 1', children: [] },
  ],
}

const FILE: FileTreeNode = { type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' }

const originalElementFromPoint = document.elementFromPoint as
  | ((x: number, y: number) => Element | null)
  | undefined

describe('FileTreeRow — glisser-déposer', () => {
  beforeEach(() => {
    vi.mocked(movePath).mockReset().mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockReset().mockResolvedValue([])
    vi.mocked(useMindMapFormatValid).mockReset()
    vi.mocked(useMindMapAuthor).mockReset().mockReturnValue(null)
    useTreeDragStore.setState({ source: null, pointer: null, targetPath: null })
    const pristine = createWorkspaceStore().getState()
    useWorkspaceStore.setState({
      rootFolders: [{ path: '/cours', tree: [] }],
      // The root is open, so the rows under test exist at all.
      expandedPaths: new Set(['/cours']),
      currentFilePath: pristine.currentFilePath,
      workspaceError: null,
    })
    Object.defineProperty(document, 'elementFromPoint', { value: vi.fn(() => null), writable: true, configurable: true })
  })

  afterEach(() => {
    // Releases the window listeners of a gesture a test left in flight, so the
    // next test's `pointerup` cannot fire the previous drag.
    fireEvent.pointerCancel(window)
    useTreeDragStore.getState().end()
    if (originalElementFromPoint === undefined) {
      delete (document as unknown as Record<string, unknown>).elementFromPoint
    } else {
      document.elementFromPoint = originalElementFromPoint
    }
  })

  it('marks rows as drag sources, and a folder branch as the drop zone around them', () => {
    render(<FileTreeRow node={ROOT} depth={0} onOpenFile={() => {}} />)

    const folder = screen.getByRole('button', { name: 'Chapitre 1' })
    expect(folder).toHaveAttribute('data-tree-row', '/cours/Chapitre 1')
    expect(folder).toHaveAttribute('data-tree-kind', 'folder')
    expect(folder.closest('[data-drop-folder]')).toHaveAttribute('data-drop-folder', '/cours/Chapitre 1')

    const file = screen.getByRole('button', { name: 'a' })
    expect(file).toHaveAttribute('data-tree-row', '/cours/a.zmap')
    expect(file).toHaveAttribute('data-tree-kind', 'mindmap')
  })

  it('moves a file into the folder row it is dropped on', async () => {
    render(<FileTreeRow node={ROOT} depth={0} onOpenFile={() => {}} />)
    const file = screen.getByRole('button', { name: 'a' })
    vi.mocked(document.elementFromPoint).mockReturnValue(screen.getByRole('button', { name: 'Chapitre 1' }))

    fireEvent.pointerDown(file, { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(window, { clientX: 60, clientY: 60 })
    fireEvent.pointerUp(window)

    await waitFor(() => expect(movePath).toHaveBeenCalledWith('/cours/a.zmap', '/cours/Chapitre 1', false))
  })

  it('shows the destination on the ghost while the row is in flight', async () => {
    // The ghost is a sibling of the tree (the sidebar renders it once), so the
    // test mounts both halves of the pair.
    render(
      <>
        <FileTreeRow node={ROOT} depth={0} onOpenFile={() => {}} />
        <TreeDragGhost />
      </>
    )
    const file = screen.getByRole('button', { name: 'a' })
    vi.mocked(document.elementFromPoint).mockReturnValue(screen.getByRole('button', { name: 'Chapitre 1' }))

    fireEvent.pointerDown(file, { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(window, { clientX: 60, clientY: 60 })

    expect(await screen.findByTestId('tree-drag-ghost')).toHaveTextContent('Déplacer dans « Chapitre 1 »')
  })

  it('does not open the map that the click ending a drag would otherwise trigger', async () => {
    const onOpenFile = vi.fn()
    render(<FileTreeRow node={ROOT} depth={0} onOpenFile={onOpenFile} />)
    const file = screen.getByRole('button', { name: 'a' })
    vi.mocked(document.elementFromPoint).mockReturnValue(screen.getByRole('button', { name: 'Chapitre 1' }))

    fireEvent.pointerDown(file, { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(window, { clientX: 60, clientY: 60 })
    fireEvent.pointerUp(window)
    fireEvent.click(file)

    await waitFor(() => expect(movePath).toHaveBeenCalled())
    expect(onOpenFile).not.toHaveBeenCalled()
  })

  it('does not fold or unfold the folder whose click merely ends a drag', async () => {
    render(<FileTreeRow node={ROOT} depth={1} onOpenFile={() => {}} />)
    const folder = screen.getByRole('button', { name: 'Chapitre 1' })

    fireEvent.pointerDown(folder, { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(window, { clientX: 60, clientY: 60 })
    fireEvent.pointerUp(window)
    fireEvent.click(folder)

    // The delivered click is the tail of the gesture, never a fold/unfold — not
    // even the deferred one, which would otherwise land seconds later.
    await new Promise(resolve => setTimeout(resolve, RENAME_CLICK_GRACE_MS + 50))
    expect(useWorkspaceStore.getState().expandedPaths.has('/cours/Chapitre 1')).toBe(false)
  })

  it('still folds a ROOT folder on the click that follows an unrelated drag', async () => {
    // A drag ending over empty space leaves the swallowed-click flag set, and no
    // row ever consumed it. The root below must not eat its next click anyway:
    // it is the one row kind that can never have started a drag.
    render(<FileTreeRow node={ROOT} depth={0} onOpenFile={() => {}} isRoot onRemoveRoot={() => {}} />)
    const root = screen.getByRole('button', { name: 'cours' })
    const child = screen.getByRole('button', { name: 'Chapitre 1' })

    fireEvent.pointerDown(child, { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(window, { clientX: 60, clientY: 60 })
    fireEvent.pointerUp(window)
    fireEvent.click(root)

    expect(useWorkspaceStore.getState().expandedPaths.has('/cours')).toBe(false)
  })

  it('opens the map on a plain click, which is not a drag', async () => {
    const onOpenFile = vi.fn()
    render(<FileTreeRow node={ROOT} depth={0} onOpenFile={onOpenFile} />)
    const file = screen.getByRole('button', { name: 'a' })

    fireEvent.pointerDown(file, { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerUp(window)
    fireEvent.click(file)

    expect(onOpenFile).toHaveBeenCalledWith('/cours/a.zmap')
    expect(movePath).not.toHaveBeenCalled()
  })

  it('offers « Déplacer vers… » for the folders the gesture would accept', async () => {
    useWorkspaceStore.setState({ rootFolders: [{ path: '/cours', tree: [ROOT.children![1]] }] })
    render(<FileTreeRow node={FILE} depth={1} onOpenFile={() => {}} />)

    fireEvent.contextMenu(screen.getByRole('button', { name: 'a' }))

    expect(await screen.findByText('Déplacer vers…')).toBeInTheDocument()
  })

  it('hides it when the only folder reachable is the one the map is already in', async () => {
    useWorkspaceStore.setState({ rootFolders: [{ path: '/cours', tree: [] }] })
    render(<FileTreeRow node={FILE} depth={1} onOpenFile={() => {}} />)

    fireEvent.contextMenu(screen.getByRole('button', { name: 'a' }))

    expect(await screen.findByRole('menuitem', { name: /Dupliquer/ })).toBeInTheDocument()
    expect(screen.queryByText('Déplacer vers…')).not.toBeInTheDocument()
  })
})
