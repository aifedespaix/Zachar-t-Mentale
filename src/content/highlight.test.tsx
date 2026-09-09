import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { renderHighlighted, stripHighlightMarkers } from './highlight'

describe('stripHighlightMarkers', () => {
  it('removes the double-asterisk markers, keeping the marked words', () => {
    expect(stripHighlightMarkers('Le **noyau** contrôle la cellule.')).toBe('Le noyau contrôle la cellule.')
  })

  it('leaves plain text with no markers untouched', () => {
    expect(stripHighlightMarkers('Rien à marquer ici.')).toBe('Rien à marquer ici.')
  })

  it('strips several markers in the same string', () => {
    expect(stripHighlightMarkers('**A** puis **B**')).toBe('A puis B')
  })
})

describe('renderHighlighted', () => {
  it('wraps a marked word in a <mark>, leaving the rest as plain text', () => {
    render(<>{renderHighlighted('Le **noyau** contrôle la cellule.')}</>)
    const mark = screen.getByText('noyau')
    expect(mark.tagName).toBe('MARK')
    expect(screen.getByText('contrôle la cellule.', { exact: false })).toBeInTheDocument()
  })

  it('handles several marked words in the same string', () => {
    render(<>{renderHighlighted('**A** et **B**')}</>)
    expect(screen.getByText('A').tagName).toBe('MARK')
    expect(screen.getByText('B').tagName).toBe('MARK')
  })

  it('renders unmarked text unchanged', () => {
    render(<>{renderHighlighted('Rien de marqué')}</>)
    expect(screen.getByText('Rien de marqué')).toBeInTheDocument()
  })
})
