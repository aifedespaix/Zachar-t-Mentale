import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BlockView } from './BlockView'
import type { CardBlock } from '../types/cardBlock'

const resolve = (asset: string) => `/assets/${asset}`

describe('BlockView', () => {
  it('renders a math block as typeset markup, never as its LaTeX source', () => {
    render(<BlockView blocks={[{ kind: 'math', latex: '\\frac{20}{100}' }]} resolveAsset={resolve} />)
    expect(document.querySelector('.katex')).not.toBeNull()
    expect(document.querySelector('.mfrac')).not.toBeNull()
  })

  it('reserves an image box from the stored dimensions, before any load event', () => {
    // Règle anti-décalage 5: the box must exist at first paint, so the popover
    // does not jump when the file finishes decoding.
    render(
      <BlockView
        blocks={[{ kind: 'image', asset: 'a1.png', alt: 'Schéma', width: 200, height: 100 }]}
        resolveAsset={resolve}
      />
    )
    const img = screen.getByAltText('Schéma')
    expect(img).toHaveStyle({ aspectRatio: '200 / 100' })
    expect(img).toHaveAttribute('width', '200')
    expect(img).toHaveAttribute('height', '100')
  })

  it('routes every image through resolveAsset, never through a raw path', () => {
    // This is the seam that lets the export swap in data URIs: a cross-origin
    // asset URL makes html-to-image reject the whole capture.
    render(
      <BlockView
        blocks={[{ kind: 'image', asset: 'a1.png', alt: 'S', width: 1, height: 1 }]}
        resolveAsset={a => `data:image/png;base64,AAA-${a}`}
      />
    )
    expect(screen.getByAltText('S')).toHaveAttribute('src', 'data:image/png;base64,AAA-a1.png')
  })

  it('shows a named placeholder when an asset cannot be resolved, never an empty box', () => {
    render(
      <BlockView
        blocks={[{ kind: 'image', asset: 'manquante.png', alt: '', width: 10, height: 10 }]}
        resolveAsset={() => ''}
      />
    )
    expect(screen.getByText(/manquante\.png/)).toBeInTheDocument()
  })

  it('renders a table with its header and rows', () => {
    const blocks: CardBlock[] = [
      { kind: 'table', header: ['Français', 'Anglais'], rows: [['chien', 'dog']] },
    ]
    render(<BlockView blocks={blocks} resolveAsset={resolve} />)
    expect(screen.getByText('Français')).toBeInTheDocument()
    expect(screen.getByText('dog')).toBeInTheDocument()
    expect(document.querySelectorAll('tbody tr')).toHaveLength(1)
  })

  it('renders a table that has rows but no header', () => {
    render(<BlockView blocks={[{ kind: 'table', header: [], rows: [['a', 'b']] }]} resolveAsset={resolve} />)
    expect(screen.getByText('a')).toBeInTheDocument()
    expect(document.querySelector('thead')).toBeNull()
  })

  it('preserves the newlines of a text block', () => {
    render(<BlockView blocks={[{ kind: 'text', text: 'ligne 1\nligne 2' }]} resolveAsset={resolve} />)
    expect(screen.getByText(/ligne 1/)).toHaveStyle({ whiteSpace: 'pre-wrap' })
  })

  it('does not create an element from HTML typed into a text block', () => {
    render(<BlockView blocks={[{ kind: 'text', text: '<img src=x onerror=alert(1)>' }]} resolveAsset={resolve} />)
    expect(document.querySelectorAll('img')).toHaveLength(0)
  })

  it('renders blocks in order', () => {
    const blocks: CardBlock[] = [
      { kind: 'text', text: 'avant' },
      { kind: 'math', latex: 'x' },
      { kind: 'text', text: 'après' },
    ]
    const { container } = render(<BlockView blocks={blocks} resolveAsset={resolve} />)
    expect(container.textContent!.indexOf('avant')).toBeLessThan(container.textContent!.indexOf('après'))
  })

  it('renders nothing at all for an empty block list', () => {
    const { container } = render(<BlockView blocks={[]} resolveAsset={resolve} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('BlockView — degenerate data from a shared file', () => {
  const cases: [string, number, number][] = [
    ['zéro', 0, 0],
    ['NaN', NaN, NaN],
    ['négatif', -5, 10],
    ['infini', Infinity, 1],
  ]

  it.each(cases)('does not emit an invalid aspect-ratio for %s dimensions', (_label, width, height) => {
    // An invalid aspect-ratio is dropped by the CSS parser, so `height: auto`
    // has nothing to derive from: the box collapses and jumps on decode —
    // exactly the reflow the reserved box exists to prevent.
    render(
      <BlockView blocks={[{ kind: 'image', asset: 'a.png', alt: 'S', width, height }]} resolveAsset={resolve} />
    )
    expect(screen.getByAltText('S').style.aspectRatio).toBe('')
  })

  it('gives the not-found placeholder the same width the image would take', () => {
    render(
      <BlockView
        blocks={[{ kind: 'image', asset: 'manquante.png', alt: '', width: 200, height: 100 }]}
        resolveAsset={() => ''}
      />
    )
    expect(screen.getByText(/manquante\.png/)).toHaveStyle({ width: '200px', aspectRatio: '200 / 100' })
  })

  it('wraps every block in a horizontal scroller, so wide content cannot widen the popover', () => {
    // KaTeX display math is `white-space: nowrap` and ships no scroller.
    const { container } = render(
      <BlockView blocks={[{ kind: 'math', latex: 'x', display: true }]} resolveAsset={resolve} />
    )
    expect(container.querySelector('[style*="overflow-x"]')).not.toBeNull()
  })

  it('does not throw on a formula that makes KaTeX blow the stack', () => {
    // A RangeError here would escape into React and tear down the canvas.
    const deep = '\\sqrt{'.repeat(2000) + 'a' + '}'.repeat(2000)
    expect(() =>
      render(<BlockView blocks={[{ kind: 'math', latex: deep }]} resolveAsset={resolve} />)
    ).not.toThrow()
  })
})
