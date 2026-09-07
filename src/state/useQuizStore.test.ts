import { describe, it, expect, beforeEach } from 'vitest'
import { createQuizStore } from './useQuizStore'
import { useCardsStore, createCardsStore } from './useCardsStore'
import type { Card } from '../types/card'

const root: Card = { id: 'root', level: 1, title: 'Racine', definition: 'Def racine', parentId: null, order: 0 }
const child: Card = { id: 'child', level: 2, title: 'Enfant', definition: 'Def enfant', parentId: 'root', order: 0 }

describe('useQuizStore', () => {
  beforeEach(() => {
    const pristine = createCardsStore().getState()
    useCardsStore.setState({ history: pristine.history, locked: pristine.locked })
    useCardsStore.getState().loadCards([root, child])
  })

  it('starts inactive with no questions', () => {
    const store = createQuizStore()
    expect(store.getState().active).toBe(false)
    expect(store.getState().questions).toEqual([])
  })

  it('startQuiz populates questions/results and marks the quiz active', () => {
    const store = createQuizStore()
    store.getState().startQuiz({ levels: [1, 2], difficulty: 'difficile', qcmMode: false })

    expect(store.getState().active).toBe(true)
    expect(store.getState().questions).toHaveLength(2)
    expect(store.getState().results).toEqual({ root: 'unanswered', child: 'unanswered' })
  })

  it('startQuiz locks the mind map if it was not already locked', () => {
    const store = createQuizStore()
    expect(useCardsStore.getState().locked).toBe(false)

    store.getState().startQuiz({ levels: [1], difficulty: 'facile', qcmMode: false })

    expect(useCardsStore.getState().locked).toBe(true)
  })

  it('answerRecall records a correct/incorrect result for that card', () => {
    const store = createQuizStore()
    store.getState().startQuiz({ levels: [1, 2], difficulty: 'difficile', qcmMode: false })

    store.getState().answerRecall('root', true)
    store.getState().answerRecall('child', false)

    expect(store.getState().results).toEqual({ root: 'correct', child: 'incorrect' })
  })

  it('answerQcmDefinition compares the chosen definition against the card\'s real definition', () => {
    const store = createQuizStore()
    store.getState().startQuiz({ levels: [1, 2], difficulty: 'difficile', qcmMode: false })

    store.getState().answerQcmDefinition('root', 'Def racine')
    store.getState().answerQcmDefinition('child', 'Une définition fausse')

    expect(store.getState().results).toEqual({ root: 'correct', child: 'incorrect' })
  })

  it('answerQcmTitle compares the chosen title against the card\'s real title', () => {
    const store = createQuizStore()
    store.getState().startQuiz({ levels: [1, 2], difficulty: 'difficile', qcmMode: true })

    store.getState().answerQcmTitle('root', 'Racine')
    store.getState().answerQcmTitle('child', 'Un titre faux')

    expect(store.getState().results).toEqual({ root: 'correct', child: 'incorrect' })
  })

  it('finishQuiz opens the summary without ending the session', () => {
    const store = createQuizStore()
    store.getState().startQuiz({ levels: [1], difficulty: 'facile', qcmMode: false })

    store.getState().finishQuiz()

    expect(store.getState().showSummary).toBe(true)
    expect(store.getState().active).toBe(true)
  })

  it('endQuiz clears the session and re-locks/unlocks to the pre-quiz state', () => {
    const store = createQuizStore()
    store.getState().startQuiz({ levels: [1], difficulty: 'facile', qcmMode: false })

    store.getState().endQuiz()

    expect(store.getState().active).toBe(false)
    expect(store.getState().questions).toEqual([])
    expect(useCardsStore.getState().locked).toBe(false)
  })

  it('endQuiz leaves the mind map locked if the user had locked it before starting the quiz', () => {
    useCardsStore.getState().toggleLock()
    const store = createQuizStore()
    store.getState().startQuiz({ levels: [1], difficulty: 'facile', qcmMode: false })

    store.getState().endQuiz()

    expect(useCardsStore.getState().locked).toBe(true)
  })
})
