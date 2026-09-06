import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach } from 'vitest'
import { ReactFlowProvider, type NodeProps } from '@xyflow/react'
import { CardNode } from './CardNode'
import { useCardsStore, createCardsStore } from '../state/useCardsStore'
import type { Card } from '../types/card'

const testCard: Card = { id: 'root', level: 1, title: 'Titre initial', parentId: null, order: 0 }

type CardNodeTestProps = NodeProps & { data: { card: Card; autoEdit?: boolean } }

function cardNodeProps(card: Card, autoEdit = false) {
  return { id: card.id, data: { card, autoEdit } } as unknown as CardNodeTestProps
}

/**
 * CardNode renders real React Flow <Handle> elements (without them React Flow
 * measures empty handleBounds and silently stops drawing edges), and Handle
 * requires a ReactFlowProvider ancestor for its store/handle-config contexts.
 */
function renderCardNode(card: Card, autoEdit = false) {
  const result = render(
    <ReactFlowProvider>
      <CardNode {...cardNodeProps(card, autoEdit)} />
    </ReactFlowProvider>
  )
  return {
    ...result,
    rerenderWith: (next: Card) =>
      result.rerender(
        <ReactFlowProvider>
          <CardNode {...cardNodeProps(next, autoEdit)} />
        </ReactFlowProvider>
      ),
  }
}

/**
 * CardNode reads the module-level store singleton, so per-test isolation is a
 * reset of that singleton's DATA slices from a pristine store. Only
 * `history`/`locked` are copied: the pristine store's actions are bound to that
 * throwaway store, so copying them would detach the singleton's actions.
 */
function resetStore(cards: Card[]) {
  const pristine = createCardsStore().getState()
  useCardsStore.setState({ history: pristine.history, locked: pristine.locked })
  useCardsStore.getState().loadCards(cards)
}

describe('CardNode', () => {
  beforeEach(() => resetStore([testCard]))

  it('displays the card title', () => {
    renderCardNode(testCard)
    expect(screen.getByText('Titre initial')).toBeInTheDocument()
  })

  it('enters edit mode on click and commits the new title on Enter', async () => {
    const user = userEvent.setup()
    renderCardNode(testCard)

    await user.click(screen.getByText('Titre initial'))
    const input = screen.getByRole('textbox', { name: /titre/i })
    await user.clear(input)
    await user.type(input, 'Nouveau titre{Enter}')

    expect(useCardsStore.getState().history.present[0].title).toBe('Nouveau titre')
  })

  it('cancels the edit on Escape without changing the stored title', async () => {
    const user = userEvent.setup()
    renderCardNode(testCard)

    await user.click(screen.getByText('Titre initial'))
    const input = screen.getByRole('textbox', { name: /titre/i })
    await user.type(input, ' modifié{Escape}')

    expect(useCardsStore.getState().history.present[0].title).toBe('Titre initial')
  })

  it('does not push a history entry when the title is committed unchanged', async () => {
    const user = userEvent.setup()
    renderCardNode(testCard)
    const before = useCardsStore.getState().history

    await user.click(screen.getByText('Titre initial'))
    await user.keyboard('{Enter}')

    expect(useCardsStore.getState().history).toBe(before)
  })

  it('re-seeds the title draft from the card each time the editor is opened', async () => {
    const user = userEvent.setup()
    const { rerenderWith } = renderCardNode(testCard)

    // Type a draft, then leave the editor without committing.
    await user.click(screen.getByText('Titre initial'))
    await user.type(screen.getByRole('textbox', { name: /titre/i }), ' brouillon{Escape}')

    // The card changes underneath us (an undo, a reload, a concurrent edit).
    rerenderWith({ ...testCard, title: 'Titre externe' })

    await user.click(screen.getByText('Titre externe'))
    expect(screen.getByRole('textbox', { name: /titre/i })).toHaveValue('Titre externe')
  })

  it('opens the title editor on mount when the node is flagged autoEdit', () => {
    renderCardNode(testCard, true)
    expect(screen.getByRole('textbox', { name: /titre/i })).toHaveValue('Titre initial')
  })

  it('does not open the title editor when autoEdit is not set', () => {
    renderCardNode(testCard)
    expect(screen.queryByRole('textbox', { name: /titre/i })).not.toBeInTheDocument()
  })
})

describe('CardNode structural buttons', () => {
  beforeEach(() => resetStore([testCard]))

  it('creates a child when the -> button is clicked', async () => {
    const user = userEvent.setup()
    renderCardNode(testCard)
    await user.click(screen.getByRole('button', { name: /ajouter un enfant/i }))
    expect(useCardsStore.getState().history.present).toHaveLength(2)
  })

  it('creates a sibling below when the bottom + button is clicked', async () => {
    const user = userEvent.setup()
    const child: Card = { id: 'child', level: 2, title: 'Enfant', parentId: 'root', order: 0 }
    resetStore([testCard, child])
    renderCardNode(child)
    await user.click(screen.getByRole('button', { name: /ajouter en dessous/i }))
    expect(useCardsStore.getState().history.present).toHaveLength(3)
  })

  it('keeps the + buttons on the root card but greys them out (single-root invariant)', () => {
    renderCardNode(testCard)
    expect(screen.getByRole('button', { name: /ajouter au-dessus/i })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: /ajouter en dessous/i })).toHaveAttribute('aria-disabled', 'true')
  })

  it('does not call addSibling when a greyed-out + button is clicked anyway', () => {
    renderCardNode(testCard)
    // fireEvent bypasses the pointer-events guard, proving the handler itself
    // refuses to act — defence in depth behind the disabled styling.
    fireEvent.click(screen.getByRole('button', { name: /ajouter au-dessus/i }))
    fireEvent.click(screen.getByRole('button', { name: /ajouter en dessous/i }))
    expect(useCardsStore.getState().history.present).toHaveLength(1)
  })

  it('keeps the -> button on a level-4 card but greys it out', () => {
    const level4: Card = { id: 'l4', level: 4, title: 'Info', parentId: 'root', order: 0 }
    resetStore([testCard, level4])
    renderCardNode(level4)
    expect(screen.getByRole('button', { name: /ajouter un enfant/i })).toHaveAttribute('aria-disabled', 'true')
  })

  it('does not call addChild when the greyed-out -> button of a level-4 card is clicked anyway', () => {
    const level4: Card = { id: 'l4', level: 4, title: 'Info', parentId: 'root', order: 0 }
    resetStore([testCard, level4])
    renderCardNode(level4)
    fireEvent.click(screen.getByRole('button', { name: /ajouter un enfant/i }))
    expect(useCardsStore.getState().history.present).toHaveLength(2)
  })

  it('marks an applicable button as enabled', () => {
    const child: Card = { id: 'child', level: 2, title: 'Enfant', parentId: 'root', order: 0 }
    resetStore([testCard, child])
    renderCardNode(child)
    expect(screen.getByRole('button', { name: /ajouter au-dessus/i })).toHaveAttribute('aria-disabled', 'false')
    expect(screen.getByRole('button', { name: /ajouter un enfant/i })).toHaveAttribute('aria-disabled', 'false')
    expect(screen.getByRole('button', { name: /supprimer/i })).toHaveAttribute('aria-disabled', 'false')
  })
})

describe('CardNode delete', () => {
  beforeEach(() => resetStore([testCard]))

  it('deletes immediately when the card has no children', async () => {
    const user = userEvent.setup()
    const child: Card = { id: 'child', level: 2, title: 'Enfant', parentId: 'root', order: 0 }
    resetStore([testCard, child])
    renderCardNode(child)

    await user.click(screen.getByRole('button', { name: /supprimer/i }))
    expect(useCardsStore.getState().history.present).toHaveLength(1)
  })

  it('shows a confirmation dialog before deleting a card with children', async () => {
    const user = userEvent.setup()
    const child: Card = { id: 'child', level: 2, title: 'Enfant', parentId: 'root', order: 0 }
    const grandchild: Card = { id: 'grandchild', level: 3, title: 'Petit-enfant', parentId: 'child', order: 0 }
    resetStore([testCard, child, grandchild])
    renderCardNode(child)

    await user.click(screen.getByRole('button', { name: /supprimer/i }))
    expect(screen.getByText(/supprimer cette card et ses 1 enfants/i)).toBeInTheDocument()
    expect(useCardsStore.getState().history.present).toHaveLength(3)

    await user.click(screen.getByRole('button', { name: /confirmer/i }))
    expect(useCardsStore.getState().history.present).toHaveLength(1)
  })

  it('keeps the delete button on the root card but greys it out', () => {
    renderCardNode(testCard)
    expect(screen.getByRole('button', { name: /supprimer/i })).toHaveAttribute('aria-disabled', 'true')
  })

  it('does not delete the root when its greyed-out delete button is clicked anyway', () => {
    renderCardNode(testCard)
    fireEvent.click(screen.getByRole('button', { name: /supprimer/i }))
    expect(useCardsStore.getState().history.present).toHaveLength(1)
  })
})

describe('CardNode drag handle', () => {
  beforeEach(() => resetStore([testCard]))

  it('renders an enabled drag handle when unlocked', () => {
    renderCardNode(testCard)
    expect(screen.getByTestId('drag-handle')).toHaveAttribute('aria-disabled', 'false')
  })

  it('greys out the drag handle when locked, without removing it', () => {
    useCardsStore.getState().toggleLock()
    renderCardNode(testCard)
    expect(screen.getByTestId('drag-handle')).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('CardNode footer', () => {
  beforeEach(() => resetStore([testCard]))

  it('shows an "add definition" affordance when there is none yet', () => {
    renderCardNode(testCard)
    expect(screen.getByRole('button', { name: /ajouter une définition/i })).toBeInTheDocument()
  })

  it('toggles an existing definition between hidden and shown', async () => {
    const user = userEvent.setup()
    const withDef: Card = { ...testCard, definition: 'Une définition' }
    resetStore([withDef])
    renderCardNode(withDef)

    expect(screen.queryByText('Une définition')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /afficher la définition/i }))
    expect(screen.getByText('Une définition')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /masquer la définition/i }))
    expect(screen.queryByText('Une définition')).not.toBeInTheDocument()
  })

  it('flips the card visually when the flip icon is clicked, without altering any card data', async () => {
    const user = userEvent.setup()
    renderCardNode(testCard)

    await user.click(screen.getByRole('button', { name: /retourner/i }))
    expect(screen.getByTestId(`card-${testCard.id}`)).toHaveAttribute('data-flipped', 'true')
    expect(useCardsStore.getState().history.present).toEqual([testCard])
  })

  it('describes each footer icon with a tooltip', async () => {
    const user = userEvent.setup()
    renderCardNode(testCard)

    await user.hover(screen.getByRole('button', { name: /retourner/i }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Retourner')
  })

  it('opens an editable field when "add definition" is clicked and commits the typed text on Enter', async () => {
    const user = userEvent.setup()
    renderCardNode(testCard)

    await user.click(screen.getByRole('button', { name: /ajouter une définition/i }))
    const field = screen.getByRole('textbox', { name: /définition/i })
    await user.type(field, 'Nouvelle définition{Enter}')

    expect(useCardsStore.getState().history.present.find(c => c.id === testCard.id)?.definition).toBe(
      'Nouvelle définition'
    )
  })

  it('cancels the definition edit on Escape without calling updateDefinition', async () => {
    const user = userEvent.setup()
    renderCardNode(testCard)

    await user.click(screen.getByRole('button', { name: /ajouter une définition/i }))
    const field = screen.getByRole('textbox', { name: /définition/i })
    await user.type(field, 'Texte annulé{Escape}')

    expect(screen.queryByRole('textbox', { name: /définition/i })).not.toBeInTheDocument()
    expect(useCardsStore.getState().history.present.find(c => c.id === testCard.id)?.definition).toBeUndefined()
  })

  it('does not push a history entry when the definition editor is closed unchanged', async () => {
    const user = userEvent.setup()
    renderCardNode(testCard)
    await user.click(screen.getByRole('button', { name: /ajouter une définition/i }))
    const before = useCardsStore.getState().history

    await user.keyboard('{Enter}')

    expect(useCardsStore.getState().history).toBe(before)
  })
})
