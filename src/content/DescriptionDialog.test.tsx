import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, afterEach } from 'vitest'
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

let cardIdSeq = 0
/** A fresh id per call: the local undo history is keyed by card id and lives
 *  at module scope, so reusing one across tests would leak state between them. */
function nextCardId(): string {
  cardIdSeq += 1
  return `card-${cardIdSeq}`
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof DescriptionDialog>> = {}) {
  const props = {
    cardId: nextCardId(),
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
  afterEach(() => {
    vi.useRealTimers()
  })

  it('says which card is being edited, ancestors included', () => {
    renderDialog()

    expect(screen.getByRole('textbox', { name: /titre de la carte/i })).toHaveValue('Signes contraires')
    // The breadcrumb is what makes the card unambiguous when the editor opens
    // over a canvas of near-identical boxes.
    expect(screen.getByText('Nombres relatifs › Addition')).toBeInTheDocument()
  })

  it('renames the card from the title field when a rename handler is given', async () => {
    const user = userEvent.setup()
    const onRenameTitle = vi.fn()
    renderDialog({ onRenameTitle })

    const title = screen.getByRole('textbox', { name: /titre de la carte/i })
    await user.clear(title)
    await user.type(title, 'Nouveau titre{Enter}')

    expect(onRenameTitle).toHaveBeenCalledWith('Nouveau titre')
  })

  it('leaves the title read-only with no rename handler', () => {
    renderDialog()

    expect(screen.getByRole('textbox', { name: /titre de la carte/i })).toHaveAttribute('readonly')
  })

  it('opens an empty card on a field to type in rather than on nothing', () => {
    renderDialog({ blocks: [] })

    expect(screen.getByRole('textbox', { name: /texte du bloc 1/i })).toHaveValue('')
  })

  it('opens with the caret already in the text field', () => {
    // Radix focuses the first tabbable element of a dialog, which here is a
    // panel button: without cancelling it, the dialog opened on a button and
    // the first keystroke went nowhere.
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
    await user.click(screen.getByRole('button', { name: /^fermer$/i }))

    // Appended at the caret the dialog opened on (the end of the text), not
    // replacing it: the palette never took focus out of the field. The inverted
    // sign brings its closing partner, so the sentence is closed already.
    expect(props.onSave).toHaveBeenCalledWith([{ kind: 'text', text: 'Como estas¿?' }])
  })

  it('saves the edited blocks on the way out', async () => {
    const user = userEvent.setup()
    const props = renderDialog()

    const field = screen.getByRole('textbox', { name: /texte du bloc 1/i })
    await user.clear(field)
    await user.type(field, 'Définition modifiée')
    // Closing flushes whatever autosave had not gotten to yet — there is
    // nothing left to lose by leaving, so nothing to confirm either.
    await user.click(screen.getByRole('button', { name: /^fermer$/i }))

    expect(props.onSave).toHaveBeenCalledWith([{ kind: 'text', text: 'Définition modifiée' }])
    expect(props.onClose).toHaveBeenCalled()
  })

  it('autosaves on its own after a pause in typing, with nothing clicked', async () => {
    vi.useFakeTimers()
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime })
    const props = renderDialog()

    const field = screen.getByRole('textbox', { name: /texte du bloc 1/i })
    await user.clear(field)
    await user.type(field, 'Écrit puis on attend')

    expect(props.onSave).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(700)

    expect(props.onSave).toHaveBeenCalledWith([{ kind: 'text', text: 'Écrit puis on attend' }])
    // Autosaving is not closing: the dialog stays open for the next edit.
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('closes right away when nothing was changed', async () => {
    const user = userEvent.setup()
    const props = renderDialog()

    await user.click(screen.getByRole('button', { name: /^fermer$/i }))

    expect(props.onClose).toHaveBeenCalled()
    expect(props.onSave).not.toHaveBeenCalled()
  })

  it('treats a change typed and undone as no change at all', async () => {
    const user = userEvent.setup()
    const props = renderDialog()

    const field = screen.getByRole('textbox', { name: /texte du bloc 1/i })
    await user.type(field, 'x')
    await user.keyboard('{Backspace}')
    await user.click(screen.getByRole('button', { name: /^fermer$/i }))

    // A referential dirty check would have called `onSave` here regardless.
    expect(props.onSave).not.toHaveBeenCalled()
    expect(props.onClose).toHaveBeenCalled()
  })

  it('undoes the last edit with Ctrl+Z, on the description’s own history', async () => {
    const user = userEvent.setup()
    const props = renderDialog({ blocks: text('Départ') })

    const field = screen.getByRole('textbox', { name: /texte du bloc 1/i })
    await user.type(field, ' et suite')
    expect(field).toHaveValue('Départ et suite')

    await user.keyboard('{Control>}z{/Control}')
    expect(field).toHaveValue('Départ')

    // Undone all the way back to what the card already had: closing now has
    // nothing new to save.
    await user.click(screen.getByRole('button', { name: /^fermer$/i }))
    expect(props.onSave).not.toHaveBeenCalled()
  })

  it('asks before deleting a description that exists, and says what it deletes', async () => {
    const user = userEvent.setup()
    const props = renderDialog()

    await user.click(screen.getByRole('button', { name: /^supprimer$/i }))

    expect(screen.getByRole('alertdialog')).toHaveTextContent('Supprimer cette description ?')
    await user.click(screen.getByRole('button', { name: /supprimer la description/i }))

    expect(props.onSave).toHaveBeenCalledWith([])
    expect(props.onClose).toHaveBeenCalled()
  })

  it('shows a formula typeset with the same renderer the card and the export use', async () => {
    // Radix renders the dialog into a portal appended to `document.body`, not
    // into the local render container — so the query below has to search the
    // whole document, the same way a `screen` query would.
    const user = userEvent.setup()
    renderDialog({ blocks: [] })

    await user.type(screen.getByRole('textbox', { name: /texte du bloc 1/i }), 'x^2$$')

    // Typeset, not LaTeX source: the live preview under the formula field IS
    // the result, not a rendition of it.
    expect(document.querySelector('.katex')).not.toBeNull()
  })

  it('reorders blocks, which the old popover editor could not do at all', async () => {
    const user = userEvent.setup()
    const props = renderDialog({
      blocks: [
        { kind: 'text', text: 'Premier' },
        { kind: 'text', text: 'Second' },
      ],
    })

    await user.click(screen.getByRole('textbox', { name: /texte du bloc 2/i }))
    await user.click(screen.getByRole('button', { name: /monter le bloc en cours/i }))
    await user.click(screen.getByRole('button', { name: /^fermer$/i }))

    expect(props.onSave).toHaveBeenCalledWith([
      { kind: 'text', text: 'Second' },
      { kind: 'text', text: 'Premier' },
    ])
  })

  it('cannot move the first block up nor the last one down', async () => {
    const user = userEvent.setup()
    renderDialog({
      blocks: [
        { kind: 'text', text: 'Premier' },
        { kind: 'text', text: 'Second' },
      ],
    })

    // Block 1 is active on open (autofocused), so "up" is already disabled.
    expect(screen.getByRole('button', { name: /monter le bloc en cours/i })).toBeDisabled()

    await user.click(screen.getByRole('textbox', { name: /texte du bloc 2/i }))
    expect(screen.getByRole('button', { name: /descendre le bloc en cours/i })).toBeDisabled()
  })

  it('resizes an image by its displayed width, keeping its shape', async () => {
    const user = userEvent.setup()
    const props = renderDialog({
      blocks: [{ kind: 'image', asset: 'a1.png', alt: 'Schéma', width: 320, height: 240 }],
    })

    await user.click(screen.getByRole('button', { name: /^160 pixels$/i }))
    await user.click(screen.getByRole('button', { name: /^fermer$/i }))

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
    await user.click(screen.getByRole('button', { name: /^fermer$/i }))

    expect(props.onSave).toHaveBeenCalledWith([{ kind: 'math', latex: 'x\\times ' }])
  })

  it('shows the palette only for the block being edited', async () => {
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

  it('shows only the edge arrows for relations that actually exist', () => {
    renderDialog({
      parentTarget: { id: 'p', title: 'Chapitre 5' },
      nextSibling: { id: 'n', title: 'Exercice 13' },
      onNavigate: vi.fn(),
    })

    expect(screen.getByRole('button', { name: /aller à « chapitre 5 »/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /aller à « exercice 13 »/i })).toBeInTheDocument()
    // No parent/child/previous-sibling target was given, so only these two exist.
    expect(screen.queryAllByRole('button', { name: /aller à/i })).toHaveLength(2)
  })

  it('navigates to a neighbour, flushing the pending autosave first', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    const props = renderDialog({
      nextSibling: { id: 'card-next', title: 'Exercice 13' },
      onNavigate,
    })

    await user.type(screen.getByRole('textbox', { name: /texte du bloc 1/i }), ' de plus')
    await user.click(screen.getByRole('button', { name: /aller à « exercice 13 »/i }))

    expect(props.onSave).toHaveBeenCalledWith([{ kind: 'text', text: 'Une définition de plus' }])
    expect(onNavigate).toHaveBeenCalledWith('card-next')
  })
})
