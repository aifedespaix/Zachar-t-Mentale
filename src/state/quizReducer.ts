import type { Card } from '../types/card'
import type {
  QuizConfig,
  QuizDifficulty,
  QuizQuestion,
  QuizQuestionType,
  QuizResult,
  QuizScore,
  RecallProgress,
} from '../types/quiz'
import { contentOf, nonTextKinds } from '../content/blocks'

const DIFFICULTY_SETTINGS: Record<QuizDifficulty, { sampleRatio: number }> = {
  facile: { sampleRatio: 0.2 },
  moyen: { sampleRatio: 0.5 },
  difficile: { sampleRatio: 0.75 },
}

const HINT_TRUNCATE_RATIO = 0.5
const MAX_DISTRACTORS = 3

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/**
 * A card only gets media-flavoured questions when it actually has media —
 * `kind: 'media'` on a card with no non-text block degrades back to the
 * normal definition/recall routing rather than blocking anything, the same
 * way an unknown icon name or a malformed block degrades elsewhere in this
 * codebase instead of failing.
 */
function isMediaCard(card: Card): boolean {
  return card.kind === 'media' && nonTextKinds(contentOf(card)).length > 0
}

export function selectQuizQuestions(
  cards: Card[],
  config: QuizConfig,
  random: () => number = Math.random
): QuizQuestion[] {
  const { sampleRatio } = DIFFICULTY_SETTINGS[config.difficulty]

  const drawn: Card[] = []
  for (const level of config.levels) {
    const levelCards = cards.filter(c => c.level === level)
    // A plain round() can hit 0 for a small non-empty level (e.g. exactly 1
    // card at "facile", 1 * 0.2 rounds to 0) — level 1 (the root) always has
    // exactly 1 card, so a fresh mind map's only card would never be drawn.
    // Guarantee at least 1 card from any level that has cards at all.
    const count = levelCards.length === 0 ? 0 : Math.max(1, Math.round(levelCards.length * sampleRatio))
    drawn.push(...shuffle(levelCards, random).slice(0, count))
  }

  return drawn.map(card => {
    if (isMediaCard(card)) {
      return { cardId: card.id, type: (config.qcmMode ? 'qcm-media-title' : 'qcm-media') as QuizQuestionType }
    }
    if (config.qcmMode) return { cardId: card.id, type: 'qcm-title' as QuizQuestionType }
    const type: QuizQuestionType = card.definition ? 'qcm-definition' : 'recall'
    return { cardId: card.id, type }
  })
}

function distractorScopes(cards: Card[], targetCard: Card, difficulty: QuizDifficulty): Card[][] {
  const branch = cards.filter(c => c.parentId === targetCard.parentId)
  const level = cards.filter(c => c.level === targetCard.level)
  const whole = cards
  const scopesByDifficulty: Record<QuizDifficulty, Card[][]> = {
    facile: [whole],
    moyen: [level, whole],
    difficile: [branch, level, whole],
  }
  return scopesByDifficulty[difficulty]
}

/** Shared branch->level->whole-map degradation, parameterized over which text field to pool. */
function buildDistractorPoolFrom(
  cards: Card[],
  targetCard: Card,
  difficulty: QuizDifficulty,
  pick: (card: Card) => string | undefined,
  exclude: string,
  random: () => number
): string[] {
  const seen = new Set<string>([exclude])
  const pool: string[] = []
  for (const scope of distractorScopes(cards, targetCard, difficulty)) {
    for (const card of shuffle(scope, random)) {
      if (pool.length >= MAX_DISTRACTORS) break
      if (card.id === targetCard.id) continue
      const value = pick(card)
      if (!value || seen.has(value)) continue
      seen.add(value)
      pool.push(value)
    }
    if (pool.length >= MAX_DISTRACTORS) break
  }
  return pool
}

export function buildDistractorPool(
  cards: Card[],
  targetCard: Card,
  difficulty: QuizDifficulty,
  random: () => number = Math.random
): string[] {
  return buildDistractorPoolFrom(cards, targetCard, difficulty, c => c.definition, targetCard.definition ?? '', random)
}

export function buildTitleDistractorPool(
  cards: Card[],
  targetCard: Card,
  difficulty: QuizDifficulty,
  random: () => number = Math.random
): string[] {
  return buildDistractorPoolFrom(cards, targetCard, difficulty, c => c.title, targetCard.title, random)
}

function truncateAtWordBoundary(text: string, ratio: number): string {
  const targetLength = Math.max(1, Math.round(text.length * ratio))
  if (targetLength >= text.length) return text
  const cut = text.lastIndexOf(' ', targetLength)
  const truncated = cut > 0 ? text.slice(0, cut) : text.slice(0, targetLength)
  return `${truncated}…`
}

/** facile = full definition, moyen = truncated, difficile = no textual hint. */
function buildHint(card: Card, difficulty: QuizDifficulty): string | undefined {
  if (!card.definition) return undefined
  if (difficulty === 'facile') return card.definition
  if (difficulty === 'moyen') return truncateAtWordBoundary(card.definition, HINT_TRUNCATE_RATIO)
  return undefined
}

export function attachDistractors(
  cards: Card[],
  questions: QuizQuestion[],
  difficulty: QuizDifficulty,
  random: () => number = Math.random
): QuizQuestion[] {
  return questions.map(question => {
    const card = cards.find(c => c.id === question.cardId)
    // Defensive only (should not happen in practice): always degrade to
    // recall rather than returning the original, unmodified question.
    if (!card) return { cardId: question.cardId, type: 'recall' }

    if (question.type === 'qcm-definition') {
      const pool = buildDistractorPool(cards, card, difficulty, random)
      if (pool.length === 0) return { cardId: question.cardId, type: 'recall' }
      return { ...question, distractorDefinitions: pool }
    }

    if (question.type === 'qcm-title') {
      const pool = buildTitleDistractorPool(cards, card, difficulty, random)
      if (pool.length === 0) return { cardId: question.cardId, type: 'recall' }
      return { ...question, distractorTitles: pool, hint: buildHint(card, difficulty) }
    }

    return question
  })
}

/**
 * The end-of-quiz breakdown.
 *
 * `progress` is optional and defaults to empty, which grades every correct
 * answer as `perfect` — right for QCM questions, which have a single shot, and
 * the honest fallback for a caller (the in-quiz counter) that only needs the
 * headline numbers. Recall cards pass their real progress so an answer found
 * only after the app handed over extra letters is reported as `assisted`
 * rather than being quietly counted as an unaided success.
 */
export function computeScore(
  results: Record<string, QuizResult>,
  progress: Record<string, RecallProgress> = {}
): QuizScore {
  const entries = Object.entries(results)
  const correctIds = entries.filter(([, result]) => result === 'correct').map(([id]) => id)
  const perfect = correctIds.filter(id => (progress[id]?.attempts ?? 0) === 0).length
  const total = entries.length
  const correct = correctIds.length
  return {
    correct,
    total,
    perfect,
    assisted: correct - perfect,
    incorrect: entries.filter(([, result]) => result === 'incorrect').length,
    unanswered: entries.filter(([, result]) => result === 'unanswered').length,
    percentage: total === 0 ? 0 : Math.round((correct / total) * 100),
  }
}
