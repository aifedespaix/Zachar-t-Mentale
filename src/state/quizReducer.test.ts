import { describe, it, expect } from 'vitest'
import { selectQuizQuestions } from './quizReducer'
import type { Card } from '../types/card'
import type { QuizConfig } from '../types/quiz'

const root: Card = { id: 'root', level: 1, title: 'Racine', parentId: null, order: 0 }
function makeLevel2(n: number): Card[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `l2-${i}`,
    level: 2 as const,
    title: `Sous-titre ${i}`,
    parentId: 'root',
    order: i,
  }))
}

/** Cycles deterministically through fixed values instead of Math.random(). */
function sequence(values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]
}

describe('selectQuizQuestions', () => {
  it('draws round(levelCount * sampleRatio) cards for a level, with "moyen" at 60%', () => {
    const cards = [root, ...makeLevel2(10)]
    const config: QuizConfig = { levels: [2], difficulty: 'moyen' }
    const questions = selectQuizQuestions(cards, config, sequence([0.1]))
    expect(questions).toHaveLength(6)
  })

  it('draws 100% of the perimeter for "difficile"', () => {
    const cards = [root, ...makeLevel2(5)]
    const config: QuizConfig = { levels: [2], difficulty: 'difficile' }
    const questions = selectQuizQuestions(cards, config, sequence([0.9]))
    expect(questions).toHaveLength(5)
  })

  it('never draws the same card twice', () => {
    const cards = [root, ...makeLevel2(8)]
    const config: QuizConfig = { levels: [2], difficulty: 'difficile' }
    const questions = selectQuizQuestions(cards, config, sequence([0.1, 0.4, 0.7, 0.2, 0.9]))
    const ids = questions.map(q => q.cardId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('only draws from the levels listed in the config', () => {
    const cards = [root, ...makeLevel2(4)]
    const config: QuizConfig = { levels: [1], difficulty: 'difficile' }
    const questions = selectQuizQuestions(cards, config)
    expect(questions).toEqual([{ cardId: 'root', type: 'recall' }])
  })

  it('always types a card with no definition as "recall", regardless of the qcm ratio roll', () => {
    // "difficile" rolls qcm 70% of the time — feed a random() that would
    // otherwise pick qcm (a low value) and confirm it's overridden.
    const config: QuizConfig = { levels: [1], difficulty: 'difficile' }
    const questions = selectQuizQuestions([root], config, sequence([0.01]))
    expect(questions).toEqual([{ cardId: 'root', type: 'recall' }])
  })

  it('can type a card WITH a definition as "qcm" when the ratio roll says so', () => {
    const withDefinition: Card = { ...root, definition: 'Une définition' }
    const config: QuizConfig = { levels: [1], difficulty: 'difficile' } // 70% qcm
    // A single-card level never calls the shuffle's random() (nothing to swap),
    // so this one value goes straight to the qcm-ratio roll: 0.5 < 0.7 -> qcm.
    const questions = selectQuizQuestions([withDefinition], config, sequence([0.5]))
    expect(questions).toEqual([{ cardId: 'root', type: 'qcm' }])
  })
})
