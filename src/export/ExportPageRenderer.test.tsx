import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ExportPageRenderer, computePageBounds } from './ExportPageRenderer'
import type { ExportPage } from './pagination'
import { ROW_HEIGHT, COLUMN_WIDTH } from '../layout/columns'

const page: ExportPage = {
  cards: [
    { id: 'root', level: 1, title: 'Racine', parentId: null, order: 0 },
    { id: 'child', level: 2, title: 'Enfant', parentId: 'root', order: 0 },
  ],
}

describe('ExportPageRenderer', () => {
  it('renders one StaticCardView per card', () => {
    render(<ExportPageRenderer page={page} showDefinitions={false} />)
    expect(screen.getByTestId('export-card-root')).toBeInTheDocument()
    expect(screen.getByTestId('export-card-child')).toBeInTheDocument()
  })

  it('positions each card at its computeLayout coordinates', () => {
    render(<ExportPageRenderer page={page} showDefinitions={false} />)
    const childWrapper = screen.getByTestId('export-card-child').parentElement!
    expect(childWrapper.style.left).toBe(`${COLUMN_WIDTH}px`)
    expect(childWrapper.style.top).toBe('0px')
  })

  // With this 2-card root+child fixture, exactly one line is expected: the
  // root->child edge. That count of 1 (rather than 0 or 2) simultaneously
  // proves the parent-child pair produces a line AND that the root card
  // (parentId: null) never itself produces a spurious line as a "child".
  it('draws one line per parent-child relationship, and none for the root card', () => {
    const { container } = render(<ExportPageRenderer page={page} showDefinitions={false} />)
    expect(container.querySelectorAll('line')).toHaveLength(1) // root -> child
  })
})

describe('computePageBounds', () => {
  it('covers the widest column and the tallest row', () => {
    const bounds = computePageBounds(page)
    expect(bounds.width).toBeGreaterThan(COLUMN_WIDTH)
    expect(bounds.height).toBeGreaterThanOrEqual(ROW_HEIGHT)
  })
})
