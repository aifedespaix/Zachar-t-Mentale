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
