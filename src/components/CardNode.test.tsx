import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach } from 'vitest'
import type { NodeProps } from '@xyflow/react'
import { CardNode } from './CardNode'
import { useCardsStore } from '../state/useCardsStore'
import type { Card } from '../types/card'

const testCard: Card = { id: 'root', level: 1, title: 'Titre initial', parentId: null, order: 0 }

function renderCardNode(card: Card) {
  const props = { id: card.id, data: { card } } as unknown as NodeProps & { data: { card: Card } }
  return render(<CardNode {...props} />)
}

describe('CardNode', () => {
  beforeEach(() => {
    useCardsStore.getState().loadCards([testCard])
  })

  it('displays the card title', () => {
    renderCardNode(testCard)
    expect(screen.getByText('Titre initial')).toBeInTheDocument()
  })

  it('enters edit mode on click and commits the new title on Enter', async () => {
    const user = userEvent.setup()
    renderCardNode(testCard)

    await user.click(screen.getByText('Titre initial'))
    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'Nouveau titre{Enter}')

    expect(useCardsStore.getState().history.present[0].title).toBe('Nouveau titre')
  })

  it('cancels the edit on Escape without changing the stored title', async () => {
    const user = userEvent.setup()
    renderCardNode(testCard)

    await user.click(screen.getByText('Titre initial'))
    const input = screen.getByRole('textbox')
    await user.type(input, ' modifié{Escape}')

    expect(useCardsStore.getState().history.present[0].title).toBe('Titre initial')
  })
})

describe('CardNode structural buttons', () => {
  beforeEach(() => {
    useCardsStore.getState().loadCards([testCard])
  })

  it('creates a child when the -> button is clicked', async () => {
    const user = userEvent.setup()
    renderCardNode(testCard)
    await user.click(screen.getByRole('button', { name: /ajouter un enfant/i }))
    expect(useCardsStore.getState().history.present).toHaveLength(2)
  })

  it('creates a sibling below when the bottom + button is clicked', async () => {
    const user = userEvent.setup()
    const child: Card = { id: 'child', level: 2, title: 'Enfant', parentId: 'root', order: 0 }
    useCardsStore.getState().loadCards([testCard, child])
    render(
      <CardNode {...({ id: child.id, data: { card: child } } as unknown as NodeProps & { data: { card: Card } })} />
    )
    await user.click(screen.getByRole('button', { name: /ajouter en dessous/i }))
    expect(useCardsStore.getState().history.present).toHaveLength(3)
  })

  it('does not render + buttons on the root card (single-root invariant)', () => {
    renderCardNode(testCard)
    expect(screen.queryByRole('button', { name: /ajouter au-dessus/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ajouter en dessous/i })).not.toBeInTheDocument()
  })

  it('does not render the -> button on a level-4 card', () => {
    const level4: Card = { id: 'l4', level: 4, title: 'Info', parentId: 'root', order: 0 }
    useCardsStore.getState().loadCards([testCard, level4])
    render(<CardNode {...({ id: level4.id, data: { card: level4 } } as unknown as NodeProps & { data: { card: Card } })} />)
    expect(screen.queryByRole('button', { name: /ajouter un enfant/i })).not.toBeInTheDocument()
  })
})

describe('CardNode delete', () => {
  it('deletes immediately when the card has no children', async () => {
    const user = userEvent.setup()
    const child: Card = { id: 'child', level: 2, title: 'Enfant', parentId: 'root', order: 0 }
    useCardsStore.getState().loadCards([testCard, child])
    render(<CardNode {...({ id: child.id, data: { card: child } } as unknown as NodeProps & { data: { card: Card } })} />)

    await user.click(screen.getByRole('button', { name: /supprimer/i }))
    expect(useCardsStore.getState().history.present).toHaveLength(1)
  })

  it('shows a confirmation dialog before deleting a card with children', async () => {
    const user = userEvent.setup()
    const child: Card = { id: 'child', level: 2, title: 'Enfant', parentId: 'root', order: 0 }
    const grandchild: Card = { id: 'grandchild', level: 3, title: 'Petit-enfant', parentId: 'child', order: 0 }
    useCardsStore.getState().loadCards([testCard, child, grandchild])
    render(<CardNode {...({ id: child.id, data: { card: child } } as unknown as NodeProps & { data: { card: Card } })} />)

    await user.click(screen.getByRole('button', { name: /supprimer/i }))
    expect(screen.getByText(/supprimer cette card et ses 1 enfants/i)).toBeInTheDocument()
    expect(useCardsStore.getState().history.present).toHaveLength(3)

    await user.click(screen.getByRole('button', { name: /confirmer/i }))
    expect(useCardsStore.getState().history.present).toHaveLength(1)
  })

  it('does not render a delete button on the root card', () => {
    renderCardNode(testCard)
    expect(screen.queryByRole('button', { name: /supprimer/i })).not.toBeInTheDocument()
  })
})

describe('CardNode drag handle', () => {
  it('renders an enabled drag handle when unlocked', () => {
    useCardsStore.getState().loadCards([testCard])
    renderCardNode(testCard)
    const handle = screen.getByTestId('drag-handle')
    expect(handle).toHaveAttribute('aria-disabled', 'false')
  })

  it('greys out the drag handle when locked, without removing it', () => {
    useCardsStore.getState().loadCards([testCard])
    useCardsStore.getState().toggleLock()
    renderCardNode(testCard)
    const handle = screen.getByTestId('drag-handle')
    expect(handle).toHaveAttribute('aria-disabled', 'true')
    useCardsStore.getState().toggleLock() // reset for other tests
  })
})
