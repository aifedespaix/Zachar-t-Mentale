import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach } from 'vitest'
import { ReactFlowProvider } from '@xyflow/react'
import { CardNode } from './CardNode'
import { useCardsStore, createCardsStore } from '../state/useCardsStore'
import { useQuizStore, createQuizStore } from '../state/useQuizStore'
import { useCardDetailStore } from '../state/useCardDetailStore'
import { useCardHoverStore } from '../state/useCardHoverStore'
import { useQuizSettingsStore } from '../state/useQuizSettingsStore'
import { DEFAULT_QUIZ_SETTINGS } from '../types/quizSettings'
import type { Card } from '../types/card'

const card: Card = { id: 'root', level: 1, title: 'Titre initial', parentId: null, order: 0 }

/**
 * Same isolation helpers as `CardNode.test.tsx`: only the DATA slices are
 * copied from a pristine store, never the actions, which belong to the
 * singleton.
 */
function resetStore(cards: Card[]) {
  const pristine = createCardsStore().getState()
  useCardsStore.setState({ history: pristine.history, locked: pristine.locked })
  useCardsStore.getState().loadCards(cards)
}

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

function cardNodeProps(c: Card) {
  return { id: c.id, data: { card: c } } as unknown as ComponentProps<typeof CardNode>
}

describe('CardNode — survol', () => {
  beforeEach(() => {
    useCardDetailStore.getState().closeAll()
    resetStore([card])
    resetQuizStore()
    useQuizSettingsStore.setState(DEFAULT_QUIZ_SETTINGS)
    useCardHoverStore.getState().reset()
  })

  it('publishes a card hover so its fiche can light up', async () => {
    const user = userEvent.setup()
    render(
      <ReactFlowProvider>
        <CardNode {...cardNodeProps(card)} />
      </ReactFlowProvider>
    )

    const node = screen.getByTestId(`card-${card.id}`)
    expect(node).toHaveAttribute('data-hovered', 'false')

    await user.hover(node)
    expect(useCardHoverStore.getState().hoveredCardId).toBe(card.id)
    expect(node).toHaveAttribute('data-hovered', 'true')

    await user.unhover(node)
    expect(useCardHoverStore.getState().hoveredCardId).toBeNull()
    expect(node).toHaveAttribute('data-hovered', 'false')
  })
})
