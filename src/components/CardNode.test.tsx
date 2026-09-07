import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
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
    // `nextQuiz` always reflects the caller's intent exactly (including an
    // explicit `undefined`, e.g. to simulate a quiz ending) — no fallback to
    // the initial `quiz` closure, since no existing caller needs one.
    rerenderWith: (next: Card, nextQuiz?: QuizData) =>
      result.rerender(
        <ReactFlowProvider>
          <CardNode {...cardNodeProps(next, autoEdit, isReparentTarget, nextQuiz)} />
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

    expect(addChildButton).not.toBeVisible()
    expect(screen.getByTestId('drag-handle')).not.toBeVisible()
    // The footer actions stay in place (they are part of the card's own
    // layout, not floating chrome) and are disabled instead.
    expect(screen.getByRole('button', { name: 'Supprimer' })).toBeDisabled()
  })

  it('keeps the structural buttons visible when the mind map is unlocked', () => {
    renderCardNode(testCard)

    expect(screen.getByRole('button', { name: /ajouter un enfant/i })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Supprimer' })).toBeVisible()
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
    expect(screen.getByRole('button', { name: 'Supprimer' })).toBeEnabled()
  })
})

describe('CardNode delete', () => {
  beforeEach(() => resetStore([testCard]))

  const child: Card = { id: 'child', level: 2, title: 'Enfant', parentId: 'root', order: 0 }
  const grandchild: Card = { id: 'grandchild', level: 3, title: 'Petit-enfant', parentId: 'child', order: 0 }

  it('deletes immediately when the card has no children', async () => {
    const user = userEvent.setup()
    resetStore([testCard, child])
    renderCardNode(child)

    await user.click(screen.getByRole('button', { name: 'Supprimer' }))
    expect(useCardsStore.getState().history.present).toHaveLength(1)
  })

  it('offers three ways out when the card has children', async () => {
    const user = userEvent.setup()
    resetStore([testCard, child, grandchild])
    renderCardNode(child)

    await user.click(screen.getByRole('button', { name: 'Supprimer' }))
    expect(screen.getByText(/supprimer cette carte et ses 1 descendants/i)).toBeInTheDocument()
    for (const name of [/annuler/i, /détacher les enfants/i, /tout supprimer/i]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(useCardsStore.getState().history.present).toHaveLength(3)
  })

  it('"Tout supprimer" removes the card and its whole branch', async () => {
    const user = userEvent.setup()
    resetStore([testCard, child, grandchild])
    renderCardNode(child)

    await user.click(screen.getByRole('button', { name: 'Supprimer' }))
    await user.click(screen.getByRole('button', { name: /tout supprimer/i }))
    expect(useCardsStore.getState().history.present.map(c => c.id)).toEqual(['root'])
  })

  it('"Détacher les enfants" removes only the card, keeping its branch as floating cards', async () => {
    const user = userEvent.setup()
    resetStore([testCard, child, grandchild])
    renderCardNode(child)

    await user.click(screen.getByRole('button', { name: 'Supprimer' }))
    await user.click(screen.getByRole('button', { name: /détacher les enfants/i }))

    const cards = useCardsStore.getState().history.present
    expect(cards.find(c => c.id === 'child')).toBeUndefined()
    expect(cards.find(c => c.id === 'grandchild')).toMatchObject({ detached: true, parentId: null })
  })

  it('"Annuler" closes the dialog without touching anything', async () => {
    const user = userEvent.setup()
    resetStore([testCard, child, grandchild])
    renderCardNode(child)

    await user.click(screen.getByRole('button', { name: 'Supprimer' }))
    await user.click(screen.getByRole('button', { name: /annuler/i }))
    expect(useCardsStore.getState().history.present).toHaveLength(3)
  })

  it('disables the delete button on a childless root (nothing to remove)', () => {
    renderCardNode(testCard)
    expect(screen.getByRole('button', { name: 'Supprimer' })).toBeDisabled()
  })

  it('lets the root empty itself, saying the root card is kept', async () => {
    const user = userEvent.setup()
    resetStore([testCard, child, grandchild])
    renderCardNode(testCard)

    await user.click(screen.getByRole('button', { name: 'Supprimer' }))
    expect(screen.getByText(/supprimer les 2 descendants de la carte racine/i)).toBeInTheDocument()
    expect(screen.getByText(/la carte racine ne peut pas être supprimée/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /tout supprimer/i }))
    expect(useCardsStore.getState().history.present.map(c => c.id)).toEqual(['root'])
  })
})

describe('CardNode detach', () => {
  const child: Card = { id: 'child', level: 2, title: 'Enfant', parentId: 'root', order: 0 }
  const grandchild: Card = { id: 'grandchild', level: 3, title: 'Petit-enfant', parentId: 'child', order: 0 }

  beforeEach(() => resetStore([testCard, child]))

  it('detaches a childless card straight away, no dialog', async () => {
    const user = userEvent.setup()
    renderCardNode(child)

    await user.click(screen.getByRole('button', { name: /détacher/i }))
    expect(useCardsStore.getState().history.present.find(c => c.id === 'child')).toMatchObject({
      detached: true,
      parentId: null,
    })
  })

  it('warns how many floating cards a branch would be flattened into', async () => {
    const user = userEvent.setup()
    resetStore([testCard, child, grandchild])
    renderCardNode(child)

    await user.click(screen.getByRole('button', { name: /détacher/i }))
    expect(screen.getByText(/deviendront 2 cartes volantes individuelles/i)).toBeInTheDocument()
    // Nothing happens until the user accepts.
    expect(useCardsStore.getState().history.present.some(c => c.detached)).toBe(false)

    await user.click(screen.getByRole('button', { name: /accepter/i }))
    const cards = useCardsStore.getState().history.present
    expect(cards.filter(c => c.detached).map(c => c.id)).toEqual(['child', 'grandchild'])
  })

  it('cancelling the flatten dialog leaves the branch alone', async () => {
    const user = userEvent.setup()
    resetStore([testCard, child, grandchild])
    renderCardNode(child)

    await user.click(screen.getByRole('button', { name: /détacher/i }))
    await user.click(screen.getByRole('button', { name: /annuler/i }))
    expect(useCardsStore.getState().history.present.some(c => c.detached)).toBe(false)
  })

  it('offers no detach action on the root card', () => {
    renderCardNode(testCard)
    expect(screen.queryByRole('button', { name: /détacher/i })).not.toBeInTheDocument()
  })

  it('disables the detach action while the mind map is locked', () => {
    useCardsStore.getState().toggleLock()
    renderCardNode(child)
    expect(screen.getByRole('button', { name: /détacher/i })).toBeDisabled()
  })
})

describe('CardNode floating (detached) cards', () => {
  const floating: Card = { id: 'floating', level: 3, title: 'Volante', parentId: null, order: 0, detached: true }

  beforeEach(() => resetStore([testCard, floating]))

  it('marks itself as detached so the canvas can grey it out', () => {
    renderCardNode(floating)
    expect(screen.getByTestId('card-floating')).toHaveAttribute('data-detached', 'true')
    expect(screen.getByTestId('card-floating').className).toContain('card-node--detached')
  })

  it('offers no way to give it children or siblings (it is a scratch area)', () => {
    renderCardNode(floating)
    expect(screen.queryByRole('button', { name: /ajouter un enfant/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ajouter au-dessus/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ajouter en dessous/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /détacher/i })).not.toBeInTheDocument()
  })

  it('can still be deleted — it is not the root, despite having no parent', async () => {
    const user = userEvent.setup()
    renderCardNode(floating)

    const deleteButton = screen.getByRole('button', { name: 'Supprimer' })
    expect(deleteButton).toBeEnabled()
    await user.click(deleteButton)
    expect(useCardsStore.getState().history.present.map(c => c.id)).toEqual(['root'])
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

  it('resets quizRevealed when the quiz ends, so a second quiz session drawing the same card masks it again', async () => {
    const user = userEvent.setup()
    const { rerenderWith } = renderCardNode(testCard, false, false, { type: 'recall', result: 'unanswered' })

    await user.click(screen.getByRole('button', { name: /révéler la réponse/i }))
    expect(screen.getByRole('textbox', { name: /titre/i })).toHaveValue('Titre initial')

    // The quiz ends: this card is no longer part of any question.
    rerenderWith(testCard, undefined)
    // A second quiz later draws the SAME card again as a recall question.
    rerenderWith(testCard, { type: 'recall', result: 'unanswered' })

    expect(screen.getByRole('textbox', { name: /titre/i })).not.toHaveValue('Titre initial')
    expect(screen.queryByRole('button', { name: /je savais/i })).not.toBeInTheDocument()
  })

  it('does not reveal the real title or show grading buttons when the masked title field is focused', async () => {
    const user = userEvent.setup()
    renderCardNode(testCard, false, false, { type: 'recall', result: 'unanswered' })

    const input = screen.getByRole('textbox', { name: /titre/i })
    await user.click(input)

    expect(input).not.toHaveValue('Titre initial')
    expect(screen.queryByRole('button', { name: /je savais/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /je ne savais pas/i })).not.toBeInTheDocument()
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

  it('opens the QCM dialog when a pending qcm question\'s "Répondre" button is clicked', async () => {
    const user = userEvent.setup()
    const cardWithDef: Card = { ...testCard, definition: 'Bonne définition' }
    resetStore([cardWithDef])
    renderCardNode(cardWithDef, false, false, {
      type: 'qcm',
      result: 'unanswered',
      distractorDefinitions: ['Fausse A', 'Fausse B'],
    })

    await user.click(screen.getByRole('button', { name: /répondre/i }))

    expect(screen.getByRole('heading', { name: cardWithDef.title })).toBeInTheDocument()
    expect(screen.getByText('Bonne définition')).toBeInTheDocument()
    expect(screen.getByText('Fausse A')).toBeInTheDocument()
  })

  it('records the qcm answer in the quiz store once a choice is made', async () => {
    vi.useFakeTimers()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const cardWithDef: Card = { ...testCard, definition: 'Bonne définition' }
    resetStore([cardWithDef])
    renderCardNode(cardWithDef, false, false, {
      type: 'qcm',
      result: 'unanswered',
      distractorDefinitions: ['Fausse A'],
    })

    await user.click(screen.getByRole('button', { name: /répondre/i }))
    await user.click(screen.getByText('Bonne définition'))
    vi.advanceTimersByTime(700)

    expect(useQuizStore.getState().results[cardWithDef.id]).toBe('correct')
    vi.useRealTimers()
  })
})
