import type { CardLevel } from './card'

export type QuizDifficulty = 'facile' | 'moyen' | 'difficile'

export interface QuizConfig {
  levels: CardLevel[]
  difficulty: QuizDifficulty
}

export type QuizQuestionType = 'recall' | 'qcm'

export interface QuizQuestion {
  cardId: string
  type: QuizQuestionType
  distractorDefinitions?: string[]
}

export type QuizResult = 'unanswered' | 'correct' | 'incorrect'
