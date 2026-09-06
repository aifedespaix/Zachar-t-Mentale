import { describe, it, expect } from 'vitest'
import { selectQuizQuestions, buildDistractorPool, attachDistractors, computeScore } from './quizReducer'
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

describe('buildDistractorPool', () => {
  const target: Card = { id: 'target', level: 3, title: 'Cible', definition: 'Bonne définition', parentId: 'p1', order: 0 }
  const sibling: Card = { id: 'sibling', level: 3, title: 'Frère', definition: 'Def frère', parentId: 'p1', order: 1 }
  const sameLevelOtherBranch: Card = { id: 'other-branch', level: 3, title: 'Autre branche', definition: 'Def autre branche', parentId: 'p2', order: 0 }
  const otherLevel: Card = { id: 'other-level', level: 2, title: 'Autre niveau', definition: 'Def autre niveau', parentId: 'root', order: 0 }
  const noDefinition: Card = { id: 'no-def', level: 3, title: 'Sans définition', parentId: 'p1', order: 2 }
  const allCards = [target, sibling, sameLevelOtherBranch, otherLevel, noDefinition]

  it('never includes the target card itself or cards without a definition', () => {
    const pool = buildDistractorPool(allCards, target, 'facile')
    expect(pool).not.toContain('Bonne définition')
    expect(pool.length).toBeLessThanOrEqual(3)
  })

  it('"facile" pulls distractors from anywhere in the map', () => {
    const pool = buildDistractorPool(allCards, target, 'facile')
    expect(pool.sort()).toEqual(['Def autre branche', 'Def autre niveau', 'Def frère'].sort())
  })

  it('"difficile" prioritizes the same branch (same parent) first', () => {
    const pool = buildDistractorPool(allCards, target, 'difficile')
    expect(pool[0]).toBe('Def frère')
  })

  it('degrades to the whole map when the branch/level do not have enough distractors', () => {
    const onlyTarget = [target, otherLevel]
    const pool = buildDistractorPool(onlyTarget, target, 'difficile')
    expect(pool).toEqual(['Def autre niveau'])
  })

  it('returns an empty pool when no other card in the map has a definition', () => {
    const pool = buildDistractorPool([target, noDefinition], target, 'facile')
    expect(pool).toEqual([])
  })
})

describe('attachDistractors', () => {
  const cardWithDef: Card = { id: 'a', level: 1, title: 'A', definition: 'Def A', parentId: null, order: 0 }
  const otherWithDef: Card = { id: 'b', level: 2, title: 'B', definition: 'Def B', parentId: 'a', order: 0 }

  it('fills distractorDefinitions for a qcm question when distractors exist', () => {
    const questions = attachDistractors([cardWithDef, otherWithDef], [{ cardId: 'a', type: 'qcm' }], 'facile')
    expect(questions).toEqual([{ cardId: 'a', type: 'qcm', distractorDefinitions: ['Def B'] }])
  })

  it('falls back to "recall" when a qcm question has no possible distractor', () => {
    const questions = attachDistractors([cardWithDef], [{ cardId: 'a', type: 'qcm' }], 'facile')
    expect(questions).toEqual([{ cardId: 'a', type: 'recall' }])
  })

  it('leaves recall questions untouched', () => {
    const questions = attachDistractors([cardWithDef, otherWithDef], [{ cardId: 'a', type: 'recall' }], 'facile')
    expect(questions).toEqual([{ cardId: 'a', type: 'recall' }])
  })
})

describe('computeScore', () => {
  it('counts correct answers against the total number of results', () => {
    expect(computeScore({ a: 'correct', b: 'incorrect', c: 'correct', d: 'unanswered' })).toEqual({
      correct: 2,
      total: 4,
    })
  })

  it('returns zero/zero for no results', () => {
    expect(computeScore({})).toEqual({ correct: 0, total: 0 })
  })
})
