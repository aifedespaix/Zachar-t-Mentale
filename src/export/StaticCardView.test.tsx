import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StaticCardView, EXPORT_CARD_MAX_HEIGHT } from './StaticCardView'
import { ROW_HEIGHT } from '../layout/columns'
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

describe('StaticCardView — rich content', () => {
  const base: Card = { id: 'c1', level: 2, title: 'Avec calculatrice', parentId: 'root', order: 0 }

  it('typesets a formula rather than exporting its plain-text mirror', () => {
    // Before this, the PDF showed the degraded unicode projection ("20/100 ×
    // 425") while the app showed a stacked fraction — the very drift the
    // shared renderer exists to prevent.
    const card: Card = { ...base, content: [{ kind: 'math', latex: '\\frac{20}{100}' }], definition: '20/100' }
    render(<StaticCardView card={card} showDefinition />)
    expect(document.querySelector('.mfrac')).not.toBeNull()
  })

  it('renders a table', () => {
    const card: Card = {
      ...base,
      content: [{ kind: 'table', header: ['FR', 'EN'], rows: [['chien', 'dog']] }],
      definition: 'FR | EN\nchien | dog',
    }
    render(<StaticCardView card={card} showDefinition />)
    expect(screen.getByText('dog')).toBeInTheDocument()
  })

  it('still renders a legacy definition-only card', () => {
    render(<StaticCardView card={{ ...base, definition: 'Une règle' }} showDefinition />)
    expect(screen.getByText('Une règle')).toBeInTheDocument()
  })

  it('hides rich content too when definitions are off', () => {
    const card: Card = { ...base, content: [{ kind: 'math', latex: 'x^2' }], definition: 'x²' }
    render(<StaticCardView card={card} showDefinition={false} />)
    expect(document.querySelector('.katex')).toBeNull()
  })

  it('names an image it cannot resolve instead of leaving a blank gap', () => {
    const card: Card = {
      ...base,
      content: [{ kind: 'image', asset: 'schema.png', alt: 'Schéma', width: 100, height: 50 }],
      definition: '[image : Schéma]',
    }
    render(<StaticCardView card={card} showDefinition />)
    expect(screen.getByText(/schema\.png/)).toBeInTheDocument()
  })

  it('routes images through resolveAsset, so the export can inline data URIs', () => {
    const card: Card = {
      ...base,
      content: [{ kind: 'image', asset: 'a.png', alt: 'S', width: 10, height: 5 }],
      definition: '[image : S]',
    }
    render(<StaticCardView card={card} showDefinition resolveAsset={a => `data:image/png;base64,X-${a}`} />)
    expect(screen.getByAltText('S')).toHaveAttribute('src', 'data:image/png;base64,X-a.png')
  })
})

describe('StaticCardView — the height cap that keeps the export grid valid', () => {
  it('can never grow past the layout row pitch', () => {
    // `computeLayout` places rows on a fixed ROW_HEIGHT grid and measures
    // nothing, so a card taller than the pitch silently covers its neighbour.
    // Capping here is also what lets the existing leaf-count pagination budget
    // stay correct — see the plan's "simplification" section.
    expect(EXPORT_CARD_MAX_HEIGHT).toBeLessThan(ROW_HEIGHT)
  })

  it('applies the cap and clips rather than overflowing', () => {
    const card: Card = {
      id: 'c1', level: 2, title: 'T', parentId: 'root', order: 0,
      content: [{ kind: 'text', text: 'ligne\n'.repeat(80) }],
      definition: 'ligne',
    }
    render(<StaticCardView card={card} showDefinition />)
    const element = screen.getByTestId('export-card-c1')
    expect(element).toHaveStyle({ maxHeight: `${EXPORT_CARD_MAX_HEIGHT}px`, overflow: 'hidden' })
  })
})
