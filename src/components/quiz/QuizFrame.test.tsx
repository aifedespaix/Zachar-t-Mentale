import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QuizFrame } from './QuizFrame'
import { useQuizStore, createQuizStore } from '../../state/useQuizStore'
import type { QuizQuestion, QuizResult } from '../../types/quiz'

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

function activateQuiz(results: Record<string, QuizResult>) {
  const questions: QuizQuestion[] = Object.keys(results).map(cardId => ({ cardId, type: 'recall' }))
  useQuizStore.setState({ active: true, questions, results })
}

describe('QuizFrame', () => {
  beforeEach(resetQuizStore)

  it('leaves the editor unframed', () => {
    render(
      <QuizFrame>
        <div>graphe</div>
      </QuizFrame>
    )

    expect(screen.getByText('graphe')).toBeInTheDocument()
    expect(screen.queryByTestId('quiz-frame')).not.toBeInTheDocument()
  })

  it('frames the graph and names the mode once a quiz starts', () => {
    activateQuiz({ a: 'unanswered' })
    render(
      <QuizFrame>
        <div>graphe</div>
      </QuizFrame>
    )

    expect(screen.getByTestId('quiz-frame')).toBeInTheDocument()
    expect(screen.getByText('Quiz')).toBeInTheDocument()
    // The graph is still there — the frame wraps it, it does not replace it.
    expect(screen.getByText('graphe')).toBeInTheDocument()
  })

  it('carries the score inside the frame rather than floating over the canvas', () => {
    activateQuiz({ a: 'correct', b: 'incorrect', c: 'unanswered' })
    render(
      <QuizFrame>
        <div />
      </QuizFrame>
    )

    expect(screen.getByRole('status')).toHaveTextContent('2 / 3 répondues · 1 correctes')
  })

  it('reports progress for assistive technology, not only as a coloured bar', () => {
    activateQuiz({ a: 'correct', b: 'unanswered' })
    render(
      <QuizFrame>
        <div />
      </QuizFrame>
    )

    const bar = screen.getByRole('progressbar', { name: 'Progression du quiz' })
    expect(bar).toHaveAttribute('aria-valuenow', '1')
    expect(bar).toHaveAttribute('aria-valuemax', '2')
  })

  it('keeps a way out of the quiz in the top right of the frame', async () => {
    const user = userEvent.setup()
    activateQuiz({ a: 'unanswered' })
    render(
      <QuizFrame>
        <div />
      </QuizFrame>
    )

    await user.click(screen.getByRole('button', { name: 'Terminer le quiz' }))

    expect(useQuizStore.getState().showSummary).toBe(true)
  })
})
