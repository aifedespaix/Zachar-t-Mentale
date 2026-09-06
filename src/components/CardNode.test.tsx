import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach } from 'vitest'
import { ReactFlowProvider, type NodeProps } from '@xyflow/react'
import { CardNode } from './CardNode'
import { useCardsStore, createCardsStore } from '../state/useCardsStore'
import { useQuizStore, createQuizStore } from '../state/useQuizStore'
import type { Card } from '../types/card'
import type { QuizQuestionType, QuizResult } from '../types/quiz'

type QuizData = { type: QuizQuestionType; result: QuizResult; distractorDefinitions?: string[] }

const testCard: Card = { id: 'root', level: 1, title: 'Titre initial', parentId: null, order: 0 }

const cardWithDefinition: Card = {
  id: 'root',
  level: 1,
  title: 'Titre initial',
  definition: 'Définition existante',
  parentId: null,
  order: 0,
}

type CardNodeTestProps = NodeProps & {
  data: { card: Card; autoEdit?: boolean; isReparentTarget?: boolean; quiz?: QuizData }
}

function cardNodeProps(card: Card, autoEdit = false, isReparentTarget = false, quiz?: QuizData) {
  return { id: card.id, data: { card, autoEdit, isReparentTarget, quiz } } as unknown as CardNodeTestProps
}

/**
 * CardNode renders real React Flow <Handle> elements (without them React Flow
 * measures empty handleBounds and silently stops drawing edges), and Handle
 * requires a ReactFlowProvider ancestor for its store/handle-config contexts.
 */
function renderCardNode(card: Card, autoEdit = false, isReparentTarget = false, quiz?: QuizData) {
  const result = render(
    <ReactFlowProvider>
      <CardNode {...cardNodeProps(card, autoEdit, isReparentTarget, quiz)} />
    </ReactFlowProvider>
  )
  return {
    ...result,
    rerenderWith: (next: Card) =>
      result.rerender(
        <ReactFlowProvider>
          <CardNode {...cardNodeProps(next, autoEdit, isReparentTarget, quiz)} />
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

  it('displays the card title in an always-present field (no click needed to reveal it)', () => {
    renderCardNode(testCard)
    expect(screen.getByRole('textbox', { name: /titre/i })).toHaveValue('Titre initial')
  })

  it('selects the whole title when the field is focused for the first time', async () => {
    const user = userEvent.setup()
    renderCardNode(testCard)

    const input = screen.getByRole('textbox', { name: /titre/i }) as HTMLInputElement
    await user.click(input)

    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('Titre initial'.length)
  })

  it('commits the new title when the field is blurred (e.g. via Enter)', async () => {
    const user = userEvent.setup()
    renderCardNode(testCard)

    const input = screen.getByRole('textbox', { name: /titre/i })
    await user.click(input)
    await user.clear(input)
    await user.type(input, 'Nouveau titre{Enter}')

    expect(useCardsStore.getState().history.present[0].title).toBe('Nouveau titre')
  })

  it('cancels the edit on Escape without changing the stored title', async () => {
    const user = userEvent.setup()
    renderCardNode(testCard)

    const input = screen.getByRole('textbox', { name: /titre/i })
    await user.click(input)
    await user.type(input, ' modifié{Escape}')

    expect(useCardsStore.getState().history.present[0].title).toBe('Titre initial')
    expect(input).toHaveValue('Titre initial')
  })

  it('does not push a history entry when the title is committed unchanged', async () => {
    const user = userEvent.setup()
    renderCardNode(testCard)
    const before = useCardsStore.getState().history

    await user.click(screen.getByRole('textbox', { name: /titre/i }))
    await user.keyboard('{Enter}')

    expect(useCardsStore.getState().history).toBe(before)
  })

  it('re-seeds the title draft from the card each time the field regains focus', async () => {
    const user = userEvent.setup()
    const { rerenderWith } = renderCardNode(testCard)

    // Type a draft, then leave the field without committing.
    const input = screen.getByRole('textbox', { name: /titre/i })
    await user.click(input)
    await user.type(input, ' brouillon{Escape}')

    // The card changes underneath us (an undo, a reload, a concurrent edit).
    rerenderWith({ ...testCard, title: 'Titre externe' })

    await user.click(screen.getByRole('textbox', { name: /titre/i }))
    expect(screen.getByRole('textbox', { name: /titre/i })).toHaveValue('Titre externe')
  })

  it('focuses and selects the title field on mount when the node is flagged autoEdit', () => {
    renderCardNode(testCard, true)
    const input = screen.getByRole('textbox', { name: /titre/i }) as HTMLInputElement
    expect(input).toHaveFocus()
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('Titre initial'.length)
  })

  it('does not focus the title field when autoEdit is not set', () => {
    renderCardNode(testCard)
    expect(screen.getByRole('textbox', { name: /titre/i })).not.toHaveFocus()
  })

  // testCard is the root: canAddSibling is false, so "ajouter au-dessus/en
  // dessous" never render regardless of lock. This only asserts on the
  // buttons that DO render for a root ("->" and "x") plus the drag handle,
  // which is always present.
  it('hides the structural buttons and the drag handle (but keeps their space) when the mind map is locked', () => {
    useCardsStore.setState({ locked: true })
    renderCardNode(testCard)

    // `hidden: true` is required to even find these: getByRole excludes
    // inaccessible (visibility: hidden) elements by default. Their accessible
    // name also resolves to "" once hidden, so buttons are located by their
    // aria-label attribute directly rather than by accessible name matching.
    const hiddenButtons = screen.getAllByRole('button', { hidden: true })
    const addChildButton = hiddenButtons.find(el => el.getAttribute('aria-label') === 'Ajouter un enfant')
    const deleteButton = hiddenButtons.find(el => el.getAttribute('aria-label') === 'Supprimer')

    expect(addChildButton).not.toBeVisible()
    expect(deleteButton).not.toBeVisible()
    expect(screen.getByTestId('drag-handle')).not.toBeVisible()
  })

  it('keeps the structural buttons visible when the mind map is unlocked', () => {
    renderCardNode(testCard)

    expect(screen.getByRole('button', { name: /ajouter un enfant/i })).toBeVisible()
    expect(screen.getByRole('button', { name: /supprimer/i })).toBeVisible()
    expect(screen.getByTestId('drag-handle')).toBeVisible()
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

  it('does not render the + buttons on the root card (single-root invariant)', () => {
    renderCardNode(testCard)
    expect(screen.queryByRole('button', { name: /ajouter au-dessus/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ajouter en dessous/i })).not.toBeInTheDocument()
  })

  it('does not render the -> button on a level-4 card (no level 5)', () => {
    const level4: Card = { id: 'l4', level: 4, title: 'Info', parentId: 'root', order: 0 }
    resetStore([testCard, level4])
    renderCardNode(level4)
    expect(screen.queryByRole('button', { name: /ajouter un enfant/i })).not.toBeInTheDocument()
  })

  it('does not render the -> button once the card already has a child', () => {
    const child: Card = { id: 'child', level: 2, title: 'Enfant', parentId: 'root', order: 0 }
    resetStore([testCard, child])
    renderCardNode(testCard)
    expect(screen.queryByRole('button', { name: /ajouter un enfant/i })).not.toBeInTheDocument()
  })

  it('renders the -> button when the card has no child yet', () => {
    const child: Card = { id: 'child', level: 2, title: 'Enfant', parentId: 'root', order: 0 }
    resetStore([testCard, child])
    renderCardNode(child)
    expect(screen.getByRole('button', { name: /ajouter un enfant/i })).toBeInTheDocument()
  })

  it('renders the + and -> buttons for an applicable card', () => {
    const child: Card = { id: 'child', level: 2, title: 'Enfant', parentId: 'root', order: 0 }
    resetStore([testCard, child])
    renderCardNode(child)
    expect(screen.getByRole('button', { name: /ajouter au-dessus/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ajouter un enfant/i })).toBeInTheDocument()
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
  beforeEach(() => {
    resetStore([testCard])
    const pristineQuiz = createQuizStore().getState()
    useQuizStore.setState({
      active: pristineQuiz.active,
      showSummary: pristineQuiz.showSummary,
      config: pristineQuiz.config,
      questions: pristineQuiz.questions,
      results: pristineQuiz.results,
      wasLockedBeforeQuiz: pristineQuiz.wasLockedBeforeQuiz,
    })
  })

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

  it('masks the title while a quiz recall question on this card is unanswered', () => {
    renderCardNode(testCard, false, false, { type: 'recall', result: 'unanswered' })

    expect(screen.getByRole('textbox', { name: /titre/i })).not.toHaveValue('Titre initial')
  })

  it('does not mask the title when no quiz question applies to this card', () => {
    renderCardNode(testCard)

    expect(screen.getByRole('textbox', { name: /titre/i })).toHaveValue('Titre initial')
  })

  it('reveals the real title after clicking "Révéler la réponse"', async () => {
    const user = userEvent.setup()
    renderCardNode(testCard, false, false, { type: 'recall', result: 'unanswered' })

    await user.click(screen.getByRole('button', { name: /révéler la réponse/i }))

    expect(screen.getByRole('textbox', { name: /titre/i })).toHaveValue('Titre initial')
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

  it('marks itself as a reparent drop target when data.isReparentTarget is set', () => {
    renderCardNode(testCard, false, true)
    expect(screen.getByTestId(`card-${testCard.id}`)).toHaveAttribute('data-reparent-target', 'true')
  })

  it('does not mark itself as a reparent drop target by default', () => {
    renderCardNode(testCard)
    expect(screen.getByTestId(`card-${testCard.id}`)).toHaveAttribute('data-reparent-target', 'false')
  })

  it('makes the title read-only when the mind map is locked', async () => {
    const user = userEvent.setup()
    useCardsStore.setState({ locked: true })
    renderCardNode(testCard)

    const input = screen.getByRole('textbox', { name: /titre/i })
    await user.click(input)
    await user.type(input, ' modifié{Enter}')

    expect(useCardsStore.getState().history.present[0].title).toBe('Titre initial')
  })

  it('disables the "add definition" button when the mind map is locked', () => {
    useCardsStore.setState({ locked: true })
    renderCardNode(testCard)

    expect(screen.getByRole('button', { name: /ajouter une définition/i })).toBeDisabled()
  })

  it('shows self-grade buttons once a revealed recall question is unanswered', async () => {
    const user = userEvent.setup()
    renderCardNode(testCard, false, false, { type: 'recall', result: 'unanswered' })

    await user.click(screen.getByRole('button', { name: /révéler la réponse/i }))

    expect(screen.getByRole('button', { name: /je savais/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /je ne savais pas/i })).toBeInTheDocument()
  })

  it('clicking "Je savais" records a correct answer in the quiz store', async () => {
    const user = userEvent.setup()
    renderCardNode(testCard, false, false, { type: 'recall', result: 'unanswered' })
    await user.click(screen.getByRole('button', { name: /révéler la réponse/i }))

    await user.click(screen.getByRole('button', { name: /je savais/i }))

    expect(useQuizStore.getState().results[testCard.id]).toBe('correct')
  })

  it('clicking "Je ne savais pas" records an incorrect answer in the quiz store', async () => {
    const user = userEvent.setup()
    renderCardNode(testCard, false, false, { type: 'recall', result: 'unanswered' })
    await user.click(screen.getByRole('button', { name: /révéler la réponse/i }))

    await user.click(screen.getByRole('button', { name: /je ne savais pas/i }))

    expect(useQuizStore.getState().results[testCard.id]).toBe('incorrect')
  })

  it('shows a green border and no grading buttons once graded correct', () => {
    renderCardNode(testCard, false, false, { type: 'recall', result: 'correct' })

    expect(screen.queryByRole('button', { name: /je savais/i })).not.toBeInTheDocument()
    expect(screen.getByTestId(`card-${testCard.id}`)).toHaveStyle({ borderColor: '#16a34a' })
  })

  it('shows a red border once graded incorrect', () => {
    renderCardNode(testCard, false, false, { type: 'recall', result: 'incorrect' })

    expect(screen.getByTestId(`card-${testCard.id}`)).toHaveStyle({ borderColor: '#dc2626' })
  })

  it('opens the definition for editing when the shown definition text is clicked', async () => {
    const user = userEvent.setup()
    resetStore([cardWithDefinition])
    renderCardNode(cardWithDefinition)

    await user.click(screen.getByRole('button', { name: /afficher la définition/i }))
    await user.click(screen.getByText('Définition existante'))

    expect(screen.getByRole('textbox', { name: /définition/i })).toHaveValue('Définition existante')
  })

  it('does not open the definition for editing when the mind map is locked', async () => {
    const user = userEvent.setup()
    resetStore([cardWithDefinition])
    renderCardNode(cardWithDefinition)
    await user.click(screen.getByRole('button', { name: /afficher la définition/i }))
    useCardsStore.setState({ locked: true })

    await user.click(screen.getByText('Définition existante'))

    expect(screen.queryByRole('textbox', { name: /définition/i })).not.toBeInTheDocument()
  })
})
