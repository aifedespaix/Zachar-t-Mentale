import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DescriptionDialog } from './DescriptionDialog'
import { isModalOpen } from '../hooks/useGlobalShortcuts'
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
    // Le réglage des familles vit dans `localStorage`, partagé par tous les tests
    // du fichier : sans ce nettoyage, un test masquerait une famille pour les
    // suivants.
    localStorage.clear()
  })

  it('says which card is being edited, ancestors included', () => {
    renderDialog()

    expect(screen.getByRole('textbox', { name: /titre de la carte/i })).toHaveValue('Signes contraires')
    // The breadcrumb is what makes the card unambiguous when the editor opens
    // over a canvas of near-identical boxes.
    expect(screen.getByText('Nombres relatifs › Addition')).toBeInTheDocument()
  })

  it('announces itself as an open modal, so the global shortcuts stand down', () => {
    // `useGlobalShortcuts` recognises "a modal is up" from this attribute, and
    // it listens in CAPTURE on `window` — so it runs BEFORE this dialog's own
    // handlers. Without the attribute the dispatcher stayed armed while the
    // description was open: with the caret on a button rather than in a field,
    // `isTypingTarget` no longer shielded it, so `Ctrl+Z` ran the DOCUMENT undo
    // and its `stopPropagation` swallowed the description's own. The same hole
    // left `Mod+Entrée` (which OPENS this dialog) able to fire behind it.
    renderDialog()

    expect(isModalOpen()).toBe(true)
  })

  it('règle les familles de symboles depuis le pied, et retient le choix', async () => {
    // Le bouton vit dans le pied, à gauche de « Supprimer » : le réglage et sa
    // commande au même endroit, sur un support qui ne se replie pas comme le
    // bandeau — une commande posée en fin de bandeau atterrit sur la dernière
    // ligne, souvent hors de vue.
    const user = userEvent.setup()
    renderDialog({ blocks: [{ kind: 'math', latex: 'x' }] })

    expect(screen.getByRole('group', { name: 'Grec' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /choisir les familles/i }))
    const overlay = screen.getByRole('dialog', { name: /familles de symboles/i })

    await user.click(within(overlay).getByRole('checkbox', { name: /grec/i }))

    expect(screen.queryByRole('group', { name: 'Grec' })).not.toBeInTheDocument()
    // Enregistré, pas seulement affiché.
    expect(JSON.parse(localStorage.getItem('zachart-mentale:band-hidden-families') ?? 'null')).toEqual(['Grec'])

    await user.click(within(overlay).getByRole('button', { name: /tout afficher/i }))
    expect(screen.getByRole('group', { name: 'Grec' })).toBeInTheDocument()
  })

  it('applique dès le premier rendu un réglage de familles retrouvé', () => {
    // Lu à l'initialisation, pas dans un effet : sinon le bandeau se peindrait
    // complet puis se réduirait — le saut visuel que tout ce bandeau évite.
    localStorage.setItem('zachart-mentale:band-hidden-families', JSON.stringify(['Grec']))

    renderDialog({ blocks: [{ kind: 'math', latex: 'x' }] })

    expect(screen.queryByRole('group', { name: 'Grec' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Comparaisons' })).toBeInTheDocument()
  })

  it('explains an icon-only control with the app’s tooltip, not a native title', async () => {
    // `title` appeared only for pointer users, only after about a second, and
    // could not be styled. The Radix tooltip opens on FOCUS as well, so a
    // keyboard user gets the same explanation — which is the whole reason for
    // the migration rather than a cosmetic swap.
    const user = userEvent.setup()
    renderDialog()

    const cross = screen.getByRole('button', { name: /fermer la description/i })
    expect(cross).not.toHaveAttribute('title')

    await user.hover(cross)
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Fermer'))
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

    // Les langues sont des onglets du bandeau, présents dès le premier rendu :
    // on ouvre l'onglet, puis on clique le caractère.
    await user.click(screen.getByRole('button', { name: 'Espagnol' }))
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

  it('greys out the undo and redo buttons until there is a step to walk', async () => {
    const user = userEvent.setup()
    renderDialog({ blocks: text('Départ') })

    const undoButton = () => screen.getByRole('button', { name: /annuler la dernière modification/i })
    const redoButton = () => screen.getByRole('button', { name: /rétablir la modification annulée/i })

    // Nothing typed yet: nothing to walk back to, nothing to walk forward to.
    expect(undoButton()).toBeDisabled()
    expect(redoButton()).toBeDisabled()

    await user.type(screen.getByRole('textbox', { name: /texte du bloc 1/i }), ' et suite')

    // The step is recorded by the autosave debounce, not by the keystroke — so
    // the button has to learn about it from the history, which is the whole
    // reason the read API exists.
    await waitFor(() => expect(undoButton()).toBeEnabled(), { timeout: 2000 })
    expect(redoButton()).toBeDisabled()
  })

  it('undoes and redoes from the buttons, not only from the keyboard', async () => {
    const user = userEvent.setup()
    renderDialog({ blocks: text('Départ') })

    await user.type(screen.getByRole('textbox', { name: /texte du bloc 1/i }), ' et suite')
    await waitFor(
      () => expect(screen.getByRole('button', { name: /annuler la dernière modification/i })).toBeEnabled(),
      { timeout: 2000 }
    )

    await user.click(screen.getByRole('button', { name: /annuler la dernière modification/i }))
    expect(screen.getByRole('textbox', { name: /texte du bloc 1/i })).toHaveValue('Départ')

    // A real `disabled` attribute, not a dimmed style: this state has to be
    // announced, and the button that was inert is now the way forward.
    const redoButton = screen.getByRole('button', { name: /rétablir la modification annulée/i })
    expect(redoButton).toBeEnabled()
    await user.click(redoButton)
    expect(screen.getByRole('textbox', { name: /texte du bloc 1/i })).toHaveValue('Départ et suite')
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

  it('shows a formula typeset with the same renderer the card and the export use', () => {
    // Radix renders the dialog into a portal appended to `document.body`, not
    // into the local render container — so the query below has to search the
    // whole document, the same way a `screen` query would.
    //
    // The formula is there from the start rather than typed through `$$`: what
    // `$$` turns into a formula (and what it now leaves as prose) is
    // `BlockEditor`'s contract and is tested there. Tying this renderer check
    // to that trigger is how typing "x^2$$`" used to assert the very bug the
    // narrowed trigger fixes.
    renderDialog({ blocks: [{ kind: 'math', latex: 'x^2' }] })

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

    // The order buttons live ON the block they move, so the label names it.
    await user.click(screen.getByRole('button', { name: /monter le bloc 2/i }))
    await user.click(screen.getByRole('button', { name: /^fermer$/i }))

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

  it('cannot close on an outside click, and offers the cross as the way out', async () => {
    const user = userEvent.setup()
    const props = renderDialog()

    // Everything behind the dialog — the canvas, the panel, the card the user
    // came from. Clicking there used to close the dialog and throw away the
    // definition being written; it now does nothing at all.
    //
    // `fireEvent` rather than `user.click`: a modal Radix dialog sets
    // `pointer-events: none` on the body precisely so that a real click cannot
    // land there, and driving the gesture at the event level is what reaches
    // the dismissable layer the test is about.
    fireEvent.pointerDown(document.body)

    expect(props.onClose).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /fermer la description/i }))
    expect(props.onClose).toHaveBeenCalled()
  })

  it('lists the keyboard shortcuts on demand, without taking up room the rest of the time', async () => {
    const user = userEvent.setup()
    renderDialog()

    expect(screen.queryByRole('group', { name: /raccourcis clavier/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /raccourcis/i }))

    const panel = screen.getByRole('group', { name: /raccourcis clavier/i })
    expect(panel).toHaveTextContent('Nouveau bloc')
    expect(panel).toHaveTextContent('Ctrl/Cmd + Entrée')
  })

  it('names Entrée by where the caret is: validating a rename, not a new block', async () => {
    // The panel used to recite "Entrée — Nouveau bloc" even with the caret in
    // the title, where Enter commits the rename instead. Saying nothing would
    // be better than that; saying the true thing is better still.
    const user = userEvent.setup()
    renderDialog({ onRenameTitle: vi.fn() })

    await user.click(screen.getByRole('textbox', { name: /titre de la carte/i }))
    await user.click(screen.getByRole('button', { name: /raccourcis/i }))

    const panel = screen.getByRole('group', { name: /raccourcis clavier/i })
    expect(panel).toHaveTextContent('Valider le renommage')
    expect(panel).not.toHaveTextContent('Nouveau bloc')
  })

  it('names Entrée by where the caret is: a line inside a cell, not a new block', async () => {
    const user = userEvent.setup()
    renderDialog({ blocks: [{ kind: 'table', header: [], rows: [['a']] }] })

    await user.click(screen.getByRole('textbox', { name: /ligne 1 colonne 1 du tableau 1/i }))
    await user.click(screen.getByRole('button', { name: /raccourcis/i }))

    const panel = screen.getByRole('group', { name: /raccourcis clavier/i })
    expect(panel).toHaveTextContent('Ajouter une ligne dans la cellule')
    expect(panel).not.toHaveTextContent('Nouveau bloc')
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

  it('inserts a symbol from the palette with the keyboard too, not only with a click', async () => {
    // The palette listens to `mousedown` to keep the caret in the formula, and
    // a keyboard Enter never fires one: without a key handler the keys stay
    // reachable with Tab, announce their label, and then do nothing at all.
    const user = userEvent.setup()
    const props = renderDialog({ blocks: [{ kind: 'math', latex: 'x' }] })

    screen.getByRole('button', { name: /^multiplié par$/i }).focus()
    await user.keyboard('{Enter}')
    await user.click(screen.getByRole('button', { name: /^fermer$/i }))

    // Inserted once, not twice: the keydown cancels the click it would
    // otherwise synthesise.
    expect(props.onSave).toHaveBeenCalledWith([{ kind: 'math', latex: 'x\\times ' }])
  })

  it('garde le bandeau à la même place, et c’est lui qui nomme le bloc visé', async () => {
    // Le contrat a changé, et c'est tout l'intérêt : la palette ne se déplace
    // plus d'un bloc à l'autre — c'était elle qui faisait sauter le contenu de
    // 120 à 190 px. Un seul bandeau, fixe, dit lequel il sert.
    const user = userEvent.setup()
    renderDialog({
      blocks: [
        { kind: 'math', latex: 'a' },
        { kind: 'math', latex: 'b' },
      ],
    })

    expect(screen.getByRole('group', { name: /symboles à insérer/i })).toBeInTheDocument()
    expect(screen.getByText('Bloc 1 · Formule')).toBeInTheDocument()

    await user.click(screen.getByRole('textbox', { name: /formule du bloc 2 \(latex\)/i }))

    expect(screen.getByText('Bloc 2 · Formule')).toBeInTheDocument()
    // Toujours un seul, et toujours au même endroit : rien n'a été dupliqué.
    expect(screen.getAllByRole('group', { name: /symboles à insérer/i })).toHaveLength(1)
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

  it('shows a neighbour’s title in a hover card dressed like that card, cut short', async () => {
    // The card-styled hover card replaces the wide pill that used to spell the
    // title out on the button itself: the chip shrank to its arrow, and the
    // explanation moved to where the pointer already is.
    const user = userEvent.setup()
    renderDialog({
      nextSibling: {
        id: 'n',
        title: 'Un titre de voisin vraiment très long qui dépasse la limite de ce qu’on lit',
        colors: { bg: 'rgb(1, 2, 3)', border: 'rgb(4, 5, 6)', text: 'rgb(7, 8, 9)' },
      },
      onNavigate: vi.fn(),
    })

    await user.hover(screen.getByRole('button', { name: /aller à/i }))
    const tip = await screen.findByRole('tooltip')

    expect(tip).toHaveTextContent('Suivant')
    // A character budget, not the whole thing: the tail never makes it in.
    expect(tip.textContent).toContain('…')
    expect(tip.textContent).not.toContain('dépasse')
    // Painted in the DESTINATION card's own palette — background, border, text.
    expect(tip).toHaveStyle({ backgroundColor: 'rgb(1, 2, 3)', borderTopColor: 'rgb(4, 5, 6)' })
  })

  it('offers a "+" where there is no neighbour, explains it, and prompts for a title before creating', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderDialog({ onCreate: { right: { onSelect } } })

    const plus = screen.getByRole('button', { name: /nouvelle sous-partie/i })
    await user.hover(plus)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Nouvelle sous-partie')

    await user.click(plus)
    // The click alone never creates anything blind: it only opens the prompt.
    expect(onSelect).not.toHaveBeenCalled()

    const titleField = await screen.findByRole('textbox', { name: /titre de la nouvelle carte/i })
    await user.type(titleField, 'Un titre')
    await user.click(screen.getByRole('button', { name: /^valider$/i }))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('Un titre')
  })

  it('also validates the create prompt with Entrée, and refuses a blank title', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderDialog({ onCreate: { right: { onSelect } } })

    await user.click(screen.getByRole('button', { name: /nouvelle sous-partie/i }))
    const titleField = await screen.findByRole('textbox', { name: /titre de la nouvelle carte/i })

    expect(screen.getByRole('button', { name: /^valider$/i })).toBeDisabled()

    await user.type(titleField, 'Chapitre 6{Enter}')
    expect(onSelect).toHaveBeenCalledWith('Chapitre 6')
    expect(screen.queryByRole('textbox', { name: /titre de la nouvelle carte/i })).not.toBeInTheDocument()
  })

  it('jumps to the parent card with Ctrl + ArrowLeft, in one step — no prompt, no confirmation', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    renderDialog({ parentTarget: { id: 'p1', title: 'Chapitre 5' }, onNavigate })

    // Away from the auto-focused text field first: Ctrl+←/→ already means
    // something THERE (jump a word), so the shortcut only fires outside one.
    await user.click(screen.getByRole('button', { name: /raccourcis/i }))
    await user.keyboard('{Control>}{ArrowLeft}{/Control}')

    expect(onNavigate).toHaveBeenCalledWith('p1')
  })

  it('never steals Ctrl + ArrowLeft/Right from a text field, where it already moves the caret by word', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    renderDialog({ parentTarget: { id: 'p1', title: 'Chapitre 5' }, onNavigate, blocks: text('Départ') })

    await user.click(screen.getByRole('textbox', { name: /texte du bloc 1/i }))
    await user.keyboard('{Control>}{ArrowLeft}{/Control}')

    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('opens the create prompt with Ctrl + ArrowRight when there is no sibling to jump to — same prompt as the button', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderDialog({ onCreate: { right: { onSelect } } })

    await user.click(screen.getByRole('button', { name: /raccourcis/i }))
    await user.keyboard('{Control>}{ArrowRight}{/Control}')

    expect(await screen.findByRole('textbox', { name: /titre de la nouvelle carte/i })).toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('shows no "+" on an edge nobody offered to create', () => {
    // The caller decides which edges are creatable, because only it knows the
    // card's level and whether it floats. With no handler, an empty edge stays
    // empty rather than offering something the store would refuse.
    renderDialog({ parentTarget: { id: 'p', title: 'Chapitre 5' }, onNavigate: vi.fn() })

    expect(screen.getByRole('button', { name: /aller à « chapitre 5 »/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /nouvelle/i })).not.toBeInTheDocument()
  })

  it('opens on the title, selected, for a card just created', () => {
    // The fresh card wears a placeholder title, so the dialog opens ON it with
    // the text selected: one gesture replaces it. The block editor's own
    // auto-focus stands down for that (see `autoFocusField`).
    renderDialog({ autoFocusTitle: true, onRenameTitle: vi.fn(), cardTitle: 'Nouveau titre' })

    const title = screen.getByRole('textbox', { name: /titre de la carte/i }) as HTMLInputElement
    expect(title).toHaveFocus()
    expect(title.selectionStart).toBe(0)
    expect(title.selectionEnd).toBe('Nouveau titre'.length)
  })

  it('selects the whole title when it is focused later, same as clicking a card title directly', async () => {
    // Only the "just created" card gets `autoFocusTitle` — every other click
    // on the title chip (the normal way to rename an existing card from the
    // dialog) must select the text too, exactly like `CardNode`'s own title
    // field does on the canvas, so typing overwrites rather than inserting.
    const user = userEvent.setup()
    renderDialog({ onRenameTitle: vi.fn(), cardTitle: 'Signes contraires' })

    const title = screen.getByRole('textbox', { name: /titre de la carte/i }) as HTMLInputElement
    expect(title).not.toHaveFocus()

    await user.click(title)

    expect(title).toHaveFocus()
    expect(title.selectionStart).toBe(0)
    expect(title.selectionEnd).toBe('Signes contraires'.length)
  })

  describe('la largeur de la modale', () => {
    // The dialog is recognised the same way useGlobalShortcuts recognises an
    // open modal — by its data-slot attribute, which this component sets itself
    // rather than inheriting it from the shared ui/dialog.
    function dialogContent(): HTMLElement {
      return document.querySelector('[data-slot="dialog-content"]') as HTMLElement
    }

    function dialogWidth(): string {
      return dialogContent().style.width
    }

    it('ouvre large, avec un bouton pour la rétrécir', () => {
      // L'état d'aujourd'hui sert de référence : la modale s'ouvre large, donc le
      // bouton neuf doit proposer l'autre sens — la rétrécir.
      renderDialog()

      expect(dialogWidth()).toBe('min(1600px, 96vw)')
      expect(screen.getByRole('button', { name: /rétrécir la modale/i })).toHaveAttribute('aria-pressed', 'false')
    })

    it('la rétrécit à environ deux tiers de l’écran, et retient le choix', async () => {
      const user = userEvent.setup()
      renderDialog()

      await user.click(screen.getByRole('button', { name: /rétrécir la modale/i }))

      expect(dialogWidth()).toBe('min(1250px, 65vw)')
      // Le bouton bascule : au clic suivant, c'est l'élargissement qu'il propose.
      expect(screen.getByRole('button', { name: /élargir la modale/i })).toHaveAttribute('aria-pressed', 'true')
      expect(localStorage.getItem('zachart-mentale:description-narrow')).toBe('true')
    })

    it('rouvre dans la largeur choisie la fois d’avant', () => {
      // La modale est remontée à chaque ouverture (key={cardId}) : le choix est
      // donc relu au montage, pas conservé dans un état de composant.
      localStorage.setItem('zachart-mentale:description-narrow', 'true')

      renderDialog()

      expect(dialogWidth()).toBe('min(1250px, 65vw)')
    })
  })
})
