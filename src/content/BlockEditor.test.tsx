import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { BlockEditor, convertBlock } from './BlockEditor'
import type { CardBlock } from '../types/cardBlock'

// The WYSIWYG field is MathLive's concern, covered in MathFieldEditor.test.tsx.
// Here it always renders its fallback, so these tests exercise BlockEditor
// rather than depending on whether a 5.7 MB dynamic import happened to resolve
// during an earlier test in this file.
vi.mock('./MathFieldEditor', () => ({
  MathFieldEditor: ({ fallback }: { fallback: React.ReactNode }) => fallback,
}))

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

  it('refuses to convert an image away, rather than destroying the asset reference', () => {
    // Règle 6 says switching mode never destroys content, and there is no mode
    // that produces an image back — so converting one away is one-way loss.
    const image: CardBlock = { kind: 'image', asset: 'a3f9.png', alt: 'Schéma', width: 10, height: 5 }
    expect(convertBlock(image, 'text')).toBe(image)
    expect(convertBlock(image, 'math')).toBe(image)
    expect(convertBlock(image, 'table')).toBe(image)
  })

  it('carries a table’s header across a conversion, not just its rows', () => {
    const table: CardBlock = { kind: 'table', header: ['FR', 'EN'], rows: [['chien', 'dog']] }
    expect(convertBlock(table, 'text')).toEqual({ kind: 'text', text: 'FR\tEN\nchien\tdog' })
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

describe('the type switch, carried by each block', () => {
  it('switches the block whose own button was used, not always the first one', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([
      { kind: 'text', text: 'premier' },
      { kind: 'text', text: 'second' },
    ])

    await user.click(screen.getByRole('button', { name: /type du bloc 2/i }))
    await user.click(screen.getByRole('menuitem', { name: /formule/i }))

    expect(latest()).toEqual([
      { kind: 'text', text: 'premier' },
      { kind: 'math', latex: 'second' },
    ])
  })

  it('shows the block’s CURRENT type on its own button, so the list can be read at a glance', () => {
    renderEditor([
      { kind: 'text', text: 'une règle' },
      { kind: 'math', latex: 'x^2' },
    ])

    expect(screen.getByRole('button', { name: /type du bloc 1 : texte/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /type du bloc 2 : formule/i })).toBeInTheDocument()
  })

  it('acts on a block that still exists after another one is removed', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([
      { kind: 'text', text: 'un' },
      { kind: 'text', text: 'deux' },
      { kind: 'text', text: 'trois' },
    ])

    await user.click(screen.getByRole('button', { name: /supprimer le bloc 3/i }))
    // Each switch is drawn on its own block: there is no remembered index left
    // pointing past the end of the list.
    await user.click(screen.getByRole('button', { name: /type du bloc 2/i }))
    await user.click(screen.getByRole('menuitem', { name: /formule/i }))

    const blocks = latest()!
    expect(blocks).toHaveLength(2)
    expect(blocks.filter(block => block.kind === 'math')).toHaveLength(1)
  })

  it('is inert on an image block instead of silently dropping the picture', () => {
    renderEditor([{ kind: 'image', asset: 'a3f9.png', alt: 'Schéma', width: 10, height: 5 }])

    expect(screen.getByRole('button', { name: /type du bloc 1 : image/i })).toBeDisabled()
  })

  it('starts a block when the list is empty instead of doing nothing', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([])

    await user.click(screen.getByRole('button', { name: /ajouter un bloc/i }))

    expect(latest()).toEqual([{ kind: 'text', text: '' }])
  })

  it('grows a text block into a table instead of converting it, since it already was a 1×1 one', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([{ kind: 'text', text: 'chien' }])

    await user.click(screen.getByRole('button', { name: /transformer le bloc 1 en tableau/i }))

    // The note is still there, in the first cell; the second column is the one
    // that was just asked for, and it comes up empty and ready.
    expect(latest()).toEqual([{ kind: 'table', header: [], rows: [['chien', '']] }])
  })

  it('keeps a table’s header empty through the column edits, so no blank band appears', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([{ kind: 'text', text: 'chien' }])

    await user.click(screen.getByRole('button', { name: /transformer le bloc 1 en tableau/i }))
    await user.click(screen.getByRole('button', { name: /ajouter une colonne/i }))

    expect((latest()![0] as { header: string[] }).header).toEqual([])
  })
})

describe('the math field', () => {
  it('previews the formula as it is typed, synchronously', async () => {
    const user = userEvent.setup()
    renderEditor([{ kind: 'math', latex: '' }])

    await user.type(screen.getByRole('textbox', { name: /formule du bloc 1 \(latex\)/i }), 'x^2')

    expect(screen.getByTestId('math-preview-0').querySelector('.katex')).not.toBeNull()
  })

  it('does not tear down on a formula KaTeX cannot handle', () => {
    const deep = '\\sqrt{'.repeat(2000) + 'a' + '}'.repeat(2000)
    expect(() => renderEditor([{ kind: 'math', latex: deep }])).not.toThrow()
  })
})

describe('the character palette, in the footer of the text block', () => {
  it('offers the languages straight away, and no character until one is chosen', () => {
    renderEditor([{ kind: 'text', text: '' }])

    // No button to open first: the palette is the block's footer, so it is
    // there the moment the block is.
    expect(screen.getByRole('group', { name: /choix de la langue/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /point d’interrogation inversé/i })).not.toBeInTheDocument()
  })

  it('shows the Spanish punctuation a French keyboard cannot produce', async () => {
    const user = userEvent.setup()
    renderEditor([{ kind: 'text', text: '' }])

    await user.click(screen.getByRole('button', { name: /langue : espagnol/i }))

    expect(screen.getByRole('button', { name: /point d’interrogation inversé/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /point d’exclamation inversé/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /eñe$/i })).toBeInTheDocument()
    // The English set is not on screen: one language's characters at a time.
    expect(screen.queryByRole('button', { name: /livre sterling/i })).not.toBeInTheDocument()
  })

  it('shows the English typography, which is what a French keyboard gets wrong there', async () => {
    const user = userEvent.setup()
    renderEditor([{ kind: 'text', text: '' }])

    await user.click(screen.getByRole('button', { name: /langue : anglais/i }))

    expect(screen.getByRole('button', { name: /apostrophe anglaise/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /point d’interrogation inversé/i })).not.toBeInTheDocument()
  })

  it('shows the French ligatures, which no keyboard has a key for', async () => {
    const user = userEvent.setup()
    renderEditor([{ kind: 'text', text: '' }])

    await user.click(screen.getByRole('button', { name: /langue : français/i }))

    expect(screen.getByRole('button', { name: 'o et e liés (cœur)' })).toBeInTheDocument()
  })

  it('inserts the character into the text being written, without replacing it', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([{ kind: 'text', text: 'don' }])

    await user.click(screen.getByRole('button', { name: /langue : anglais/i }))
    await user.click(screen.getByRole('button', { name: /apostrophe anglaise/i }))

    const written = (latest()![0] as { text: string }).text
    expect(written).toContain('’')
    expect(written.replace('’', '')).toBe('don')
  })

  it('puts the palette under the block being written in, and nowhere else', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([
      { kind: 'text', text: 'premier' },
      { kind: 'text', text: 'second' },
    ])

    // Block 1 owns the footer while it is the active one.
    expect(screen.getAllByRole('group', { name: /choix de la langue/i })).toHaveLength(1)

    await user.click(screen.getByRole('textbox', { name: /texte du bloc 2/i }))
    await user.click(screen.getByRole('button', { name: /langue : espagnol/i }))
    await user.click(screen.getByRole('button', { name: /eñe$/i }))

    const blocks = latest()!
    expect(blocks[0]).toEqual({ kind: 'text', text: 'premier' })
    expect((blocks[1] as { text: string }).text).toContain('ñ')
  })

  it('is not shown at all when the description has no text block to write in', () => {
    renderEditor([{ kind: 'math', latex: 'x' }])

    expect(screen.queryByRole('group', { name: /choix de la langue/i })).not.toBeInTheDocument()
  })

  it('shows both signs on the button, and no longer offers the closing one alone', async () => {
    const user = userEvent.setup()
    renderEditor([{ kind: 'text', text: '' }])

    await user.click(screen.getByRole('button', { name: /langue : espagnol/i }))

    expect(screen.getByRole('button', { name: /point d’interrogation inversé/i })).toHaveTextContent('¿ ?')
    expect(screen.queryByRole('button', { name: /guillemet fermant/i })).not.toBeInTheDocument()
  })

  it('writes the closing sign itself, and leaves the caret between the two', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([{ kind: 'text', text: '' }])

    await user.click(screen.getByRole('button', { name: /langue : espagnol/i }))
    await user.click(screen.getByRole('button', { name: /point d’interrogation inversé/i }))

    expect((latest()![0] as { text: string }).text).toBe('¿?')
    const field = screen.getByRole('textbox', { name: /texte du bloc 1/i }) as HTMLTextAreaElement
    expect(field.selectionStart).toBe(1)
  })

  it('surrounds the selected text instead of writing over it', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([{ kind: 'text', text: 'Cómo estás' }])

    const field = screen.getByRole('textbox', { name: /texte du bloc 1/i }) as HTMLTextAreaElement
    field.focus()
    field.setSelectionRange(0, 10)

    await user.click(screen.getByRole('button', { name: /langue : espagnol/i }))
    await user.click(screen.getByRole('button', { name: /point d’interrogation inversé/i }))

    expect((latest()![0] as { text: string }).text).toBe('¿Cómo estás?')
  })

  it('spaces the guillemets inside, unlike the inverted signs', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([{ kind: 'text', text: '' }])

    await user.click(screen.getByRole('button', { name: /langue : espagnol/i }))
    await user.click(screen.getByRole('button', { name: /guillemet ouvrant/i }))

    expect((latest()![0] as { text: string }).text).toBe('«  »')
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
