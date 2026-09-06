import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach } from 'vitest'
import { QuizHud } from './QuizHud'
import { useQuizStore, createQuizStore } from '../../state/useQuizStore'

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

describe('QuizHud', () => {
  beforeEach(resetQuizStore)

  it('renders nothing when no quiz is active', () => {
    const { container } = render(<QuizHud />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows how many questions have been answered and how many are correct', () => {
    useQuizStore.setState({
      active: true,
      questions: [
        { cardId: 'a', type: 'recall' },
        { cardId: 'b', type: 'recall' },
      ],
      results: { a: 'correct', b: 'unanswered' },
    })
    render(<QuizHud />)

    expect(screen.getByText(/1\s*\/\s*2/)).toBeInTheDocument()
  })

  it('opens the summary when "Terminer le quiz" is clicked', async () => {
    const user = userEvent.setup()
    useQuizStore.setState({
      active: true,
      questions: [{ cardId: 'a', type: 'recall' }],
      results: { a: 'unanswered' },
    })
    render(<QuizHud />)

    await user.click(screen.getByRole('button', { name: /terminer le quiz/i }))

    expect(useQuizStore.getState().showSummary).toBe(true)
  })
})
