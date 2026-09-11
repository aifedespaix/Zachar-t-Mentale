import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CardDetailPanel } from './CardDetailPanel'
import { useCardsStore, createCardsStore } from '../../state/useCardsStore'
import { useCardDetailStore } from '../../state/useCardDetailStore'
import { useCardHoverStore } from '../../state/useCardHoverStore'
import type { Card } from '../../types/card'

// Same reason as the panel's own tests: MathLive resolves under jsdom and would
// make a formula block render differently depending on test order.
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

function resetStore(cards: Card[]) {
  const pristine = createCardsStore().getState()
  useCardsStore.setState({ history: pristine.history, locked: pristine.locked })
  useCardsStore.getState().loadCards(cards)
}

describe('CardDetailPanel — survol croisé carte ↔ fiche', () => {
  beforeEach(() => {
    localStorage.clear()
    resetStore([root, branch, leaf, bare])
    useCardDetailStore.getState().closeAll()
    useCardDetailStore.setState({ stackMode: true })
    useCardHoverStore.getState().reset()
  })

  it('publishes a fiche hover so the matching card can light up', async () => {
    const user = userEvent.setup()
    useCardDetailStore.getState().show(leaf.id)
    render(<CardDetailPanel />)

    const section = screen.getByLabelText(`Fiche de ${leaf.title}`)
    await user.hover(section)

    expect(useCardHoverStore.getState().hoveredCardId).toBe(leaf.id)
    expect(section).toHaveAttribute('data-hovered', 'true')

    await user.unhover(section)
    expect(useCardHoverStore.getState().hoveredCardId).toBeNull()
  })

  it('lights up the fiche when its card is hovered on the canvas', () => {
    useCardDetailStore.getState().show(leaf.id)
    render(<CardDetailPanel />)

    const section = screen.getByLabelText(`Fiche de ${leaf.title}`)
    expect(section).toHaveAttribute('data-hovered', 'false')

    act(() => useCardHoverStore.getState().hover(leaf.id))
    expect(section).toHaveAttribute('data-hovered', 'true')

    act(() => useCardHoverStore.getState().unhover(leaf.id))
    expect(section).toHaveAttribute('data-hovered', 'false')
  })

  it('scrolls the hovered card’s fiche into view, and only that one', () => {
    const scrollIntoView = vi.fn()
    // jsdom does not implement it; the panel guards the call, but the assertion
    // needs a spy to see WHAT was scrolled and HOW.
    Element.prototype.scrollIntoView = scrollIntoView

    useCardDetailStore.getState().show(leaf.id)
    useCardDetailStore.getState().show(bare.id)
    render(<CardDetailPanel />)

    // Not the fiche's own hover: this stands in for the pointer landing on the
    // card on the canvas.
    act(() => useCardHoverStore.getState().hover(bare.id))

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.instances[0]).toBe(screen.getByLabelText(`Fiche de ${bare.title}`))
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' })
  })

  it('scrolls nothing when the hovered card has no fiche open', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView

    useCardDetailStore.getState().show(leaf.id)
    render(<CardDetailPanel />)

    act(() => useCardHoverStore.getState().hover(bare.id))

    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('no longer deletes a description from the visible fiche, but the context menu still can', async () => {
    const user = userEvent.setup()
    useCardDetailStore.getState().show(leaf.id)
    render(<CardDetailPanel />)

    // The red button is gone from the panel...
    expect(screen.queryByRole('button', { name: /^supprimer$/i })).not.toBeInTheDocument()

    // ...and the deletion it used to offer is still reachable, from the fiche's
    // context menu (and from the edit modal).
    fireEvent.contextMenu(screen.getByLabelText(`Fiche de ${leaf.title}`))
    await user.click(await screen.findByRole('menuitem', { name: /^supprimer$/i }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})
