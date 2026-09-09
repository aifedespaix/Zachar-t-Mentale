import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CardDetailPanel } from './CardDetailPanel'
import { useCardsStore, createCardsStore } from '../../state/useCardsStore'
import { useCardDetailStore } from '../../state/useCardDetailStore'
import type { Card } from '../../types/card'

// Same reason as the description dialog's own tests: MathLive resolves under
// jsdom, which would make a formula block render a `<math-field>` or a raw
// LaTeX textarea depending on test order.
vi.mock('mathlive', () => {
  throw new Error('MathLive is not exercised under jsdom')
})

const root: Card = { id: 'root', level: 1, title: 'Nombres relatifs', parentId: null, order: 0 }
const branch: Card = { id: 'branch', level: 2, title: 'Addition', parentId: 'root', order: 0 }
const leaf: Card = {
  id: 'leaf',
  level: 3,
  title: 'Signes contraires',
  definition: 'On garde le signe du plus éloigné de zéro.',
  parentId: 'branch',
  order: 0,
}
const bare: Card = { id: 'bare', level: 3, title: 'Sans description', parentId: 'branch', order: 1 }

/**
 * Only `history` and `locked` are copied over, never the whole snapshot: the
 * actions on a freshly created store are bound to THAT store, so replacing
 * wholesale would leave `useCardsStore` with writers that update a different
 * instance. Same helper as `CardNode.test.tsx`.
 */
function resetStore(cards: Card[]) {
  const pristine = createCardsStore().getState()
  useCardsStore.setState({ history: pristine.history, locked: pristine.locked })
  useCardsStore.getState().loadCards(cards)
}

describe('CardDetailPanel', () => {
  beforeEach(() => {
    resetStore([root, branch, leaf, bare])
    useCardDetailStore.getState().closeAll()
  })

  it('renders nothing at all when no fiche is open', () => {
    const { container } = render(<CardDetailPanel />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the card, its ancestors and its description', () => {
    useCardDetailStore.getState().show(leaf.id)
    render(<CardDetailPanel />)

    expect(screen.getByText('Signes contraires')).toBeInTheDocument()
    // The breadcrumb is what makes "which card is this?" unambiguous with
    // several fiches stacked.
    expect(screen.getByText('Nombres relatifs › Addition')).toBeInTheDocument()
    expect(screen.getByText(/on garde le signe/i)).toBeInTheDocument()
  })

  it('says so, rather than showing a blank panel, when there is no description', () => {
    useCardDetailStore.getState().show(bare.id)
    render(<CardDetailPanel />)

    expect(screen.getByText(/n’a pas encore de description/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ajouter une description/i })).toBeInTheDocument()
  })

  it('edits through the same editor the card uses, and writes to the store', async () => {
    const user = userEvent.setup()
    useCardDetailStore.getState().show(leaf.id)
    render(<CardDetailPanel />)

    await user.click(screen.getByRole('button', { name: /^modifier$/i }))
    const field = screen.getByRole('textbox', { name: /texte du bloc 1/i })
    await user.clear(field)
    await user.type(field, 'Réécrite')
    await user.click(screen.getByRole('button', { name: /^enregistrer$/i }))

    expect(useCardsStore.getState().history.present.find(c => c.id === leaf.id)?.definition).toBe('Réécrite')
  })

  it('offers no editing on a locked map', () => {
    useCardsStore.setState({ locked: true })
    useCardDetailStore.getState().show(leaf.id)
    render(<CardDetailPanel />)

    // Reading still works — that is the whole point of a separate panel.
    expect(screen.getByText(/on garde le signe/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^modifier$/i })).not.toBeInTheDocument()
  })

  it('pins a fiche so the next card opens beside it instead of replacing it', async () => {
    const user = userEvent.setup()
    useCardDetailStore.getState().show(leaf.id)
    render(<CardDetailPanel />)

    await user.click(screen.getByRole('button', { name: /épingler la fiche de signes contraires/i }))
    // Through `act`: this stands in for a click on another card's button,
    // which happens outside this component.
    act(() => useCardDetailStore.getState().show(bare.id))

    expect(screen.getByLabelText('Fiche de Signes contraires')).toBeInTheDocument()
    expect(screen.getByLabelText('Fiche de Sans description')).toBeInTheDocument()
  })

  it('collapses a fiche to its header, keeping the badges that say what is inside', async () => {
    const user = userEvent.setup()
    useCardsStore.getState().updateContent(leaf.id, [
      { kind: 'text', text: 'Une règle' },
      { kind: 'math', latex: '\\frac{1}{2}' },
    ])
    useCardDetailStore.getState().show(leaf.id)
    render(<CardDetailPanel />)

    await user.click(screen.getByRole('button', { name: /replier la fiche de signes contraires/i }))

    const fiche = within(screen.getByLabelText('Fiche de Signes contraires'))
    expect(screen.queryByText('Une règle')).not.toBeInTheDocument()
    // Collapsed shows the header ONLY — the badges are what say whether it is
    // worth reopening.
    expect(fiche.getByLabelText(/contient une formule/i)).toBeInTheDocument()
  })

  it('closes a fiche', async () => {
    const user = userEvent.setup()
    useCardDetailStore.getState().show(leaf.id)
    render(<CardDetailPanel />)

    await user.click(screen.getByRole('button', { name: /fermer la fiche de signes contraires/i }))

    expect(useCardDetailStore.getState().open).toEqual([])
  })

  it('exposes a resize handle bounded to the panel’s limits', () => {
    useCardDetailStore.getState().show(leaf.id)
    render(<CardDetailPanel />)

    const handle = screen.getByRole('separator', { name: /redimensionner le panneau des fiches/i })
    expect(handle).toHaveAttribute('aria-valuemin', '300')
    expect(handle).toHaveAttribute('aria-valuemax', '640')
  })

  it('widens on ArrowLeft, because the panel grows leftwards', async () => {
    const user = userEvent.setup()
    useCardDetailStore.getState().show(leaf.id)
    render(<CardDetailPanel />)

    const handle = screen.getByRole('separator', { name: /redimensionner le panneau des fiches/i })
    const before = Number(handle.getAttribute('aria-valuenow'))
    handle.focus()
    await user.keyboard('{ArrowLeft}')

    expect(Number(handle.getAttribute('aria-valuenow'))).toBeGreaterThan(before)
  })

  it('gives the root card no breadcrumb rather than an empty one', () => {
    useCardsStore.getState().updateContent(root.id, [{ kind: 'text', text: 'Chapitre entier' }])
    useCardDetailStore.getState().show(root.id)
    render(<CardDetailPanel />)

    expect(screen.getByText('Chapitre entier')).toBeInTheDocument()
    expect(screen.queryByText('›')).not.toBeInTheDocument()
  })
})
