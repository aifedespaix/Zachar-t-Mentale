import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StaticCardView } from './StaticCardView'
import type { Card } from '../types/card'

describe('StaticCardView', () => {
  const card: Card = { id: 'c1', level: 2, title: 'Titre', definition: 'Def', parentId: 'root', order: 0 }

  it('always shows the title', () => {
    render(<StaticCardView card={card} showDefinition={false} />)
    expect(screen.getByText('Titre')).toBeInTheDocument()
  })

  it('shows the definition only when showDefinition is true', () => {
    const { rerender } = render(<StaticCardView card={card} showDefinition={false} />)
    expect(screen.queryByText('Def')).not.toBeInTheDocument()
    rerender(<StaticCardView card={card} showDefinition={true} />)
    expect(screen.getByText('Def')).toBeInTheDocument()
  })

  it('renders no interactive elements', () => {
    render(<StaticCardView card={card} showDefinition={true} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
