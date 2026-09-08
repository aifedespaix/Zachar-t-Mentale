import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach } from 'vitest'
import { QuizSummaryModal } from './QuizSummaryModal'
import { useQuizStore, createQuizStore } from '../../state/useQuizStore'
import { useCardsStore, createCardsStore } from '../../state/useCardsStore'
import { EMPTY_RECALL_PROGRESS } from '../../types/quiz'
import type { Card } from '../../types/card'

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

describe('QuizSummaryModal', () => {
  beforeEach(() => {
    const pristineCards = createCardsStore().getState()
    useCardsStore.setState({ history: pristineCards.history, locked: pristineCards.locked })
    resetQuizStore()
  })

  it('renders nothing when the summary is not shown', () => {
    const { container } = render(<QuizSummaryModal />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the final score', () => {
    useQuizStore.setState({ showSummary: true, results: { a: 'correct', b: 'incorrect', c: 'correct' } })
    render(<QuizSummaryModal />)

    expect(screen.getByText(/2\s*\/\s*3/)).toBeInTheDocument()
  })

  it('ends the quiz session when "Retour à la carte" is clicked', async () => {
    const user = userEvent.setup()
    useQuizStore.setState({ active: true, showSummary: true, results: { a: 'correct' } })
    render(<QuizSummaryModal />)

    await user.click(screen.getByRole('button', { name: /retour à la carte/i }))

    expect(useQuizStore.getState().active).toBe(false)
    expect(useQuizStore.getState().showSummary).toBe(false)
  })

  it('shows the score as a percentage, not only as a fraction', () => {
    useQuizStore.setState({ showSummary: true, results: { a: 'correct', b: 'incorrect', c: 'correct', d: 'correct' } })
    render(<QuizSummaryModal />)

    expect(screen.getByText('75%')).toBeInTheDocument()
  })

  it('congratulates a perfect round', () => {
    useQuizStore.setState({ showSummary: true, results: { a: 'correct' } })
    render(<QuizSummaryModal />)

    expect(screen.getByText('Sans-faute !')).toBeInTheDocument()
  })

  it('encourages rather than scolds after a bad round', () => {
    useQuizStore.setState({ showSummary: true, results: { a: 'incorrect', b: 'incorrect' } })
    render(<QuizSummaryModal />)

    expect(screen.getByText('On recommence !')).toBeInTheDocument()
    expect(screen.getByText(/c’est exactement à quoi sert un quiz/i)).toBeInTheDocument()
  })

  it('separates cards found unaided from cards that needed help', () => {
    useQuizStore.setState({
      showSummary: true,
      results: { a: 'correct', b: 'correct', c: 'incorrect' },
      recallProgress: {
        a: { ...EMPTY_RECALL_PROGRESS },
        b: { ...EMPTY_RECALL_PROGRESS, attempts: 2, extraReveals: 2 },
      },
    })
    render(<QuizSummaryModal />)

    expect(screen.getByText('du premier coup').previousSibling).toHaveTextContent('1')
    expect(screen.getByText('avec de l’aide').previousSibling).toHaveTextContent('1')
    expect(screen.getByText('à revoir').previousSibling).toHaveTextContent('1')
  })

  it('names the cards worth going back to', () => {
    const cards: Card[] = [
      { id: 'a', level: 1, title: 'Photosynthèse', parentId: null, order: 0 },
      { id: 'b', level: 2, title: 'Chlorophylle', parentId: 'a', order: 0 },
    ]
    useCardsStore.getState().loadCards(cards)
    useQuizStore.setState({ showSummary: true, results: { a: 'correct', b: 'incorrect' } })
    render(<QuizSummaryModal />)

    expect(screen.getByText('Chlorophylle')).toBeInTheDocument()
    expect(screen.queryByText('Photosynthèse')).not.toBeInTheDocument()
  })

  it('leaves out the review list when nothing was missed', () => {
    useQuizStore.setState({ showSummary: true, results: { a: 'correct' } })
    render(<QuizSummaryModal />)

    expect(screen.queryByText('À revoir')).not.toBeInTheDocument()
  })

  it('offers a fresh round with the same settings', async () => {
    const user = userEvent.setup()
    useCardsStore.getState().loadCards([{ id: 'a', level: 1, title: 'Racine', parentId: null, order: 0 }])
    useQuizStore.setState({
      active: true,
      showSummary: true,
      config: { levels: [1], difficulty: 'moyen', qcmMode: false },
      results: { a: 'incorrect' },
    })
    render(<QuizSummaryModal />)

    await user.click(screen.getByRole('button', { name: /recommencer/i }))

    expect(useQuizStore.getState().showSummary).toBe(false)
    expect(useQuizStore.getState().active).toBe(true)
    expect(useQuizStore.getState().results).toEqual({ a: 'unanswered' })
  })
})
