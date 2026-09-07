import { Button } from '../ui/button'
import { useQuizStore } from '../../state/useQuizStore'
import { computeScore } from '../../state/quizReducer'

export function QuizHud() {
  const active = useQuizStore(s => s.active)
  const questions = useQuizStore(s => s.questions)
  const results = useQuizStore(s => s.results)
  const finishQuiz = useQuizStore(s => s.finishQuiz)

  if (!active) return null

  const { correct } = computeScore(results)
  const answered = Object.values(results).filter(r => r !== 'unanswered').length

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: 'var(--background)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '8px 12px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.12)',
      }}
    >
      <span>
        {answered} / {questions.length} répondues ({correct} correctes)
      </span>
      <Button size="sm" onClick={finishQuiz}>
        Terminer le quiz
      </Button>
    </div>
  )
}
