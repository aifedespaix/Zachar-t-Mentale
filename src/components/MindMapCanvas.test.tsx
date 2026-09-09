import { render, screen, act, within, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import {
  MindMapCanvas,
  carryMeasured,
  findNewlyCreatedCardId,
  overflowWarningMessage,
  resolveDropTarget,
} from './MindMapCanvas'
import { useCardsStore } from '../state/useCardsStore'
import { useWorkspaceStore } from '../state/useWorkspaceStore'
import { useQuizStore, createQuizStore } from '../state/useQuizStore'
import type { Card } from '../types/card'

// Spy on setCenter without disturbing any other @xyflow/react behavior —
// MindMapCanvas still renders the real ReactFlow/ReactFlowProvider tree,
// only the `setCenter` returned by useReactFlow is swapped for a mock so
// auto-focus calls can be asserted directly.
const mockSetCenter = vi.fn()
vi.mock('@xyflow/react', async importOriginal => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  return {
    ...actual,
    useReactFlow: () => ({ ...actual.useReactFlow(), setCenter: mockSetCenter }),
  }
})

vi.mock('../export/exportMindMap', () => ({
  exportToPdfBytes: vi.fn(async () => new Uint8Array([1])),
  exportToImageDataUrls: vi.fn(async () => ['data:image/png;base64,AA==']),
}))
vi.mock('../xmind/exportXmind', () => ({ writeXmindFile: vi.fn(async () => new Uint8Array([2])) }))
vi.mock('../persistence/exportIO', async importOriginal => {
  const actual = await importOriginal<typeof import('../persistence/exportIO')>()
  return { ...actual, saveBytesAs: vi.fn(async () => '/out/carte-mentale.pdf') }
})

import { exportToPdfBytes, exportToImageDataUrls } from '../export/exportMindMap'
import { writeXmindFile } from '../xmind/exportXmind'
import { saveBytesAs } from '../persistence/exportIO'

const root: Card = { id: 'root', level: 1, title: 'Racine', parentId: null, order: 0 }
const child: Card = { id: 'child', level: 2, title: 'Enfant', parentId: 'root', order: 0 }

describe('MindMapCanvas', () => {
  beforeEach(() => {
    useCardsStore.getState().loadCards([root, child])
  })

  it('renders one CardNode per card', () => {
    render(<MindMapCanvas />)
    const titles = screen.getAllByRole('textbox', { name: /titre/i }).map(el => (el as HTMLInputElement).value)
    expect(titles).toEqual(expect.arrayContaining(['Racine', 'Enfant']))
  })

  it('renders one edge for the parent-child link', () => {
    const { container } = render(<MindMapCanvas />)
    expect(container.querySelectorAll('.react-flow__edge')).toHaveLength(1)
  })

  it('still draws the parent-child link after the map is locked', () => {
    // Locking rebuilds every node (it flips `draggable`), which is where the
    // links used to jump: a rebuilt node loses its `measured` box and React
    // Flow re-routes its edges against the 200x92 fallback until the next
    // measurement lands. jsdom measures every card at exactly that fallback
    // size, so the routing itself is pinned by `carryMeasured`'s own tests
    // below; what this covers is the end state — a locked map still has its
    // links.
    const { container } = render(<MindMapCanvas />)
    act(() => useCardsStore.getState().toggleLock())
    expect(container.querySelectorAll('.react-flow__edge')).toHaveLength(1)
    act(() => useCardsStore.getState().toggleLock())
    expect(container.querySelectorAll('.react-flow__edge')).toHaveLength(1)
  })
})

describe('carryMeasured', () => {
  const measured = { width: 240, height: 120 }

  it('carries the measured box of a node that is already on screen', () => {
    const next = carryMeasured(
      [{ id: 'a', position: { x: 0, y: 0 }, data: {} }],
      [{ id: 'a', position: { x: 0, y: 0 }, data: {}, measured, width: 240, height: 120 }]
    )
    expect(next[0].measured).toEqual(measured)
    expect(next[0].width).toBe(240)
  })

  it('leaves a node React Flow has not measured yet alone', () => {
    const next = carryMeasured(
      [{ id: 'a', position: { x: 0, y: 0 }, data: {} }],
      [{ id: 'a', position: { x: 0, y: 0 }, data: {} }]
    )
    expect(next[0].measured).toBeUndefined()
  })

  it('leaves a brand new node unmeasured, so it gets measured for real', () => {
    const next = carryMeasured(
      [{ id: 'nouveau', position: { x: 0, y: 0 }, data: {} }],
      [{ id: 'a', position: { x: 0, y: 0 }, data: {}, measured }]
    )
    expect(next[0].measured).toBeUndefined()
  })

  it('keeps everything else the rebuild produced', () => {
    const next = carryMeasured(
      [{ id: 'a', position: { x: 10, y: 20 }, data: { card: 'nouveau' }, draggable: false }],
      [{ id: 'a', position: { x: 0, y: 0 }, data: { card: 'ancien' }, draggable: true, measured }]
    )
    expect(next[0].position).toEqual({ x: 10, y: 20 })
    expect(next[0].data).toEqual({ card: 'nouveau' })
    expect(next[0].draggable).toBe(false)
  })
})

describe('MindMapCanvas auto-focus', () => {
  beforeEach(() => {
    mockSetCenter.mockClear()
  })

  it('centers the view on a newly created card', async () => {
    const user = userEvent.setup()
    useCardsStore.getState().loadCards([root])
    render(<MindMapCanvas />)
    mockSetCenter.mockClear()

    await user.click(screen.getByRole('button', { name: /ajouter un enfant/i }))

    const newCard = useCardsStore
      .getState()
      .history.present.find(c => c.parentId === root.id)!
    expect(screen.getByTestId(`card-${newCard.id}`)).toBeInTheDocument()
    expect(mockSetCenter).toHaveBeenCalledTimes(1)
  })

  it('opens the new card’s title editor as well as centering on it', async () => {
    const user = userEvent.setup()
    useCardsStore.getState().loadCards([root])
    render(<MindMapCanvas />)

    await user.click(screen.getByRole('button', { name: /ajouter un enfant/i }))

    const newCard = useCardsStore.getState().history.present.find(c => c.parentId === root.id)!
    const titleField = within(screen.getByTestId(`card-${newCard.id}`)).getByRole('textbox', { name: /titre/i })
    expect(titleField).toHaveValue(newCard.title)
    expect(titleField).toHaveFocus()
  })

  it('opens the title editor of a new SIBLING too', async () => {
    const user = userEvent.setup()
    useCardsStore.getState().loadCards([root, child])
    render(<MindMapCanvas />)

    const childCard = within(screen.getByTestId('card-child'))
    await user.click(childCard.getByRole('button', { name: /ajouter en dessous/i }))

    const newCard = useCardsStore.getState().history.present.find(c => c.parentId === child.parentId && c.id !== child.id)!
    expect(within(screen.getByTestId(`card-${newCard.id}`)).getByRole('textbox', { name: /titre/i })).toHaveFocus()
  })

  it('does NOT focus a title field when loadCards replaces the card set (a file load)', () => {
    useCardsStore.getState().loadCards([root])
    render(<MindMapCanvas />)

    const loadedRoot: Card = { id: 'file-root', level: 1, title: 'Depuis le fichier', parentId: null, order: 0 }
    const loadedChild: Card = { id: 'file-child', level: 2, title: 'Enfant', parentId: 'file-root', order: 0 }
    act(() => {
      useCardsStore.getState().loadCards([loadedRoot, loadedChild])
    })

    for (const field of screen.getAllByRole('textbox', { name: /titre/i })) {
      expect(field).not.toHaveFocus()
    }
  })

  it('does NOT auto-focus when loadCards wholesale-replaces the card set (e.g. a file load on mount)', () => {
    useCardsStore.getState().loadCards([root])
    render(<MindMapCanvas />)
    mockSetCenter.mockClear()

    const loadedRoot: Card = { id: 'loaded-root', level: 1, title: 'Racine chargée', parentId: null, order: 0 }
    act(() => {
      useCardsStore.getState().loadCards([loadedRoot])
    })

    expect(screen.getByRole('textbox', { name: /titre/i })).toHaveValue('Racine chargée')
    expect(mockSetCenter).not.toHaveBeenCalled()
  })
})

describe('resolveDropTarget', () => {
  // root(1) -> branchA(2) -> leaf(3), plus a second level-2 branch branchB.
  const branchA: Card = { id: 'branchA', level: 2, title: 'A', parentId: 'root', order: 0 }
  const branchB: Card = { id: 'branchB', level: 2, title: 'B', parentId: 'root', order: 1 }
  const leaf: Card = { id: 'leaf', level: 3, title: 'leaf', parentId: 'branchA', order: 0 }
  const cards: Card[] = [root, branchA, branchB, leaf]

  const WIDTH = 200
  const HEIGHT = 100
  const box = (id: string, x: number, y: number) => ({ id, x, y, width: WIDTH, height: HEIGHT })

  it('reparents when the dragged card sits over the MIDDLE of another card', () => {
    // leaf's center (y = 250) is dead center of branchB's box (200..300).
    const boxes = [box('root', 0, 0), box('branchA', 320, 0), box('branchB', 320, 200), box('leaf', 320, 200)]
    expect(resolveDropTarget(cards, boxes, 'leaf')).toEqual({ kind: 'reparent', parentId: 'branchB' })
  })

  it('reparents onto a card at any level, not just the one above (cross-level move)', () => {
    // leaf (level 3) dropped on the middle of root (level 1).
    const boxes = [box('root', 0, 200), box('branchA', 320, 0), box('branchB', 320, 600), box('leaf', 0, 200)]
    expect(resolveDropTarget(cards, boxes, 'leaf')).toEqual({ kind: 'reparent', parentId: 'root' })
  })

  it('inserts BEFORE the hovered card when hovering its top band', () => {
    // leaf's center (y = 210) is 10% down branchB's box (200..300).
    const boxes = [box('root', 0, 0), box('branchA', 320, 0), box('branchB', 320, 200), box('leaf', 320, 160)]
    expect(resolveDropTarget(cards, boxes, 'leaf')).toEqual({
      kind: 'insert',
      parentId: 'root',
      index: 1,
      anchorId: 'branchB',
      side: 'before',
    })
  })

  it('inserts AFTER the hovered card when hovering its bottom band', () => {
    // leaf's center (y = 290) is 90% down branchB's box (200..300).
    const boxes = [box('root', 0, 0), box('branchA', 320, 0), box('branchB', 320, 200), box('leaf', 320, 240)]
    expect(resolveDropTarget(cards, boxes, 'leaf')).toEqual({
      kind: 'insert',
      parentId: 'root',
      index: 2,
      anchorId: 'branchB',
      side: 'after',
    })
  })

  it('computes the insertion index on the group WITHOUT the dragged card', () => {
    // Reordering inside one group: `second` dropped on `first`'s top band.
    const first: Card = { id: 'first', level: 2, title: '1', parentId: 'root', order: 0 }
    const second: Card = { id: 'second', level: 2, title: '2', parentId: 'root', order: 1 }
    const third: Card = { id: 'third', level: 2, title: '3', parentId: 'root', order: 2 }
    const group = [root, first, second, third]
    const boxes = [box('root', 0, 0), box('first', 320, 200), box('second', 320, 160), box('third', 320, 400)]
    expect(resolveDropTarget(group, boxes, 'second')).toEqual({
      kind: 'insert',
      parentId: 'root',
      index: 0,
      anchorId: 'first',
      side: 'before',
    })
  })

  it('returns null when the dragged card overlaps nothing', () => {
    const boxes = [box('root', 0, 0), box('branchA', 320, 0), box('branchB', 320, 400), box('leaf', 900, 900)]
    expect(resolveDropTarget(cards, boxes, 'leaf')).toBeNull()
  })

  it('returns null over the middle of the parent the card already has', () => {
    const boxes = [box('root', 0, 0), box('branchA', 320, 0), box('branchB', 640, 400), box('leaf', 320, 0)]
    expect(resolveDropTarget(cards, boxes, 'leaf')).toBeNull()
  })

  it('promotes instead: the parent’s top band inserts the card NEXT TO its parent', () => {
    const boxes = [box('root', 0, 0), box('branchA', 320, 200), box('branchB', 640, 900), box('leaf', 320, 160)]
    expect(resolveDropTarget(cards, boxes, 'leaf')).toEqual({
      kind: 'insert',
      parentId: 'root',
      index: 0,
      anchorId: 'branchA',
      side: 'before',
    })
  })

  it('never targets the dragged card’s own branch (no cycle, and it travels along)', () => {
    const boxes = [box('root', 0, 0), box('branchA', 320, 200), box('branchB', 900, 900), box('leaf', 320, 200)]
    expect(resolveDropTarget(cards, boxes, 'branchA')).toBeNull()
  })

  it('falls back to an insertion when the hovered card cannot receive children', () => {
    // A level-4 card has no level 5 to host a child: dropping on its middle
    // means "put me next to it", not "reject the drop".
    const deep: Card = { id: 'deep', level: 4, title: 'deep', parentId: 'leaf', order: 0 }
    const withDeep = [...cards, deep]
    // branchB is dropped over the middle of `deep`, whose parent is `leaf`.
    const boxes = [box('root', 0, 0), box('branchA', 900, 900), box('leaf', 900, 500), box('deep', 640, 200), box('branchB', 640, 190)]
    expect(resolveDropTarget(withDeep, boxes, 'branchB')).toEqual({
      kind: 'insert',
      parentId: 'leaf',
      index: 0,
      anchorId: 'deep',
      side: 'before',
    })
  })

  it('returns null for the root card (it never moves)', () => {
    const boxes = [box('root', 320, 0), box('branchA', 320, 0)]
    expect(resolveDropTarget(cards, boxes, 'root')).toBeNull()
  })

  it('lets a floating card be dropped back onto the tree, and refuses drops onto one', () => {
    const floating: Card = { id: 'floating', level: 3, title: 'f', parentId: null, order: 0, detached: true }
    const withFloating = [...cards, floating]
    const onTree = [box('root', 0, 0), box('branchA', 320, 200), box('branchB', 900, 900), box('leaf', 900, 500), box('floating', 320, 200)]
    expect(resolveDropTarget(withFloating, onTree, 'floating')).toEqual({ kind: 'reparent', parentId: 'branchA' })

    const ontoFloating = [box('root', 0, 0), box('branchA', 900, 900), box('branchB', 320, 200), box('leaf', 900, 500), box('floating', 320, 200)]
    expect(resolveDropTarget(withFloating, ontoFloating, 'branchB')).toBeNull()
  })
})

describe('MindMapCanvas quiz mode', () => {
  beforeEach(() => {
    useCardsStore.getState().loadCards([root, child])
    const pristine = createQuizStore().getState()
    useQuizStore.setState({
      active: true,
      showSummary: pristine.showSummary,
      config: pristine.config,
      questions: [{ cardId: 'child', type: 'recall' }],
      results: { child: 'unanswered' },
      recallProgress: pristine.recallProgress,
      wasLockedBeforeQuiz: pristine.wasLockedBeforeQuiz,
    })
  })

  it('masks only the card that has an active quiz question', () => {
    render(<MindMapCanvas />)

    // The undrawn card keeps its ordinary title field; the drawn one swaps it
    // for the blank the user has to fill.
    const rootInput = within(screen.getByTestId('card-root')).getByRole('textbox', { name: /titre/i })
    expect(rootInput).toHaveValue('Racine')

    const childTitle = within(screen.getByTestId('card-child')).getByTestId('quiz-title')
    expect(childTitle).not.toHaveTextContent('Enfant')
    expect(within(screen.getByTestId('card-child')).queryByRole('textbox', { name: /titre/i })).toBeNull()
  })

  it('offers a way to answer only on the card that was drawn', () => {
    render(<MindMapCanvas />)

    expect(within(screen.getByTestId('card-child')).getByTestId('answer-button')).toBeInTheDocument()
    expect(within(screen.getByTestId('card-root')).queryByTestId('answer-button')).toBeNull()
  })
})

describe('findNewlyCreatedCardId', () => {
  it('returns the new id when it is an incremental add on top of existing ids', () => {
    const previous = new Set(['a'])
    const current = new Set(['a', 'b'])
    expect(findNewlyCreatedCardId(previous, current)).toBe('b')
  })

  it('returns undefined when the id set is wholesale-replaced (no shared ids)', () => {
    const previous = new Set(['a'])
    const current = new Set(['z'])
    expect(findNewlyCreatedCardId(previous, current)).toBeUndefined()
  })

  it('returns undefined when nothing changed', () => {
    const previous = new Set(['a', 'b'])
    const current = new Set(['a', 'b'])
    expect(findNewlyCreatedCardId(previous, current)).toBeUndefined()
  })
})

describe('overflowWarningMessage', () => {
  it('names the 4-level limit and how many cards would go floating', () => {
    expect(overflowWarningMessage(3)).toBe(
      'Attention, ce déplacement dépasse la limite des 4 niveaux. 3 cartes enfants situées hors limite seront transformées en cartes volantes.'
    )
  })

  it('reads correctly for a single card', () => {
    expect(overflowWarningMessage(1)).toBe(
      'Attention, ce déplacement dépasse la limite des 4 niveaux. 1 carte enfant située hors limite sera transformée en carte volante.'
    )
  })
})

describe('MindMapCanvas — context menu', () => {
  function openMenu(container: HTMLElement) {
    fireEvent.contextMenu(container.querySelector('.react-flow')!)
  }

  beforeEach(() => {
    useCardsStore.getState().loadCards([root, child])
    useCardsStore.setState({ locked: false })
    useWorkspaceStore.setState({ currentFilePath: null })
    vi.mocked(exportToPdfBytes).mockClear()
    vi.mocked(exportToImageDataUrls).mockClear()
    vi.mocked(writeXmindFile).mockClear()
    vi.mocked(saveBytesAs).mockClear()
  })

  it('opens on right-click anywhere on the canvas', async () => {
    const { container } = render(<MindMapCanvas />)
    openMenu(container)
    expect(await screen.findByRole('menuitem', { name: /créer une carte volante/i })).toBeInTheDocument()
  })

  it('creates a floating card', async () => {
    const user = userEvent.setup()
    const { container } = render(<MindMapCanvas />)
    const before = useCardsStore.getState().history.present.length
    openMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: /créer une carte volante/i }))
    expect(useCardsStore.getState().history.present).toHaveLength(before + 1)
    expect(useCardsStore.getState().history.present.some(c => c.detached)).toBe(true)
  })

  it('hides creation/undo/redo but keeps export when the map is locked', async () => {
    useCardsStore.setState({ locked: true })
    const { container } = render(<MindMapCanvas />)
    openMenu(container)
    expect(screen.queryByRole('menuitem', { name: /créer une carte volante/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Annuler' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Refaire' })).not.toBeInTheDocument()
    expect(await screen.findByRole('menuitem', { name: /exporter/i })).toBeInTheDocument()
  })

  it('disables Annuler when there is no history and Refaire when there is no future', async () => {
    const { container } = render(<MindMapCanvas />)
    openMenu(container)
    expect(await screen.findByRole('menuitem', { name: 'Annuler' })).toHaveAttribute('data-disabled')
    expect(screen.getByRole('menuitem', { name: 'Refaire' })).toHaveAttribute('data-disabled')
  })

  it('enables Annuler after a change and undoes it', async () => {
    const user = userEvent.setup()
    const { container } = render(<MindMapCanvas />)
    act(() => {
      useCardsStore.getState().addFloatingCard()
    })
    const countAfterAdd = useCardsStore.getState().history.present.length
    openMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Annuler' }))
    expect(useCardsStore.getState().history.present).toHaveLength(countAfterAdd - 1)
  })

  it('exports to PDF via the submenu, using the workspace file name', async () => {
    const user = userEvent.setup()
    useWorkspaceStore.setState({ currentFilePath: '/cours/chapitre1.zmap' })
    const { container } = render(<MindMapCanvas />)
    openMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: /exporter/i }))
    // `fireEvent.click`, not `user.click`, for the item nested inside the
    // submenu: in jsdom, Radix's SubContent races its own outside-focus
    // detection against React's portal-aware focus tracking, so
    // `user.click`'s realistic hover/focus choreography makes `onFocusOutside`
    // fire with the item itself as `event.target` and dismiss the submenu
    // before the click lands — Radix's own guidance is that nested-menu
    // interaction is unreliable in jsdom and should be driven by real
    // browsers. A plain `click` event bypasses that broken focus sequence
    // while still exercising the real onSelect wiring.
    fireEvent.click(await screen.findByRole('menuitem', { name: 'PDF' }))
    expect(exportToPdfBytes).toHaveBeenCalledWith(useCardsStore.getState().history.present, {
      showDefinitions: true,
      includeDetached: true,
      mindMapPath: '/cours/chapitre1.zmap',
    })
    // `fireEvent.click` doesn't wait out the async export chain the way
    // `user.click` would — `waitFor` picks up where it leaves off.
    await waitFor(() =>
      expect(saveBytesAs).toHaveBeenCalledWith(new Uint8Array([1]), 'chapitre1.pdf', [
        { name: 'PDF', extensions: ['pdf'] },
      ])
    )
  })

  it('exports to XMind via the submenu, defaulting the file name when nothing is open', async () => {
    const user = userEvent.setup()
    const { container } = render(<MindMapCanvas />)
    openMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: /exporter/i }))
    // See the PDF export test above for why this is `fireEvent.click`.
    fireEvent.click(await screen.findByRole('menuitem', { name: 'XMind' }))
    expect(writeXmindFile).toHaveBeenCalledWith(useCardsStore.getState().history.present)
    await waitFor(() =>
      expect(saveBytesAs).toHaveBeenCalledWith(new Uint8Array([2]), 'carte-mentale.xmind', [
        { name: 'XMind', extensions: ['xmind'] },
      ])
    )
  })

  it('shows an error banner when the export fails', async () => {
    const user = userEvent.setup()
    vi.mocked(exportToPdfBytes).mockRejectedValueOnce(new Error('disque plein'))
    const { container } = render(<MindMapCanvas />)
    openMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: /exporter/i }))
    // See the PDF export test above for why this is `fireEvent.click`.
    fireEvent.click(await screen.findByRole('menuitem', { name: 'PDF' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/disque plein/)
  })
})
