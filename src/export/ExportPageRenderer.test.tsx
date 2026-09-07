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
})

describe('computePageBounds', () => {
  it('covers the widest column and the tallest row', () => {
    const bounds = computePageBounds(page)
    expect(bounds.width).toBeGreaterThan(COLUMN_WIDTH)
    expect(bounds.height).toBeGreaterThanOrEqual(ROW_HEIGHT)
  })
})
