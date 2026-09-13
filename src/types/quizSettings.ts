import type { CardLevel } from './card'
import { ALL_CARD_LEVELS } from './card'
import type { QuizConfig, QuizDifficulty } from './quiz'

export interface QuizSettings {
  similarityThreshold: number
  /**
   * Draw the answer's shape (« B____ d__ ____ ») on the card itself, not only
   * inside the answer dialog. It is a peek at the question's difficulty from
   * the graph, so it stays optional.
   */
  lengthGuideEnabled: boolean
  /**
   * Colour each letter green/red AS IT IS TYPED, rather than only once the
   * answer is submitted.
   *
   * Off by default, and deliberately so: live grading turns a recall question
   * into a letter-by-letter oracle you can brute-force one keystroke at a
   * time, which is exactly the effort the card is supposed to make you spend.
   * On validation the same colours explain the mistake without having handed
   * out the answer first.
   */
  liveLetterFeedback: boolean
  /**
   * What the quiz modal held the last time a quiz was launched: the levels the
   * user ticked by hand, the difficulty and the QCM mode. Reopening the modal
   * comes back to this, rather than to the factory defaults.
   *
   * The stored levels are the MANUAL selection, including levels that have no
   * card at the moment: greying one out must not erase the choice made while it
   * still had cards (see `presentLevels`). A level therefore returns checked —
   * or unchecked — exactly as the user left it once cards come back to it.
   */
  lastQuizConfig: QuizConfig
}

export const DEFAULT_QUIZ_SETTINGS: QuizSettings = {
  similarityThreshold: 100,
  lengthGuideEnabled: true,
  liveLetterFeedback: false,
  lastQuizConfig: { levels: [1, 2, 3, 4], difficulty: 'moyen', qcmMode: false },
}

const DIFFICULTIES: readonly QuizDifficulty[] = ['facile', 'moyen', 'difficile']

function isCardLevel(value: unknown): value is CardLevel {
  return (ALL_CARD_LEVELS as readonly unknown[]).includes(value)
}

/**
 * Turn whatever a settings file (or an older version of the app) wrote for
 * `lastQuizConfig` into something the modal can render.
 *
 * A bad level or difficulty reaching the modal would paint a broken level grid,
 * so unknown values degrade to the default. The one thing NOT reset is an empty
 * `levels` list: "I unchecked everything" is a legitimate choice the user may
 * have saved, and it must come back as they left it.
 */
export function normalizeQuizConfig(raw: unknown): QuizConfig {
  const fallback = DEFAULT_QUIZ_SETTINGS.lastQuizConfig
  if (typeof raw !== 'object' || raw === null) return fallback
  const candidate = raw as Partial<QuizConfig>
  const levels = Array.isArray(candidate.levels)
    ? [...new Set(candidate.levels.filter(isCardLevel))].sort((a, b) => a - b)
    : fallback.levels
  const difficulty = DIFFICULTIES.includes(candidate.difficulty as QuizDifficulty)
    ? (candidate.difficulty as QuizDifficulty)
    : fallback.difficulty
  const qcmMode = typeof candidate.qcmMode === 'boolean' ? candidate.qcmMode : fallback.qcmMode
  return { levels, difficulty, qcmMode }
}
