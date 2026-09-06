import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { MindMapCanvas, findNewlyCreatedCardId } from './MindMapCanvas'
import { useCardsStore } from '../state/useCardsStore'
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
    expect(screen.getByText('Racine')).toBeInTheDocument()
    expect(screen.getByText('Enfant')).toBeInTheDocument()
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

  it('does NOT auto-focus when loadCards wholesale-replaces the card set (e.g. a file load on mount)', () => {
    useCardsStore.getState().loadCards([root])
    render(<MindMapCanvas />)
    mockSetCenter.mockClear()

    const loadedRoot: Card = { id: 'loaded-root', level: 1, title: 'Racine chargée', parentId: null, order: 0 }
    act(() => {
      useCardsStore.getState().loadCards([loadedRoot])
    })

    expect(screen.getByText('Racine chargée')).toBeInTheDocument()
    expect(mockSetCenter).not.toHaveBeenCalled()
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
