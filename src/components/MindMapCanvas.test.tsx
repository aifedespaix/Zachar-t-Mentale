import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { MindMapCanvas } from './MindMapCanvas'
import { useCardsStore } from '../state/useCardsStore'
import type { Card } from '../types/card'

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
  it('centers the view on a newly created card', async () => {
    const user = userEvent.setup()
    useCardsStore.getState().loadCards([root])
    render(<MindMapCanvas />)

    await user.click(screen.getByRole('button', { name: /ajouter un enfant/i }))

    const newCard = useCardsStore
      .getState()
      .history.present.find(c => c.parentId === root.id)!
    expect(screen.getByTestId(`card-${newCard.id}`)).toBeInTheDocument()
  })
})
