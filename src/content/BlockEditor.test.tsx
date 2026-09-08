import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { BlockEditor, convertBlock } from './BlockEditor'
import type { CardBlock } from '../types/cardBlock'

/** Drives the editor as the popover does: it owns the draft, the editor edits it. */
function Harness({ initial, onState }: { initial: CardBlock[]; onState: (blocks: CardBlock[]) => void }) {
  const [blocks, setBlocks] = useState(initial)
  return (
    <BlockEditor
      blocks={blocks}
      onChange={next => {
        setBlocks(next)
        onState(next)
      }}
      resolveAsset={asset => `/a/${asset}`}
    />
  )
}

function renderEditor(initial: CardBlock[]) {
  const onState = vi.fn()
  render(<Harness initial={initial} onState={onState} />)
  // Not `.at(-1)`: the project's tsconfig lib predates it.
  const latest = () => {
    const calls = onState.mock.calls
    return calls.length === 0 ? undefined : (calls[calls.length - 1][0] as CardBlock[])
  }
  return { onState, latest }
}

describe('convertBlock', () => {
  it('round-trips text through math without losing the string', () => {
    const text: CardBlock = { kind: 'text', text: 'x^2' }
    const asMath = convertBlock(text, 'math')
    expect(asMath).toEqual({ kind: 'math', latex: 'x^2' })
    expect(convertBlock(asMath, 'text')).toEqual(text)
  })

  it('returns the same block when the kind is unchanged', () => {
    const block: CardBlock = { kind: 'math', latex: 'x' }
    expect(convertBlock(block, 'math')).toBe(block)
  })

  it('turns an empty block into a usable table rather than an empty one', () => {
    expect(convertBlock({ kind: 'text', text: '' }, 'table')).toEqual({
      kind: 'table',
      header: [],
      rows: [['', '']],
    })
  })
})

describe('the table editor', () => {
  const table: CardBlock[] = [{ kind: 'table', header: ['Français', 'Anglais'], rows: [['chien', 'dog']] }]

  it('edits a body cell without disturbing its neighbours', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor(table)

    const cell = screen.getByRole('textbox', { name: /ligne 1 colonne 2/i })
    await user.clear(cell)
    await user.type(cell, 'hound')

    expect(latest()).toEqual([{ kind: 'table', header: ['Français', 'Anglais'], rows: [['chien', 'hound']] }])
  })

  it('edits a header cell', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor(table)

    const cell = screen.getByRole('textbox', { name: /en-tête 1/i })
    await user.clear(cell)
    await user.type(cell, 'FR')

    expect((latest()![0] as { header: string[] }).header).toEqual(['FR', 'Anglais'])
  })

  it('keeps every row the same length when a column is added', async () => {
    // A ragged table renders wrong, so the invariant is worth pinning.
    const user = userEvent.setup()
    const { latest } = renderEditor(table)

    await user.click(screen.getByRole('button', { name: /ajouter une colonne/i }))

    const block = latest()![0] as { header: string[]; rows: string[][] }
    expect(block.header).toHaveLength(3)
    expect(block.rows.every(row => row.length === 3)).toBe(true)
  })

  it('adds a row at the current width', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor(table)

    await user.click(screen.getByRole('button', { name: /ajouter une ligne/i }))

    const block = latest()![0] as { rows: string[][] }
    expect(block.rows).toEqual([['chien', 'dog'], ['', '']])
  })

  it('squares up a ragged table that came from a file', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([{ kind: 'table', header: ['a', 'b', 'c'], rows: [['1'], ['2', '3']] }])

    const cell = screen.getByRole('textbox', { name: /ligne 1 colonne 1/i })
    await user.clear(cell)
    await user.type(cell, 'X')

    const block = latest()![0] as { rows: string[][] }
    expect(block.rows.every(row => row.length === 3)).toBe(true)
  })
})

describe('the mode selector follows the right block', () => {
  it('acts on the block the user last focused, not always the first', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([
      { kind: 'text', text: 'premier' },
      { kind: 'text', text: 'second' },
    ])

    await user.click(screen.getByRole('textbox', { name: /texte du bloc 2/i }))
    await user.click(screen.getByRole('button', { name: /^formule$/i }))

    expect(latest()).toEqual([
      { kind: 'text', text: 'premier' },
      { kind: 'math', latex: 'second' },
    ])
  })

  it('does not act on a stale index after the active block is removed', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([
      { kind: 'text', text: 'un' },
      { kind: 'text', text: 'deux' },
      { kind: 'text', text: 'trois' },
    ])

    await user.click(screen.getByRole('textbox', { name: /texte du bloc 3/i }))
    await user.click(screen.getByRole('button', { name: /supprimer le bloc 3/i }))
    await user.click(screen.getByRole('button', { name: /^formule$/i }))

    // Whatever it converts, it must be a block that still exists — and it must
    // not throw on an out-of-range index.
    const blocks = latest()!
    expect(blocks).toHaveLength(2)
    expect(blocks.filter(block => block.kind === 'math')).toHaveLength(1)
  })

  it('creates a block when the list is empty instead of doing nothing', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([])

    await user.click(screen.getByRole('button', { name: /^formule$/i }))

    expect(latest()).toEqual([{ kind: 'math', latex: '' }])
  })
})

describe('the math field', () => {
  it('previews the formula as it is typed, synchronously', async () => {
    const user = userEvent.setup()
    renderEditor([{ kind: 'math', latex: '' }])

    await user.type(screen.getByRole('textbox', { name: /formule du bloc 1/i }), 'x^2')

    expect(screen.getByTestId('math-preview-0').querySelector('.katex')).not.toBeNull()
  })

  it('does not tear down on a formula KaTeX cannot handle', () => {
    const deep = '\\sqrt{'.repeat(2000) + 'a' + '}'.repeat(2000)
    expect(() => renderEditor([{ kind: 'math', latex: deep }])).not.toThrow()
  })
})

describe('inserting an image', () => {
  function renderWithImages(overrides: {
    onInsertImage?: (s: { bytes: Uint8Array; mime: string; name?: string }) => Promise<CardBlock | undefined>
    onPickImage?: () => Promise<CardBlock | undefined>
    onError?: (m: string) => void
  }) {
    const onState = vi.fn()
    function Host() {
      const [blocks, setBlocks] = useState<CardBlock[]>([{ kind: 'text', text: 'Une règle' }])
      return (
        <BlockEditor
          blocks={blocks}
          onChange={next => {
            setBlocks(next)
            onState(next)
          }}
          resolveAsset={a => `/a/${a}`}
          {...overrides}
        />
      )
    }
    render(<Host />)
    const latest = () => {
      const calls = onState.mock.calls
      return calls.length === 0 ? undefined : (calls[calls.length - 1][0] as CardBlock[])
    }
    return { latest }
  }

  const block: CardBlock = { kind: 'image', asset: 'a1.png', alt: 'Schéma', width: 200, height: 100 }

  it('appends the block the picker produced, keeping what was already there', async () => {
    const user = userEvent.setup()
    const { latest } = renderWithImages({ onPickImage: async () => block })

    await user.click(screen.getByRole('button', { name: /insérer une image/i }))

    expect(latest()).toEqual([{ kind: 'text', text: 'Une règle' }, block])
  })

  it('inserts nothing when the picker is cancelled', async () => {
    const user = userEvent.setup()
    const { latest } = renderWithImages({ onPickImage: async () => undefined })

    await user.click(screen.getByRole('button', { name: /insérer une image/i }))

    expect(latest()).toBeUndefined()
  })

  it('reports a storage failure instead of failing silently', async () => {
    const user = userEvent.setup()
    const onError = vi.fn()
    renderWithImages({
      onPickImage: async () => {
        throw new Error('Image trop volumineuse')
      },
      onError,
    })

    await user.click(screen.getByRole('button', { name: /insérer une image/i }))

    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/volumineuse/))
  })

  it('hides the affordance entirely when the host cannot store images', () => {
    renderWithImages({})
    expect(screen.queryByRole('button', { name: /insérer une image/i })).not.toBeInTheDocument()
  })

  it('inserts an image pasted into the editor', async () => {
    const onInsertImage = vi.fn(async () => block)
    const { latest } = renderWithImages({ onInsertImage })

    const file = new File([new Uint8Array([1, 2, 3])], 'capture.png', { type: 'image/png' })
    fireEvent.paste(screen.getByRole('textbox', { name: /texte du bloc 1/i }), {
      clipboardData: {
        items: [{ type: 'image/png', getAsFile: () => file }],
      },
    })

    await waitFor(() => expect(latest()).toEqual([{ kind: 'text', text: 'Une règle' }, block]))
  })

  it('leaves an ordinary text paste alone', async () => {
    const onInsertImage = vi.fn()
    const { latest } = renderWithImages({ onInsertImage })

    fireEvent.paste(screen.getByRole('textbox', { name: /texte du bloc 1/i }), {
      clipboardData: { items: [{ type: 'text/plain', getAsFile: () => null }] },
    })

    expect(onInsertImage).not.toHaveBeenCalled()
    expect(latest()).toBeUndefined()
  })

  it('lets the description of an image block be edited', async () => {
    const user = userEvent.setup()
    const onState = vi.fn()
    function Host() {
      const [blocks, setBlocks] = useState<CardBlock[]>([block])
      return (
        <BlockEditor
          blocks={blocks}
          onChange={next => {
            setBlocks(next)
            onState(next)
          }}
          resolveAsset={a => `/a/${a}`}
        />
      )
    }
    render(<Host />)

    const field = screen.getByRole('textbox', { name: /description de l’image/i })
    await user.clear(field)
    await user.type(field, 'Cycle de l’eau')

    const calls = onState.mock.calls
    expect((calls[calls.length - 1][0] as CardBlock[])[0]).toMatchObject({ alt: 'Cycle de l’eau' })
  })
})
