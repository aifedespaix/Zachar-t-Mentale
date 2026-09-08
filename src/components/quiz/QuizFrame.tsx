import type { ReactNode } from 'react'
import { GraduationCap } from 'lucide-react'
import { Button } from '../ui/button'
import { useQuizStore } from '../../state/useQuizStore'
import { computeScore } from '../../state/quizReducer'

interface QuizFrameProps {
  children: ReactNode
}

/**
 * Wraps the graph in a gold frame for the duration of a quiz.
 *
 * The editor and the quiz used to look identical apart from a small floating
 * counter, so "am I revising or editing?" was a question you answered by
 * reading. A framed, titled surface answers it peripherally — before any text
 * is read — and gives the counter, the progress bar and the way out a place
 * to live that belongs to the mode instead of floating over the canvas.
 *
 * Outside a quiz it renders its children untouched, so the editor keeps the
 * full, unframed canvas.
 */
export function QuizFrame({ children }: QuizFrameProps) {
  const active = useQuizStore(s => s.active)
  const questions = useQuizStore(s => s.questions)
  const results = useQuizStore(s => s.results)
  const finishQuiz = useQuizStore(s => s.finishQuiz)

  if (!active) return <>{children}</>

  const { correct } = computeScore(results)
  const answered = Object.values(results).filter(result => result !== 'unanswered').length
  const total = questions.length
  const percent = total === 0 ? 0 : Math.round((answered / total) * 100)

  return (
    <div className="quiz-frame" data-testid="quiz-frame">
      <div className="quiz-frame__header">
        <span className="quiz-frame__title">
          <GraduationCap size={16} aria-hidden />
          Quiz
        </span>

        <span role="status" style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
          {answered} / {total} répondues · {correct} correctes
        </span>

        <div
          className="quiz-frame__progress"
          role="progressbar"
          aria-label="Progression du quiz"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={answered}
        >
          <div className="quiz-frame__progress-fill" style={{ width: `${percent}%` }} />
        </div>

        <Button size="sm" variant="outline" onClick={finishQuiz}>
          Terminer le quiz
        </Button>
      </div>

      <div className="quiz-frame__body">{children}</div>
    </div>
  )
}
