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

export type QuizQuestionType = 'recall' | 'qcm-definition' | 'qcm-title' | 'qcm-media' | 'qcm-media-title'

export interface QuizQuestion {
  cardId: string
  type: QuizQuestionType
  /** qcm-definition / qcm-media only. */
  distractorDefinitions?: string[]
  /** qcm-title / qcm-media-title only. */
  distractorTitles?: string[]
  /** qcm-title / qcm-media-title only; absent means "no textual hint, context of the graph only". */
  hint?: string
}

export type QuizResult = 'unanswered' | 'correct' | 'incorrect'

/**
 * How a single recall (fill-in-the-blank) card has gone so far.
 *
 * The quiz is practice, not an exam: a wrong answer does not end the question,
 * it buys one more revealed letter (`extraReveals`) and lets the user try
 * again. `attempts` counts only the FAILED submissions, so `attempts === 0` on
 * a correct card is exactly "found it unaided" — which is what separates a
 * real success from one the app talked the user into.
 */
export interface RecallProgress {
  attempts: number
  extraReveals: number
  lastTyped: string | null
  lastSimilarity: number | null
  /** The user asked to see the answer: graded incorrect, and shown in full. */
  gaveUp: boolean
}

export const EMPTY_RECALL_PROGRESS: RecallProgress = {
  attempts: 0,
  extraReveals: 0,
  lastTyped: null,
  lastSimilarity: null,
  gaveUp: false,
}

/** The breakdown the end-of-quiz screen reports back. */
export interface QuizScore {
  correct: number
  total: number
  /** Correct on the first try, with no extra letters asked for. */
  perfect: number
  /** Correct, but only after one or more retries. */
  assisted: number
  incorrect: number
  unanswered: number
  /** 0-100, rounded; 0 for an empty quiz. */
  percentage: number
}
