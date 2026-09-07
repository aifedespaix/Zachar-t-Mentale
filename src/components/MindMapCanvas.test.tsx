import { render, screen, act, within } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { MindMapCanvas, findNewlyCreatedCardId, resolveReparentTarget } from './MindMapCanvas'
import { useCardsStore } from '../state/useCardsStore'
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

describe('resolveReparentTarget', () => {
  // Two level-2 branches (branchA, branchB) under root, each with a level-3 leaf.
  const branchA: Card = { id: 'branchA', level: 2, title: 'A', parentId: 'root', order: 0 }
  const branchB: Card = { id: 'branchB', level: 2, title: 'B', parentId: 'root', order: 1 }
  const leaf: Card = { id: 'leaf', level: 3, title: 'leaf', parentId: 'branchA', order: 0 }
  const cards: Card[] = [root, branchA, branchB, leaf]

  const box = (id: string, x: number, y: number) => ({ id, x, y, width: 200, height: 92 })

  it('targets the same-level card the dragged card overlaps', () => {
    const boxes = [box('root', 0, 0), box('branchA', 320, 0), box('branchB', 320, 200), box('leaf', 320, 200)]
    expect(resolveReparentTarget(cards, boxes, 'leaf')).toBe('branchB')
  })

  it('returns undefined when the dragged card overlaps nothing', () => {
    const boxes = [box('root', 0, 0), box('branchA', 320, 0), box('branchB', 320, 400), box('leaf', 900, 900)]
    expect(resolveReparentTarget(cards, boxes, 'leaf')).toBeUndefined()
  })

  it('ignores an overlap with a card at the wrong level', () => {
    // leaf overlaps root (level 1), which is not level 2 (branchA/leaf's level - 1)
    const boxes = [box('root', 320, 200), box('branchA', 640, 0), box('branchB', 640, 400), box('leaf', 320, 200)]
    expect(resolveReparentTarget(cards, boxes, 'leaf')).toBeUndefined()
  })

  it('ignores an overlap with the card’s current parent (no-op target)', () => {
    const boxes = [box('root', 0, 0), box('branchA', 320, 0), box('branchB', 640, 400), box('leaf', 320, 0)]
    expect(resolveReparentTarget(cards, boxes, 'leaf')).toBeUndefined()
  })

  it('picks the closest-center target when overlapping several valid candidates', () => {
    const branchD: Card = { id: 'branchD', level: 2, title: 'D', parentId: 'root', order: 2 }
    const withD = [...cards, branchD]
    const boxes = [
      box('root', 0, 0),
      box('branchA', 900, 900), // out of the way — not the overlap under test
      box('branchB', 340, 20), // center (440, 66) — closer to leaf's center (420, 46)
      box('branchD', 280, -40), // center (380, 6) — farther
      box('leaf', 320, 0),
    ]
    expect(resolveReparentTarget(withD, boxes, 'leaf')).toBe('branchB')
  })

  it('returns undefined for the root card (no parent to change)', () => {
    const boxes = [box('root', 0, 0), box('branchA', 0, 0)]
    expect(resolveReparentTarget(cards, boxes, 'root')).toBeUndefined()
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
      wasLockedBeforeQuiz: pristine.wasLockedBeforeQuiz,
    })
  })

  it('masks only the card that has an active quiz question', () => {
    render(<MindMapCanvas />)

    const rootInput = within(screen.getByTestId('card-root')).getByRole('textbox', { name: /titre/i })
    const childInput = within(screen.getByTestId('card-child')).getByRole('textbox', { name: /titre/i })
    expect(rootInput).toHaveValue('Racine')
    expect(childInput).not.toHaveValue('Enfant')
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
