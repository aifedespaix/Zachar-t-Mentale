import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ReactFlowProvider, type NodeProps } from '@xyflow/react'
import { CardNode } from './CardNode'
import { useCardsStore, createCardsStore } from '../state/useCardsStore'
import { useQuizStore, createQuizStore } from '../state/useQuizStore'
import type { Card } from '../types/card'
import type { QuizQuestionType, QuizResult } from '../types/quiz'
import { EMPTY_RECALL_PROGRESS } from '../types/quiz'
import { useQuizSettingsStore } from '../state/useQuizSettingsStore'
import { useCardDetailStore } from '../state/useCardDetailStore'
import { DEFAULT_QUIZ_SETTINGS } from '../types/quizSettings'

type QuizData = {
  type: QuizQuestionType
  result: QuizResult
  distractorDefinitions?: string[]
  distractorTitles?: string[]
  hint?: string
}

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

/** Same idea for the quiz singleton, which CardNode now reads directly. */
function resetQuizStore() {
  const pristine = createQuizStore().getState()
  useQuizStore.setState({
    active: pristine.active,
    showSummary: pristine.showSummary,
    config: pristine.config,
    questions: pristine.questions,
    results: pristine.results,
    recallProgress: pristine.recallProgress,
    wasLockedBeforeQuiz: pristine.wasLockedBeforeQuiz,
  })
}

describe('CardNode', () => {
  beforeEach(() => {
    useCardDetailStore.getState().closeAll()
    resetStore([testCard])
    resetQuizStore()
    useQuizSettingsStore.setState(DEFAULT_QUIZ_SETTINGS)
  })

  it('displays the card title in an always-present field (no click needed to reveal it)', () => {
    renderCardNode(testCard)
    expect(screen.getByRole('textbox', { name: /titre/i })).toHaveValue('Titre initial')
  })

  it('renders the title as a multi-line field so a long title wraps onto two lines like the export, instead of scrolling horizontally', () => {
    renderCardNode(testCard)
    expect(screen.getByRole('textbox', { name: /titre/i }).tagName).toBe('TEXTAREA')
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

describe('CardNode mnemonic icon', () => {
  const cardWithIcon: Card = { ...testCard, icon: 'Brain' }

  beforeEach(() => {
    useCardDetailStore.getState().closeAll()
    resetStore([testCard])
    resetQuizStore()
  })

  it('offers an empty icon slot on a card that has none', () => {
    renderCardNode(testCard)
    expect(screen.getByRole('button', { name: 'Ajouter une icône' })).toBeInTheDocument()
    expect(screen.getByTestId('card-icon-badge')).not.toHaveAttribute('data-icon')
  })

  it('shows the card’s icon, and offers to change it', () => {
    renderCardNode(cardWithIcon)
    expect(screen.getByTestId('card-icon-badge')).toHaveAttribute('data-icon', 'Brain')
    expect(screen.getByRole('button', { name: 'Changer l’icône' })).toBeInTheDocument()
  })

  it('renders nothing at all for an icon name it does not know', () => {
    // A card written by a later version of the app, or hand-edited: the name
    // is unusable, the card still renders.
    renderCardNode({ ...testCard, icon: 'PasUneIcone' })
    expect(screen.getByTestId('card-icon-badge')).not.toHaveAttribute('data-icon')
  })

  it('picks an icon from the dialog and stores it on the card', async () => {
    const user = userEvent.setup()
    renderCardNode(testCard)

    await user.click(screen.getByRole('button', { name: 'Ajouter une icône' }))
    await user.type(screen.getByRole('searchbox', { name: 'Rechercher une icône' }), 'cerveau')
    await user.click(await screen.findByRole('option', { name: 'brain' }))

    expect(useCardsStore.getState().history.present[0].icon).toBe('Brain')
    // The choice closes the dialog: there is nothing else to do in it.
    expect(screen.queryByText('Choisir une icône')).not.toBeInTheDocument()
  })

  it('removes the icon from the dialog, leaving no key behind', async () => {
    const user = userEvent.setup()
    resetStore([cardWithIcon])
    renderCardNode(cardWithIcon)

    await user.click(screen.getByRole('button', { name: 'Changer l’icône' }))
    await user.click(screen.getByRole('button', { name: 'Retirer l’icône' }))

    expect('icon' in useCardsStore.getState().history.present[0]).toBe(false)
  })

  it('offers nothing to remove on a card that has no icon', async () => {
    const user = userEvent.setup()
    renderCardNode(testCard)

    await user.click(screen.getByRole('button', { name: 'Ajouter une icône' }))

    expect(screen.queryByRole('button', { name: 'Retirer l’icône' })).not.toBeInTheDocument()
  })

  it('keeps showing the icon on a locked map, but not as a button', () => {
    resetStore([cardWithIcon])
    useCardsStore.getState().toggleLock()
    renderCardNode(cardWithIcon)

    // The picture is the memory hook the card exists for — it stays. Changing
    // it is an edit, and the map is locked.
    expect(screen.getByTestId('card-icon-badge')).toHaveAttribute('data-icon', 'Brain')
    expect(screen.queryByRole('button', { name: 'Changer l’icône' })).not.toBeInTheDocument()
  })

  it('drops the empty slot entirely on a locked map', () => {
    useCardsStore.getState().toggleLock()
    renderCardNode(testCard)
    expect(screen.queryByTestId('card-icon-badge')).not.toBeInTheDocument()
  })

  it('keeps the icon during a quiz, without the button', () => {
    resetStore([cardWithIcon])
    useQuizStore.setState({ active: true })
    renderCardNode(cardWithIcon)

    expect(screen.getByTestId('card-icon-badge')).toHaveAttribute('data-icon', 'Brain')
    expect(screen.queryByRole('button', { name: 'Changer l’icône' })).not.toBeInTheDocument()
  })
})

describe('CardNode footer', () => {
  beforeEach(() => {
    useCardDetailStore.getState().closeAll()
    resetStore([testCard])
    resetQuizStore()
    useQuizSettingsStore.setState(DEFAULT_QUIZ_SETTINGS)
    // Pinned to the hardest level so the masks below are exact: it concedes
    // the first letter and nothing else.
    useQuizStore.setState({ config: { levels: [1, 2, 3, 4], difficulty: 'difficile', qcmMode: false } })
  })

  it('shows an "add description" affordance when there is none yet', () => {
    renderCardNode(testCard)
    expect(screen.getByRole('button', { name: /ajouter une description/i })).toBeInTheDocument()
  })

  it('previews an existing description on one elided line, with badges for what else is in it', () => {
    resetStore([{ ...cardWithDefinition, content: [{ kind: 'math', latex: '\\frac{1}{2}' }] }])
    renderCardNode({ ...cardWithDefinition, content: [{ kind: 'math', latex: '\\frac{1}{2}' }] })

    const button = screen.getByRole('button', { name: /afficher la description/i })
    expect(within(button).getByLabelText(/contient une formule/i)).toBeInTheDocument()
  })

  it('keeps the description control the same height in both states', () => {
    // Règle anti-décalage 1: two neighbouring cards must stay the same height,
    // or writing a definition shifts the whole tree.
    const { unmount } = renderCardNode(testCard)
    const empty = screen.getByRole('button', { name: /ajouter une description/i }).style.height
    unmount()

    resetStore([cardWithDefinition])
    renderCardNode(cardWithDefinition)
    const filled = screen.getByRole('button', { name: /afficher la description/i }).style.height

    expect(empty).toBe(filled)
    expect(empty).not.toBe('')
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

  it('replaces the title field with the shape of the answer while a recall question is pending', () => {
    renderCardNode(testCard, false, false, { type: 'recall', result: 'unanswered' })

    // No editable field at all: the answer belongs in the answer dialog, and a
    // text box on the card only invited typing that would never be graded.
    expect(screen.queryByRole('textbox', { name: /titre/i })).not.toBeInTheDocument()
    // "Titre initial", with the first letter conceded by the default difficulty.
    expect(screen.getByTestId('quiz-title')).toHaveTextContent('T____ _______')
  })

  it('gives the same letter-count hint on a qcm-title question as on recall — the visual aid stays systematic across Sens A variants', () => {
    renderCardNode(testCard, false, false, {
      type: 'qcm-title',
      result: 'unanswered',
      distractorTitles: ['Autre titre'],
    })

    // "Titre initial", first letter conceded by the default ("moyen") difficulty.
    expect(screen.getByTestId('quiz-title')).toHaveTextContent('T____ _______')
  })

  it('gives the same letter-count hint on a qcm-media-title question as on recall', () => {
    const mediaCard: Card = { ...testCard, kind: 'media', content: [{ kind: 'table', header: ['A'], rows: [['1']] }] }
    renderCardNode(mediaCard, false, false, {
      type: 'qcm-media-title',
      result: 'unanswered',
      distractorTitles: ['Autre titre'],
    })

    expect(screen.getByTestId('quiz-title')).toHaveTextContent('T____ _______')
  })

  it('shows the real title for a qcm-definition question, since the title IS the question', () => {
    renderCardNode(cardWithDefinition, false, false, {
      type: 'qcm-definition',
      result: 'unanswered',
      distractorDefinitions: ['Une autre définition'],
    })

    expect(screen.getByTestId('quiz-title')).toHaveTextContent('Titre initial')
  })

  it('reveals the title once the question has been answered', () => {
    renderCardNode(testCard, false, false, { type: 'recall', result: 'correct' })
    expect(screen.getByTestId('quiz-title')).toHaveTextContent('Titre initial')
  })

  it('hides the blank when the length guide is switched off', () => {
    useQuizSettingsStore.setState({ lengthGuideEnabled: false })
    renderCardNode(testCard, false, false, { type: 'recall', result: 'unanswered' })

    expect(screen.getByTestId('quiz-title')).toHaveTextContent('? ? ?')
  })

  it('widens the blank as failed attempts buy more letters', () => {
    useQuizStore.setState({
      recallProgress: { [testCard.id]: { ...EMPTY_RECALL_PROGRESS, attempts: 2, extraReveals: 2 } },
    })
    renderCardNode(testCard, false, false, { type: 'recall', result: 'unanswered' })

    // Two more letters have been conceded since the first attempt.
    expect(screen.getByTestId('quiz-title')?.textContent?.replace(/[^_]/g, '').length).toBe(9)
  })

  it('does not mask the title when no quiz question applies to this card', () => {
    renderCardNode(testCard)

    expect(screen.getByRole('textbox', { name: /titre/i })).toHaveValue('Titre initial')
  })

  it('puts a Répondre button on a card that is waiting for an answer', () => {
    renderCardNode(testCard, false, false, { type: 'recall', result: 'unanswered' })
    expect(screen.getByTestId('answer-button')).toHaveTextContent('Répondre')
  })

  it('drops the Répondre button once the card has been answered', () => {
    renderCardNode(testCard, false, false, { type: 'recall', result: 'correct' })
    expect(screen.queryByTestId('answer-button')).not.toBeInTheDocument()
  })

  it('marks an answered card with its verdict, not only with a border colour', () => {
    renderCardNode(testCard, false, false, { type: 'recall', result: 'incorrect' })
    expect(screen.getByLabelText('Mauvaise réponse')).toBeInTheDocument()
  })

  it('hides the whole editing toolbar while a quiz is running, on every card', () => {
    useQuizStore.setState({ active: true })
    renderCardNode(testCard)

    expect(screen.queryByRole('button', { name: /supprimer/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /retourner/i })).not.toBeInTheDocument()
  })

  it('opens the answer dialog from the Répondre button', async () => {
    const user = userEvent.setup()
    renderCardNode(testCard, false, false, { type: 'recall', result: 'unanswered' })

    await user.click(screen.getByTestId('answer-button'))

    expect(screen.getByRole('heading', { name: /retrouve le titre/i })).toBeInTheDocument()
  })

  it('opens the answer dialog by clicking the card itself', async () => {
    const user = userEvent.setup()
    renderCardNode(testCard, false, false, { type: 'recall', result: 'unanswered' })

    await user.click(screen.getByTestId('quiz-title'))

    expect(screen.getByRole('heading', { name: /retrouve le titre/i })).toBeInTheDocument()
  })

  it('opens the multiple-choice dialog for a qcm-title question instead', async () => {
    const user = userEvent.setup()
    renderCardNode(testCard, false, false, {
      type: 'qcm-title',
      result: 'unanswered',
      distractorTitles: ['Autre titre'],
    })

    await user.click(screen.getByTestId('answer-button'))

    expect(screen.getByRole('heading', { name: /quel est le titre/i })).toBeInTheDocument()
  })

  it('grades an answer typed in the recall dialog', async () => {
    const user = userEvent.setup()
    useQuizStore.setState({ results: { [testCard.id]: 'unanswered' }, recallProgress: {} })
    renderCardNode(testCard, false, false, { type: 'recall', result: 'unanswered' })

    await user.click(screen.getByTestId('answer-button'))
    await user.type(screen.getByLabelText('Réponse'), 'itreinitial')
    await user.click(screen.getByRole('button', { name: 'Valider' }))

    expect(useQuizStore.getState().results[testCard.id]).toBe('correct')
  })

  it('keeps a missed card open, with one more letter, instead of grading it wrong', async () => {
    const user = userEvent.setup()
    useQuizStore.setState({
      results: { [testCard.id]: 'unanswered' },
      recallProgress: { [testCard.id]: { ...EMPTY_RECALL_PROGRESS } },
    })
    renderCardNode(testCard, false, false, { type: 'recall', result: 'unanswered' })

    await user.click(screen.getByTestId('answer-button'))
    await user.type(screen.getByLabelText('Réponse'), 'otalementfaux')
    await user.click(screen.getByRole('button', { name: 'Valider' }))

    expect(useQuizStore.getState().results[testCard.id]).toBe('unanswered')
    expect(useQuizStore.getState().recallProgress[testCard.id].extraReveals).toBe(1)
  })

  it('never writes a typed guess back into the card title', async () => {
    const user = userEvent.setup()
    useQuizStore.setState({ results: { [testCard.id]: 'unanswered' }, recallProgress: {} })
    renderCardNode(testCard, false, false, { type: 'recall', result: 'unanswered' })

    await user.click(screen.getByTestId('answer-button'))
    await user.type(screen.getByLabelText('Réponse'), 'unetentative')
    await user.click(screen.getByRole('button', { name: 'Valider' }))

    expect(useCardsStore.getState().history.present[0].title).toBe('Titre initial')
  })

  it('answers from the dialog even though a quiz always locks the mind map', async () => {
    const user = userEvent.setup()
    useCardsStore.setState({ locked: true })
    useQuizStore.setState({ active: true, results: { [testCard.id]: 'unanswered' }, recallProgress: {} })
    renderCardNode(testCard, false, false, { type: 'recall', result: 'unanswered' })

    await user.click(screen.getByTestId('answer-button'))
    await user.type(screen.getByLabelText('Réponse'), 'itreinitial')
    await user.click(screen.getByRole('button', { name: 'Valider' }))

    expect(useQuizStore.getState().results[testCard.id]).toBe('correct')
  })

  it('opens the fiche AND its editor when the card has nothing to read yet', async () => {
    // A card with no description has nothing to show, so sending the user to
    // an empty panel to find an "add" button would spend a click on nothing.
    const user = userEvent.setup()
    renderCardNode(testCard)

    await user.click(screen.getByRole('button', { name: /ajouter une description/i }))

    expect(useCardDetailStore.getState().open.map(entry => entry.cardId)).toEqual([testCard.id])
    expect(useCardDetailStore.getState().editingCardId).toBe(testCard.id)
  })

  it('opens the fiche for reading when the card already has a description', async () => {
    const user = userEvent.setup()
    resetStore([cardWithDefinition])
    renderCardNode(cardWithDefinition)

    await user.click(screen.getByRole('button', { name: /afficher la description/i }))

    expect(useCardDetailStore.getState().open.map(entry => entry.cardId)).toEqual([cardWithDefinition.id])
    // Reading is the common case: the editor is one more click away, not the
    // destination.
    expect(useCardDetailStore.getState().editingCardId).toBeNull()
  })

  it('opens a fiche in preview, so browsing a map does not pile panels up', async () => {
    const user = userEvent.setup()
    resetStore([cardWithDefinition])
    renderCardNode(cardWithDefinition)

    await user.click(screen.getByRole('button', { name: /afficher la description/i }))
    await user.click(screen.getByRole('button', { name: /afficher la description/i }))

    expect(useCardDetailStore.getState().open).toHaveLength(1)
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

  it('disables the "add description" button when the mind map is locked', () => {
    useCardsStore.setState({ locked: true })
    renderCardNode(testCard)

    expect(screen.getByRole('button', { name: /ajouter une description/i })).toBeDisabled()
  })

  it('still opens the fiche of a card that HAS a description on a locked map', async () => {
    // Locking stops editing, not reading, and the fiche is the reading surface.
    const user = userEvent.setup()
    resetStore([cardWithDefinition])
    useCardsStore.setState({ locked: true })
    renderCardNode(cardWithDefinition)

    await user.click(screen.getByRole('button', { name: /afficher la description/i }))

    expect(useCardDetailStore.getState().open.map(entry => entry.cardId)).toEqual([cardWithDefinition.id])
    expect(useCardDetailStore.getState().editingCardId).toBeNull()
  })

  it('shows a green border once graded correct', () => {
    renderCardNode(testCard, false, false, { type: 'recall', result: 'correct' })
    expect(screen.getByTestId(`card-${testCard.id}`)).toHaveStyle({ borderColor: '#16a34a' })
  })

  it('shows a red border once graded incorrect', () => {
    renderCardNode(testCard, false, false, { type: 'recall', result: 'incorrect' })

    expect(screen.getByTestId(`card-${testCard.id}`)).toHaveStyle({ borderColor: '#dc2626' })
  })

  it('opens the QCM dialog when a pending qcm-definition question\'s "Répondre" button is clicked', async () => {
    const user = userEvent.setup()
    const cardWithDef: Card = { ...testCard, definition: 'Bonne définition' }
    resetStore([cardWithDef])
    renderCardNode(cardWithDef, false, false, {
      type: 'qcm-definition',
      result: 'unanswered',
      distractorDefinitions: ['Fausse A', 'Fausse B'],
    })

    await user.click(screen.getByRole('button', { name: /répondre/i }))

    // Scoped to the dialog: the card behind it previews its own description,
    // so a bare query would match the answer twice. (Not a leak in the app —
    // a real quiz hides the card's whole footer.)
    const dialog = within(screen.getByRole('dialog'))
    expect(screen.getByRole('heading', { name: cardWithDef.title })).toBeInTheDocument()
    expect(dialog.getByText('Bonne définition')).toBeInTheDocument()
    expect(dialog.getByText('Fausse A')).toBeInTheDocument()
  })

  it('records the qcm-definition answer in the quiz store once a choice is made', async () => {
    vi.useFakeTimers()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const cardWithDef: Card = { ...testCard, definition: 'Bonne définition' }
    resetStore([cardWithDef])
    renderCardNode(cardWithDef, false, false, {
      type: 'qcm-definition',
      result: 'unanswered',
      distractorDefinitions: ['Fausse A'],
    })

    await user.click(screen.getByRole('button', { name: /répondre/i }))
    await user.click(within(screen.getByRole('dialog')).getByText('Bonne définition'))
    vi.advanceTimersByTime(700)

    expect(useQuizStore.getState().results[cardWithDef.id]).toBe('correct')
    vi.useRealTimers()
  })

  it('opens a qcm-title question showing the hint and title options, without leaking the real title as the heading', async () => {
    const user = userEvent.setup()
    renderCardNode(testCard, false, false, {
      type: 'qcm-title',
      result: 'unanswered',
      distractorTitles: ['Autre titre'],
      hint: 'Un indice',
    })

    await user.click(screen.getByRole('button', { name: /répondre/i }))

    expect(screen.queryByRole('heading', { name: testCard.title })).not.toBeInTheDocument()
    expect(screen.getByText('Un indice')).toBeInTheDocument()
    expect(screen.getByText(testCard.title)).toBeInTheDocument()
    expect(screen.getByText('Autre titre')).toBeInTheDocument()
  })

  it('records the qcm-title answer in the quiz store once a choice is made', async () => {
    vi.useFakeTimers()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderCardNode(testCard, false, false, {
      type: 'qcm-title',
      result: 'unanswered',
      distractorTitles: ['Autre titre'],
    })

    await user.click(screen.getByRole('button', { name: /répondre/i }))
    await user.click(screen.getByText(testCard.title))
    vi.advanceTimersByTime(700)

    expect(useQuizStore.getState().results[testCard.id]).toBe('correct')
    vi.useRealTimers()
  })

  it('opens the multiple-choice dialog for a qcm-media question, titled by the card title, options as media', async () => {
    const user = userEvent.setup()
    const mediaCard: Card = {
      ...cardWithDefinition,
      kind: 'media',
      content: [{ kind: 'table', header: ['Unité'], rows: [['m']] }],
      definition: 'Unité\nm',
    }
    resetStore([mediaCard])
    renderCardNode(mediaCard, false, false, {
      type: 'qcm-media',
      result: 'unanswered',
      distractorDefinitions: ['Autre projection'],
    })

    await user.click(screen.getByRole('button', { name: /répondre/i }))

    expect(screen.getByRole('heading', { name: 'Titre initial' })).toBeInTheDocument()
  })

  it('opens the multiple-choice dialog for a qcm-media-title question with a table-specific heading and a rich hint', async () => {
    const user = userEvent.setup()
    const mediaCard: Card = {
      ...cardWithDefinition,
      kind: 'media',
      content: [{ kind: 'table', header: ['Unité'], rows: [['m']] }],
      definition: 'Unité\nm',
    }
    resetStore([mediaCard])
    renderCardNode(mediaCard, false, false, {
      type: 'qcm-media-title',
      result: 'unanswered',
      distractorTitles: ['Autre titre'],
      hint: 'Unité\nm',
    })

    await user.click(screen.getByRole('button', { name: /répondre/i }))

    expect(screen.getByRole('heading', { name: /à quel titre correspond ce tableau/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Unité' })).toBeInTheDocument()
  })

  it('records the qcm-media answer in the quiz store once a choice is made', async () => {
    vi.useFakeTimers()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const mediaCard: Card = {
      ...cardWithDefinition,
      kind: 'media',
      content: [{ kind: 'table', header: ['Unité'], rows: [['m']] }],
      definition: 'Unité\nm',
    }
    resetStore([mediaCard])
    renderCardNode(mediaCard, false, false, {
      type: 'qcm-media',
      result: 'unanswered',
      distractorDefinitions: ['Fausse projection'],
    })

    await user.click(screen.getByRole('button', { name: /répondre/i }))
    await user.click(screen.getByText('Fausse projection'))
    vi.advanceTimersByTime(700)

    expect(useQuizStore.getState().results[mediaCard.id]).toBe('incorrect')
    vi.useRealTimers()
  })
})

describe('CardNode — rich QCM options', () => {
  it('shows a formula option typeset, while answering with the plain-text identity', async () => {
    vi.useFakeTimers()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const target: Card = {
      ...testCard,
      content: [{ kind: 'math', latex: '\\frac{20}{100}' }],
      definition: '20/100',
    }
    const other: Card = {
      id: 'autre', level: 2, title: 'Autre', parentId: testCard.parentId, order: 1,
      content: [{ kind: 'math', latex: '\\frac{425}{20}' }], definition: '425/20',
    }
    resetStore([target, other])
    renderCardNode(target, false, false, {
      type: 'qcm-definition',
      result: 'unanswered',
      distractorDefinitions: ['425/20'],
    })

    await user.click(screen.getByRole('button', { name: /répondre/i }))

    // Both options are typeset, not shown as their degraded mirrors.
    expect(document.querySelectorAll('.mfrac').length).toBeGreaterThanOrEqual(2)
    vi.useRealTimers()
  })

  it('leaves a plain-text option as plain text', async () => {
    const user = userEvent.setup()
    const target: Card = { ...testCard, definition: 'Bonne définition' }
    resetStore([target])
    renderCardNode(target, false, false, {
      type: 'qcm-definition',
      result: 'unanswered',
      distractorDefinitions: ['Fausse A'],
    })

    await user.click(screen.getByRole('button', { name: /répondre/i }))

    expect(within(screen.getByRole('dialog')).getByText('Bonne définition')).toBeInTheDocument()
    expect(document.querySelector('.katex')).toBeNull()
  })
})
