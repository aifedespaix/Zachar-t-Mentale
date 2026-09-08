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

describe('contentOf — degrading unknown blocks at READ time', () => {
  const base: Card = { id: 'a', level: 2, title: 'T', parentId: 'r', order: 0 }

  it('degrades a block kind it does not know to text, keeping its readable payload', () => {
    // A `music` block written by a later version: rendering it is impossible
    // here, losing it would be worse.
    const card = { ...base, content: [{ kind: 'music', abc: 'X:1\nK:C' }] as never, definition: '[partition]' }
    expect(contentOf(card)).toEqual([{ kind: 'text', text: 'X:1\nK:C' }])
  })

  it('does NOT mutate the card, so the unknown block survives the next autosave', () => {
    // The load path validates but never transforms, and autosave rewrites the
    // whole file — degrading in place would silently destroy forward content.
    const content = [{ kind: 'music', abc: 'X:1' }] as never
    const card = { ...base, content }
    contentOf(card)
    expect(card.content).toBe(content)
    expect(card.content![0]).toEqual({ kind: 'music', abc: 'X:1' })
  })

  it('drops a known block whose payload is malformed rather than rendering it', () => {
    const card = { ...base, content: [{ kind: 'image', alt: 'x' }] as never }
    expect(contentOf(card)).toEqual([])
  })

  it('drops an unknown block that carries no readable string at all', () => {
    const card = { ...base, content: [{ kind: 'widget', level: 3 }] as never }
    expect(contentOf(card)).toEqual([])
  })

  it('keeps well-formed blocks untouched alongside a degraded one', () => {
    const card = {
      ...base,
      content: [{ kind: 'math', latex: 'x^2' }, { kind: 'music', abc: 'X:1' }] as never,
    }
    expect(contentOf(card)).toEqual([
      { kind: 'math', latex: 'x^2' },
      { kind: 'text', text: 'X:1' },
    ])
  })
})

describe('the definition/content invariant', () => {
  // The single property the whole design rests on, asserted directly: after any
  // write, `definition` is exactly the plain-text projection of `content`.
  const cases: CardBlock[][] = [
    [{ kind: 'text', text: 'Une règle' }],
    [{ kind: 'math', latex: '\\frac{20}{100} \\times 425' }],
    [{ kind: 'image', asset: 'a1.png', alt: 'Schéma', width: 10, height: 5 }],
    [{ kind: 'table', header: ['a', 'b'], rows: [['1', '2']] }],
    [{ kind: 'text', text: 'Règle' }, { kind: 'math', latex: 'x^2' }],
    [{ kind: 'text', text: 'garder' }, { kind: 'math', latex: '   ' }],
  ]

  it.each(cases)('holds for %j', (...blocks) => {
    const { content, definition } = normalizeContent(blocks as CardBlock[])
    const card: Card = { id: 'a', level: 2, title: 'T', parentId: 'r', order: 0, content, definition }
    expect(definition).toBe(blocksToPlainText(contentOf(card)))
  })

  it('holds after a JSON save/load round-trip', () => {
    const { content, definition } = normalizeContent([
      { kind: 'math', latex: 'x^2' },
      { kind: 'image', asset: 'a.png', alt: 'S', width: 10, height: 5 },
    ])
    const card = JSON.parse(
      JSON.stringify({ id: 'a', level: 2, title: 'T', parentId: 'r', order: 0, content, definition })
    ) as Card
    expect(card.definition).toBe(blocksToPlainText(contentOf(card)))
  })
})

describe('normalizeContent does not alias the caller’s blocks', () => {
  it('a later mutation of the draft cannot reach the stored content', () => {
    // The editor holds a live draft array; sharing its objects would let a
    // keystroke mutate an already-written card and every undo snapshot with it.
    const draft: CardBlock[] = [{ kind: 'math', latex: 'x^2' }, { kind: 'text', text: 'note' }]
    const { content, definition } = normalizeContent(draft)
    ;(draft[0] as { latex: string }).latex = 'MUTÉ'
    expect(content![0]).toEqual({ kind: 'math', latex: 'x^2' })
    expect(definition).toBe('x²\nnote')
  })

  it('a table’s rows are copied, not shared', () => {
    const draft: CardBlock[] = [{ kind: 'table', header: ['a'], rows: [['1']] }]
    const { content } = normalizeContent(draft)
    ;(draft[0] as { rows: string[][] }).rows[0][0] = 'MUTÉ'
    expect((content![0] as { rows: string[][] }).rows[0][0]).toBe('1')
  })

  it('contentOf does not share a table’s rows with the card', () => {
    const card: Card = {
      id: 'a', level: 2, title: 'T', parentId: 'r', order: 0,
      content: [{ kind: 'table', header: ['a'], rows: [['1']] }], definition: 'a\n1',
    }
    const got = contentOf(card) as { rows: string[][] }[]
    got[0].rows[0][0] = 'MUTÉ'
    expect((card.content![0] as { rows: string[][] }).rows[0][0]).toBe('1')
  })
})

describe('latexToPlainText — command boundaries and exponents', () => {
  it('does not let a short command eat a longer one sharing its prefix', () => {
    expect(latexToPlainText('\\top')).toBe('top')
    expect(latexToPlainText('\\cdots')).toBe('cdots')
    expect(latexToPlainText('\\leqslant')).toBe('leqslant')
    expect(latexToPlainText('\\pmod{n}')).toBe('pmodn')
  })

  it('keeps the grouping of an exponent it cannot map to unicode', () => {
    // `x^{2x}` must not become `x^2x`, which reads as x² · x.
    expect(latexToPlainText('x^{2x}')).toBe('x^(2x)')
  })
})

describe('contentOf falls back rather than rendering blank', () => {
  const base: Card = { id: 'a', level: 2, title: 'T', parentId: 'r', order: 0 }

  it('uses the definition when content is present but empty', () => {
    expect(contentOf({ ...base, content: [], definition: 'Règle' })).toEqual([{ kind: 'text', text: 'Règle' }])
  })

  it('uses the definition when every block was unreadable', () => {
    const card = { ...base, content: [{ kind: 'audio', duration: 30 }] as never, definition: '[audio]' }
    expect(contentOf(card)).toEqual([{ kind: 'text', text: '[audio]' }])
  })
})
