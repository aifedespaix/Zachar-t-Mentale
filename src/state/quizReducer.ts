import type { Card } from '../types/card'
import type { QuizConfig, QuizDifficulty, QuizQuestion, QuizQuestionType, QuizResult } from '../types/quiz'

const DIFFICULTY_SETTINGS: Record<QuizDifficulty, { sampleRatio: number; qcmRatio: number }> = {
  facile: { sampleRatio: 0.3, qcmRatio: 0.2 },
  moyen: { sampleRatio: 0.6, qcmRatio: 0.5 },
  difficile: { sampleRatio: 1, qcmRatio: 0.7 },
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export function selectQuizQuestions(
  cards: Card[],
  config: QuizConfig,
  random: () => number = Math.random
): QuizQuestion[] {
  const { sampleRatio, qcmRatio } = DIFFICULTY_SETTINGS[config.difficulty]

  const drawn: Card[] = []
  for (const level of config.levels) {
    const levelCards = cards.filter(c => c.level === level)
    // A plain round() can hit 0 for a small non-empty level (e.g. exactly 1
    // card at "facile", 1 * 0.3 rounds to 0) — level 1 (the root) always has
    // exactly 1 card, so a fresh mind map's only card would never be drawn.
    // Guarantee at least 1 card from any level that has cards at all.
    const count = levelCards.length === 0 ? 0 : Math.max(1, Math.round(levelCards.length * sampleRatio))
    drawn.push(...shuffle(levelCards, random).slice(0, count))
  }

  return drawn.map(card => {
    const type: QuizQuestionType = card.definition && random() < qcmRatio ? 'qcm' : 'recall'
    return { cardId: card.id, type }
  })
}

const MAX_DISTRACTORS = 3

export function buildDistractorPool(
  cards: Card[],
  targetCard: Card,
  difficulty: QuizDifficulty,
  random: () => number = Math.random
): string[] {
  const withDefinitions = (pool: Card[]) =>
    pool.filter(c => c.id !== targetCard.id && c.definition && c.definition !== targetCard.definition)

  const branch = withDefinitions(cards.filter(c => c.parentId === targetCard.parentId))
  const level = withDefinitions(cards.filter(c => c.level === targetCard.level))
  const whole = withDefinitions(cards)

  const scopesByDifficulty: Record<QuizDifficulty, Card[][]> = {
    facile: [whole],
    moyen: [level, whole],
    difficile: [branch, level, whole],
  }

  const seen = new Set<string>()
  const pool: string[] = []
  for (const scope of scopesByDifficulty[difficulty]) {
    for (const card of shuffle(scope, random)) {
      if (pool.length >= MAX_DISTRACTORS) break
      if (!card.definition || seen.has(card.definition)) continue
      seen.add(card.definition)
      pool.push(card.definition)
    }
    if (pool.length >= MAX_DISTRACTORS) break
  }
  return pool
}

export function attachDistractors(
  cards: Card[],
  questions: QuizQuestion[],
  difficulty: QuizDifficulty,
  random: () => number = Math.random
): QuizQuestion[] {
  return questions.map(question => {
    if (question.type !== 'qcm') return question
    const card = cards.find(c => c.id === question.cardId)
    // Defensive only (should not happen in practice): always degrade to
    // recall rather than returning the original, unmodified qcm question.
    if (!card) return { cardId: question.cardId, type: 'recall' }
    const pool = buildDistractorPool(cards, card, difficulty, random)
    if (pool.length === 0) return { cardId: question.cardId, type: 'recall' }
    return { ...question, distractorDefinitions: pool }
  })
}

export function computeScore(results: Record<string, QuizResult>): { correct: number; total: number } {
  const values = Object.values(results)
  return { correct: values.filter(r => r === 'correct').length, total: values.length }
}
