import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
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
