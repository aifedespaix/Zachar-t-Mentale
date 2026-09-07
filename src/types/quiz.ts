import type { CardLevel } from './card'

export type QuizDifficulty = 'facile' | 'moyen' | 'difficile'

export interface QuizConfig {
  levels: CardLevel[]
  difficulty: QuizDifficulty
  /** When true, every drawn card is quizzed on its TITLE via QCM (with its
   * definition as a difficulty-graded hint, if it has one) instead of the
   * default recall-title / QCM-definition split. */
  qcmMode: boolean
}

export type QuizQuestionType = 'recall' | 'qcm-definition' | 'qcm-title'

export interface QuizQuestion {
  cardId: string
  type: QuizQuestionType
  /** qcm-definition only. */
  distractorDefinitions?: string[]
  /** qcm-title only. */
  distractorTitles?: string[]
  /** qcm-title only; absent means "no textual hint, context of the graph only". */
  hint?: string
}

export type QuizResult = 'unanswered' | 'correct' | 'incorrect'
