// src/state/quizReducer.test.ts
import { describe, it, expect } from 'vitest'
import { selectQuizQuestions, buildDistractorPool, buildTitleDistractorPool, attachDistractors, computeScore } from './quizReducer'
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

function baseConfig(overrides: Partial<QuizConfig> = {}): QuizConfig {
  return { levels: [2], difficulty: 'moyen', qcmMode: false, ...overrides }
}

describe('selectQuizQuestions', () => {
  it('draws round(levelCount * sampleRatio) cards for a level, with "moyen" at 50%', () => {
    const cards = [root, ...makeLevel2(10)]
    const questions = selectQuizQuestions(cards, baseConfig(), sequence([0.1]))
    expect(questions).toHaveLength(5)
  })

  it('draws 75% of the perimeter for "difficile"', () => {
    const cards = [root, ...makeLevel2(4)]
    const questions = selectQuizQuestions(cards, baseConfig({ difficulty: 'difficile' }), sequence([0.9]))
    expect(questions).toHaveLength(3)
  })

  it('draws 20% of the perimeter for "facile"', () => {
    const cards = [root, ...makeLevel2(10)]
    const questions = selectQuizQuestions(cards, baseConfig({ difficulty: 'facile' }), sequence([0.9]))
    expect(questions).toHaveLength(2)
  })

  it('never draws the same card twice', () => {
    const cards = [root, ...makeLevel2(8)]
    const questions = selectQuizQuestions(cards, baseConfig({ difficulty: 'difficile' }), sequence([0.1, 0.4, 0.7, 0.2, 0.9]))
    const ids = questions.map(q => q.cardId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('only draws from the levels listed in the config', () => {
    const cards = [root, ...makeLevel2(4)]
    const questions = selectQuizQuestions(cards, baseConfig({ levels: [1], difficulty: 'difficile' }))
    expect(questions).toEqual([{ cardId: 'root', type: 'recall' }])
  })

  it('types a card with no definition as "recall" in normal mode', () => {
    const questions = selectQuizQuestions([root], baseConfig({ levels: [1], difficulty: 'difficile' }))
    expect(questions).toEqual([{ cardId: 'root', type: 'recall' }])
  })

  it('types a card WITH a definition as "qcm-definition" in normal mode', () => {
    const withDefinition: Card = { ...root, definition: 'Une définition' }
    const questions = selectQuizQuestions([withDefinition], baseConfig({ levels: [1], difficulty: 'difficile' }))
    expect(questions).toEqual([{ cardId: 'root', type: 'qcm-definition' }])
  })

  it('types every drawn card as "qcm-title" when qcmMode is on, definition or not', () => {
    const withDefinition: Card = { ...root, definition: 'Une définition' }
    const withoutDefinition: Card = { id: 'other', level: 1, title: 'Autre', parentId: null, order: 0 }

    expect(
      selectQuizQuestions([withDefinition], baseConfig({ levels: [1], difficulty: 'difficile', qcmMode: true }))
    ).toEqual([{ cardId: 'root', type: 'qcm-title' }])

    expect(
      selectQuizQuestions([withoutDefinition], baseConfig({ levels: [1], difficulty: 'difficile', qcmMode: true }))
    ).toEqual([{ cardId: 'other', type: 'qcm-title' }])
  })

  it('still draws the single card of a level with exactly 1 card at "facile" (round-to-zero must not drop it)', () => {
    const questions = selectQuizQuestions([root], baseConfig({ levels: [1], difficulty: 'facile' }))
    expect(questions).toEqual([{ cardId: 'root', type: 'recall' }])
  })

  it('draws 0 cards for an empty level (no cards to guarantee a minimum from)', () => {
    const questions = selectQuizQuestions([root, ...makeLevel2(2)], baseConfig({ levels: [3], difficulty: 'facile' }))
    expect(questions).toEqual([])
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

  it('never includes a distractor whose definition TEXT duplicates the target\'s (even from a different card id)', () => {
    const duplicateText: Card = {
      id: 'duplicate',
      level: 3,
      title: 'Doublon',
      definition: 'Bonne définition',
      parentId: 'p1',
      order: 3,
    }
    const pool = buildDistractorPool([target, duplicateText], target, 'facile')
    expect(pool).not.toContain('Bonne définition')
    expect(pool).toEqual([])
  })
})

describe('buildTitleDistractorPool', () => {
  const target: Card = { id: 'target', level: 3, title: 'Cible', parentId: 'p1', order: 0 }
  const sibling: Card = { id: 'sibling', level: 3, title: 'Frère', parentId: 'p1', order: 1 }
  const sameLevelOtherBranch: Card = { id: 'other-branch', level: 3, title: 'Autre branche', parentId: 'p2', order: 0 }
  const otherLevel: Card = { id: 'other-level', level: 2, title: 'Autre niveau', parentId: 'root', order: 0 }
  const allCards = [target, sibling, sameLevelOtherBranch, otherLevel]

  it('never includes the target card itself', () => {
    const pool = buildTitleDistractorPool(allCards, target, 'facile')
    expect(pool).not.toContain('Cible')
  })

  it('"facile" pulls distractors from anywhere in the map', () => {
    const pool = buildTitleDistractorPool(allCards, target, 'facile')
    expect(pool.sort()).toEqual(['Autre branche', 'Autre niveau', 'Frère'].sort())
  })

  it('"difficile" prioritizes the same branch (same parent) first', () => {
    const pool = buildTitleDistractorPool(allCards, target, 'difficile')
    expect(pool[0]).toBe('Frère')
  })

  it('returns an empty pool when no other card exists', () => {
    const pool = buildTitleDistractorPool([target], target, 'facile')
    expect(pool).toEqual([])
  })
})

describe('attachDistractors', () => {
  const cardWithDef: Card = { id: 'a', level: 1, title: 'A', definition: 'Def A', parentId: null, order: 0 }
  const otherWithDef: Card = { id: 'b', level: 2, title: 'B', definition: 'Def B', parentId: 'a', order: 0 }
  const cardNoDef: Card = { id: 'c', level: 1, title: 'C', parentId: null, order: 0 }
  const otherNoDef: Card = { id: 'd', level: 2, title: 'D', parentId: 'c', order: 0 }

  it('fills distractorDefinitions for a qcm-definition question when distractors exist', () => {
    const questions = attachDistractors([cardWithDef, otherWithDef], [{ cardId: 'a', type: 'qcm-definition' }], 'facile')
    expect(questions).toEqual([{ cardId: 'a', type: 'qcm-definition', distractorDefinitions: ['Def B'] }])
  })

  it('falls back to "recall" when a qcm-definition question has no possible distractor', () => {
    const questions = attachDistractors([cardWithDef], [{ cardId: 'a', type: 'qcm-definition' }], 'facile')
    expect(questions).toEqual([{ cardId: 'a', type: 'recall' }])
  })

  it('fills distractorTitles and a full-definition hint for "facile" qcm-title', () => {
    const questions = attachDistractors([cardWithDef, otherWithDef], [{ cardId: 'a', type: 'qcm-title' }], 'facile')
    expect(questions).toEqual([{ cardId: 'a', type: 'qcm-title', distractorTitles: ['B'], hint: 'Def A' }])
  })

  it('truncates the hint for "moyen" qcm-title', () => {
    const longDef: Card = { ...cardWithDef, definition: 'Un long texte de définition pour vérifier la troncature' }
    const questions = attachDistractors([longDef, otherWithDef], [{ cardId: 'a', type: 'qcm-title' }], 'moyen')
    const [question] = questions
    expect(question.type).toBe('qcm-title')
    expect(question.hint).toMatch(/…$/)
    expect(question.hint!.length).toBeLessThan(longDef.definition!.length)
  })

  it('gives no hint for "difficile" qcm-title even when a definition exists', () => {
    const questions = attachDistractors([cardWithDef, otherWithDef], [{ cardId: 'a', type: 'qcm-title' }], 'difficile')
    expect(questions[0].hint).toBeUndefined()
  })

  it('gives no hint for qcm-title when the card has no definition at all', () => {
    const questions = attachDistractors([cardNoDef, otherNoDef], [{ cardId: 'c', type: 'qcm-title' }], 'facile')
    expect(questions[0].hint).toBeUndefined()
  })

  it('falls back to "recall" when a qcm-title question has no possible title distractor', () => {
    const questions = attachDistractors([cardWithDef], [{ cardId: 'a', type: 'qcm-title' }], 'facile')
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
      perfect: 2,
      assisted: 0,
      incorrect: 1,
      unanswered: 1,
      percentage: 50,
    })
  })

  it('returns an all-zero score for no results', () => {
    expect(computeScore({})).toEqual({
      correct: 0,
      total: 0,
      perfect: 0,
      assisted: 0,
      incorrect: 0,
      unanswered: 0,
      percentage: 0,
    })
  })

  it('counts a correct answer with no recorded progress as unaided', () => {
    // QCM questions have one shot, so they never get a progress entry — and
    // must not be under-reported as "assisted" because of that absence.
    const score = computeScore({ a: 'correct' })
    expect(score.perfect).toBe(1)
    expect(score.assisted).toBe(0)
  })

  it('separates answers found unaided from answers found after retries', () => {
    const score = computeScore(
      { a: 'correct', b: 'correct', c: 'incorrect' },
      {
        a: { attempts: 0, extraReveals: 0, lastTyped: null, lastSimilarity: null, gaveUp: false },
        b: { attempts: 2, extraReveals: 2, lastTyped: 'presque', lastSimilarity: 80, gaveUp: false },
        c: { attempts: 0, extraReveals: 0, lastTyped: null, lastSimilarity: null, gaveUp: true },
      }
    )

    expect(score).toMatchObject({ correct: 2, perfect: 1, assisted: 1, incorrect: 1, percentage: 67 })
  })
})
