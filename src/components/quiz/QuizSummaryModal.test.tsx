import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach } from 'vitest'
import { QuizSummaryModal } from './QuizSummaryModal'
import { useQuizStore, createQuizStore } from '../../state/useQuizStore'
import { useCardsStore, createCardsStore } from '../../state/useCardsStore'

function resetQuizStore() {
  const pristine = createQuizStore().getState()
  useQuizStore.setState({
    active: pristine.active,
    showSummary: pristine.showSummary,
    config: pristine.config,
    questions: pristine.questions,
    results: pristine.results,
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
})
