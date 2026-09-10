import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { DescriptionDialog } from './DescriptionDialog'
import type { CardBlock } from '../types/cardBlock'

// MathLive genuinely resolves under jsdom, which would make these tests depend
// on execution order: the first math block mounts before the import settles and
// gets the raw-LaTeX field, every later one gets a `<math-field>` element with
// no textbox to drive. Failing the import pins every block to the raw path —
// deterministic here, and the path the palette must keep working through
// anyway, since it is what a user gets if MathLive never loads.
vi.mock('mathlive', () => {
  throw new Error('MathLive is not exercised under jsdom')
})

const text = (value: string): CardBlock[] => [{ kind: 'text', text: value }]

function renderDialog(overrides: Partial<React.ComponentProps<typeof DescriptionDialog>> = {}) {
  const props = {
    breadcrumb: ['Nombres relatifs', 'Addition'],
    cardTitle: 'Signes contraires',
    blocks: text('Une définition'),
    onSave: vi.fn(),
    onClose: vi.fn(),
    resolveAsset: () => '',
    ...overrides,
  }
  render(<DescriptionDialog {...props} />)
  return props
}

describe('DescriptionDialog', () => {
  it('says which card is being edited, ancestors included', () => {
    renderDialog()

    expect(screen.getByText('Signes contraires')).toBeInTheDocument()
    // The breadcrumb is what makes the card unambiguous when the editor opens
    // over a canvas of near-identical boxes.
    expect(screen.getByText('Nombres relatifs › Addition')).toBeInTheDocument()
  })

  it('opens an empty card on a field to type in rather than on nothing', () => {
    renderDialog({ blocks: [] })

    expect(screen.getByRole('textbox', { name: /texte du bloc 1/i })).toHaveValue('')
  })

  it('opens with the caret already in the text field', () => {
    // Radix focuses the first tabbable element of a dialog, which here is the
    // « Texte » mode button: without this the dialog opened on a button and the
    // first keystroke went nowhere.
    renderDialog()

    expect(screen.getByRole('textbox', { name: /texte du bloc 1/i })).toHaveFocus()
  })

  it('puts the caret at the end of an existing description, so carrying on does not overwrite it', () => {
    renderDialog({ blocks: text('Une définition') })

    const field = screen.getByRole('textbox', { name: /texte du bloc 1/i }) as HTMLTextAreaElement
    expect(field).toHaveFocus()
    expect(field.selectionStart).toBe('Une définition'.length)
  })

  it('focuses the first text block even when the description opens on a formula', () => {
    // The language and typing aids live on the text field; a description whose
    // first block is a formula still has to be typed into somewhere.
    renderDialog({
      blocks: [
        { kind: 'math', latex: 'x^2' },
        { kind: 'text', text: 'Et sa règle' },
      ],
    })

    expect(screen.getByRole('textbox', { name: /texte du bloc 2/i })).toHaveFocus()
  })

  it('inserts a Spanish character from the language palette into the text field', async () => {
    const user = userEvent.setup()
    const props = renderDialog({ blocks: text('Como estas') })

    await user.click(screen.getByRole('button', { name: /choisir une langue/i }))
    await user.click(screen.getByRole('button', { name: /langue : espagnol/i }))
    await user.click(screen.getByRole('button', { name: /point d’interrogation inversé/i }))
    await user.click(screen.getByRole('button', { name: /^enregistrer$/i }))

    // Appended at the caret the dialog opened on (the end of the text), not
    // replacing it: the palette never took focus out of the field.
    expect(props.onSave).toHaveBeenCalledWith([{ kind: 'text', text: 'Como estas¿' }])
  })

  it('saves the edited blocks and closes', async () => {
    const user = userEvent.setup()
    const props = renderDialog()

    const field = screen.getByRole('textbox', { name: /texte du bloc 1/i })
    await user.clear(field)
    await user.type(field, 'Définition modifiée')
    await user.click(screen.getByRole('button', { name: /^enregistrer$/i }))

    expect(props.onSave).toHaveBeenCalledWith([{ kind: 'text', text: 'Définition modifiée' }])
    expect(props.onClose).toHaveBeenCalled()
  })

  it('saves on Ctrl+Enter, which plain Enter cannot do inside a textarea', async () => {
    const user = userEvent.setup()
    const props = renderDialog()

    await user.click(screen.getByRole('textbox', { name: /texte du bloc 1/i }))
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(props.onSave).toHaveBeenCalledWith([{ kind: 'text', text: 'Une définition' }])
  })

  it('closes without asking when nothing was changed', async () => {
    const user = userEvent.setup()
    const props = renderDialog()

    await user.click(screen.getByRole('button', { name: /^annuler$/i }))

    expect(props.onClose).toHaveBeenCalled()
    expect(props.onSave).not.toHaveBeenCalled()
  })

  it('asks before discarding real work', async () => {
    // The popover this replaces committed on click-away. That trade is right
    // for a two-line field and wrong for a surface someone sits in for twenty
    // minutes, so closing discards — and discarding asks.
    const user = userEvent.setup()
    const props = renderDialog()

    await user.type(screen.getByRole('textbox', { name: /texte du bloc 1/i }), ' modifiée')
    await user.click(screen.getByRole('button', { name: /^annuler$/i }))

    expect(props.onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /fermer sans enregistrer/i }))
    expect(props.onClose).toHaveBeenCalled()
    expect(props.onSave).not.toHaveBeenCalled()
  })

  it('treats a change typed and undone as no change at all', async () => {
    const user = userEvent.setup()
    const props = renderDialog()

    const field = screen.getByRole('textbox', { name: /texte du bloc 1/i })
    await user.type(field, 'x')
    await user.keyboard('{Backspace}')
    await user.click(screen.getByRole('button', { name: /^annuler$/i }))

    // A referential dirty check would have raised the prompt here.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(props.onClose).toHaveBeenCalled()
  })

  it('keeps editing when Escape is pressed on the discard prompt', async () => {
    const user = userEvent.setup()
    const props = renderDialog()

    await user.type(screen.getByRole('textbox', { name: /texte du bloc 1/i }), ' modifiée')
    await user.click(screen.getByRole('button', { name: /^annuler$/i }))
    await user.keyboard('{Escape}')

    // Escape must not close THROUGH the very warning it just raised.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(props.onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: /texte du bloc 1/i })).toBeInTheDocument()
  })

  it('previews the draft with the same renderer the card and the export use', async () => {
    const user = userEvent.setup()
    renderDialog({ blocks: [] })

    await user.type(screen.getByRole('textbox', { name: /texte du bloc 1/i }), 'x^2$$')

    // Typeset, not LaTeX source: the preview IS the result, not a rendition
    // of it, which is what tells the user the fiche will show the same thing.
    const preview = screen.getByRole('region', { name: /aperçu/i })
    expect(preview.querySelector('.katex')).not.toBeNull()
  })

  it('reorders blocks, which the popover editor could not do at all', async () => {
    const user = userEvent.setup()
    const props = renderDialog({
      blocks: [
        { kind: 'text', text: 'Premier' },
        { kind: 'text', text: 'Second' },
      ],
    })

    await user.click(screen.getByRole('button', { name: /monter le bloc 2/i }))
    await user.click(screen.getByRole('button', { name: /^enregistrer$/i }))

    expect(props.onSave).toHaveBeenCalledWith([
      { kind: 'text', text: 'Second' },
      { kind: 'text', text: 'Premier' },
    ])
  })

  it('cannot move the first block up nor the last one down', () => {
    renderDialog({
      blocks: [
        { kind: 'text', text: 'Premier' },
        { kind: 'text', text: 'Second' },
      ],
    })

    expect(screen.getByRole('button', { name: /monter le bloc 1/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /descendre le bloc 2/i })).toBeDisabled()
  })

  it('resizes an image by its displayed width, keeping its shape', async () => {
    const user = userEvent.setup()
    const props = renderDialog({
      blocks: [{ kind: 'image', asset: 'a1.png', alt: 'Schéma', width: 320, height: 240 }],
    })

    await user.click(screen.getByRole('button', { name: /^160 pixels$/i }))
    await user.click(screen.getByRole('button', { name: /^enregistrer$/i }))

    // 4:3 in, 4:3 out — a resize that drifted the ratio would distort the
    // picture a little more on every click.
    expect(props.onSave).toHaveBeenCalledWith([
      { kind: 'image', asset: 'a1.png', alt: 'Schéma', width: 160, height: 120 },
    ])
  })

  it('inserts a symbol from the palette into the formula being edited', async () => {
    const user = userEvent.setup()
    const props = renderDialog({ blocks: [{ kind: 'math', latex: 'x' }] })

    // The raw-LaTeX path: MathLive is not loaded in jsdom, so the palette
    // appends rather than inserting at a caret — degraded, never a lost click.
    await user.click(screen.getByRole('button', { name: /^multiplié par$/i }))
    await user.click(screen.getByRole('button', { name: /^enregistrer$/i }))

    expect(props.onSave).toHaveBeenCalledWith([{ kind: 'math', latex: 'x\\times ' }])
  })

  it('shows the palette only under the block being edited', async () => {
    const user = userEvent.setup()
    renderDialog({
      blocks: [
        { kind: 'math', latex: 'a' },
        { kind: 'math', latex: 'b' },
      ],
    })

    expect(screen.getAllByRole('group', { name: /symboles mathématiques/i })).toHaveLength(1)

    await user.click(screen.getByRole('textbox', { name: /formule du bloc 2 \(latex\)/i }))
    expect(screen.getAllByRole('group', { name: /symboles mathématiques/i })).toHaveLength(1)
  })

  it('hides the image affordance when there is nowhere to store one', () => {
    renderDialog({ onPickImage: undefined })

    expect(screen.queryByRole('button', { name: /insérer une image/i })).not.toBeInTheDocument()
  })
})
