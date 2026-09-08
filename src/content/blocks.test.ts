import { describe, it, expect } from 'vitest'
import { blocksToPlainText, latexToPlainText, normalizeContent, contentOf } from './blocks'
import type { CardBlock } from '../types/cardBlock'
import type { Card } from '../types/card'

describe('latexToPlainText', () => {
  it('renders the common collège forms in unicode', () => {
    expect(latexToPlainText('\\frac{20}{100} \\times 425')).toBe('20/100 × 425')
    expect(latexToPlainText('x^2 + \\sqrt{2}')).toBe('x² + √2')
    expect(latexToPlainText('a \\div b \\leq c')).toBe('a ÷ b ≤ c')
  })

  it('maps a multi-digit exponent digit by digit', () => {
    expect(latexToPlainText('x^{12}')).toBe('x¹²')
  })

  it('falls back to the raw LaTeX rather than losing anything it cannot map', () => {
    // The contract is "never an empty field", not "faithful rendering": an
    // unmapped command must still be readable, not silently dropped.
    expect(latexToPlainText('\\oint_C \\vec{F}')).toContain('oint')
  })
})

describe('blocksToPlainText', () => {
  it('never yields an empty string for a card that holds only an image', () => {
    const blocks: CardBlock[] = [
      { kind: 'image', asset: 'a1.png', alt: 'Cycle de l’eau', width: 200, height: 90 },
    ]
    expect(blocksToPlainText(blocks)).toBe('[image : Cycle de l’eau]')
  })

  it('names an image by its asset when it has no alt text', () => {
    const blocks: CardBlock[] = [{ kind: 'image', asset: 'a1.png', alt: '', width: 1, height: 1 }]
    expect(blocksToPlainText(blocks)).toBe('[image : a1.png]')
  })

  it('joins mixed blocks in order', () => {
    const blocks: CardBlock[] = [
      { kind: 'text', text: 'On garde le signe du plus éloigné de zéro.' },
      { kind: 'math', latex: '(+10) + (-4) = +6' },
    ]
    expect(blocksToPlainText(blocks)).toBe(
      'On garde le signe du plus éloigné de zéro.\n(+10) + (-4) = +6'
    )
  })

  it('joins a table row by row, cells separated by a pipe', () => {
    const blocks: CardBlock[] = [
      { kind: 'table', header: ['Français', 'Anglais'], rows: [['chien', 'dog'], ['chat', 'cat']] },
    ]
    expect(blocksToPlainText(blocks)).toBe('Français | Anglais\nchien | dog\nchat | cat')
  })

  it('is empty for no blocks at all', () => {
    expect(blocksToPlainText([])).toBe('')
  })
})

describe('normalizeContent', () => {
  it('stores a lone text block as `definition` only, so an existing file gains no `content`', () => {
    expect(normalizeContent([{ kind: 'text', text: 'Un nombre positif, négatif, ou zéro.' }])).toEqual({
      definition: 'Un nombre positif, négatif, ou zéro.',
    })
  })

  it('drops empty blocks, and yields neither field when nothing is left', () => {
    expect(normalizeContent([{ kind: 'text', text: '   ' }])).toEqual({})
    expect(normalizeContent([])).toEqual({})
  })

  it('keeps `content` and derives `definition` as soon as a block is not plain text', () => {
    const blocks: CardBlock[] = [{ kind: 'math', latex: 'x^2' }]
    expect(normalizeContent(blocks)).toEqual({ content: blocks, definition: 'x²' })
  })

  it('preserves block order', () => {
    const blocks: CardBlock[] = [
      { kind: 'text', text: 'a' },
      { kind: 'math', latex: 'b' },
      { kind: 'text', text: 'c' },
    ]
    expect(normalizeContent(blocks).content).toEqual(blocks)
  })

  it('collapses to a definition when every non-text block is emptied out', () => {
    // Editing a formula down to nothing must leave a plain-text card behind,
    // not a card carrying a `content` array of one leftover text block.
    const blocks: CardBlock[] = [{ kind: 'text', text: 'Une règle' }, { kind: 'math', latex: '  ' }]
    expect(normalizeContent(blocks)).toEqual({ definition: 'Une règle' })
  })

  it('drops an image block with no asset rather than emitting a broken reference', () => {
    expect(normalizeContent([{ kind: 'image', asset: '', alt: 'x', width: 1, height: 1 }])).toEqual({})
  })

  it('drops a table with no cells but keeps one that has content', () => {
    expect(normalizeContent([{ kind: 'table', header: [], rows: [] }])).toEqual({})
    const table: CardBlock[] = [{ kind: 'table', header: ['a'], rows: [['b']] }]
    expect(normalizeContent(table)).toEqual({ content: table, definition: 'a\nb' })
  })
})

describe('contentOf', () => {
  const base: Card = { id: 'a', level: 2, title: 'T', parentId: 'r', order: 0 }

  it('presents a legacy definition-only card as one text block', () => {
    expect(contentOf({ ...base, definition: 'Règle' })).toEqual([{ kind: 'text', text: 'Règle' }])
  })

  it('returns the blocks when the card carries content', () => {
    const content: CardBlock[] = [{ kind: 'math', latex: 'x^2' }]
    expect(contentOf({ ...base, content, definition: 'x²' })).toEqual(content)
  })

  it('is empty for a card with no definition at all', () => {
    expect(contentOf(base)).toEqual([])
  })
})
