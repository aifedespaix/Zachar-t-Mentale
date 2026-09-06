import type { Card } from '../types/card'
import type { QuizConfig, QuizDifficulty, QuizQuestion, QuizQuestionType } from '../types/quiz'

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
    const count = Math.round(levelCards.length * sampleRatio)
    drawn.push(...shuffle(levelCards, random).slice(0, count))
  }

  return drawn.map(card => {
    const type: QuizQuestionType = card.definition && random() < qcmRatio ? 'qcm' : 'recall'
    return { cardId: card.id, type }
  })
}
