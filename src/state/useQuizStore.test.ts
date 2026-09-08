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

  it('startQuiz seeds recall progress only for the cards that are typed, not picked', () => {
    // Both cards have a definition, so both are drawn as QCM questions.
    const store = createQuizStore()
    store.getState().startQuiz({ levels: [1, 2], difficulty: 'difficile', qcmMode: false })

    expect(store.getState().recallProgress).toEqual({})
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

  it('endQuiz clears recall progress so a later quiz on the same card starts unaided', () => {
    const store = createQuizStore()
    store.getState().startQuiz({ levels: [1, 2], difficulty: 'difficile', qcmMode: false })
    store.getState().answerQcmDefinition('root', 'Def racine')

    store.getState().endQuiz()

    expect(store.getState().recallProgress).toEqual({})
    expect(store.getState().results).toEqual({})
  })

  it('opens the summary by itself once the last card is answered', () => {
    const store = createQuizStore()
    store.getState().startQuiz({ levels: [1, 2], difficulty: 'difficile', qcmMode: false })

    store.getState().answerQcmDefinition('root', 'Def racine')
    expect(store.getState().showSummary).toBe(false)

    store.getState().answerQcmDefinition('child', 'Def enfant')
    expect(store.getState().showSummary).toBe(true)
    // Auto-finishing shows the score; it does not tear the session down, so
    // the summary can still offer "recommencer" and the cards stay on screen.
    expect(store.getState().active).toBe(true)
  })

  it('restartQuiz redraws a fresh round with the same settings', () => {
    const store = createQuizStore()
    store.getState().startQuiz({ levels: [1, 2], difficulty: 'difficile', qcmMode: true })
    store.getState().answerQcmTitle('root', 'Racine')
    store.getState().answerQcmTitle('child', 'Un titre faux')

    store.getState().restartQuiz()

    expect(store.getState().showSummary).toBe(false)
    expect(store.getState().results).toEqual({ root: 'unanswered', child: 'unanswered' })
    expect(store.getState().config).toEqual({ levels: [1, 2], difficulty: 'difficile', qcmMode: true })
  })

  it('restartQuiz is a no-op when no quiz was ever configured', () => {
    const store = createQuizStore()

    store.getState().restartQuiz()

    expect(store.getState().active).toBe(false)
  })
})

describe('useQuizStore — typed recall answers', () => {
  // No definition, so these cards are drawn as `recall` (fill-in-the-blank).
  const plainRoot: Card = { id: 'root', level: 1, title: 'Bonsoir', parentId: null, order: 0 }
  const plainChild: Card = { id: 'child', level: 2, title: 'Enfant', parentId: 'root', order: 0 }

  beforeEach(() => {
    const pristine = createCardsStore().getState()
    useCardsStore.setState({ history: pristine.history, locked: pristine.locked })
    useCardsStore.getState().loadCards([plainRoot, plainChild])
  })

  function startRecallQuiz() {
    const store = createQuizStore()
    store.getState().startQuiz({ levels: [1, 2], difficulty: 'difficile', qcmMode: false })
    return store
  }

  it('seeds a blank progress entry for every recall card', () => {
    const store = startRecallQuiz()

    expect(store.getState().recallProgress.root).toEqual({
      attempts: 0,
      extraReveals: 0,
      lastTyped: null,
      lastSimilarity: null,
      gaveUp: false,
    })
  })

  it('marks an exact answer correct, unaided', () => {
    const store = startRecallQuiz()

    const outcome = store.getState().submitRecall('root', 'Bonsoir', 100)

    expect(outcome).toEqual({ correct: true, similarity: 100 })
    expect(store.getState().results.root).toBe('correct')
    expect(store.getState().recallProgress.root.attempts).toBe(0)
  })

  it('accepts an answer at the configured similarity threshold rather than demanding an exact match', () => {
    const store = startRecallQuiz()

    const outcome = store.getState().submitRecall('root', 'Bonsoi', 80)

    expect(outcome.correct).toBe(true)
    expect(store.getState().results.root).toBe('correct')
  })

  it('leaves a wrong answer unanswered and buys one more revealed letter instead', () => {
    const store = startRecallQuiz()

    const outcome = store.getState().submitRecall('root', 'Bonjour', 100)

    expect(outcome.correct).toBe(false)
    // The whole point: a miss is help, not a verdict — the card stays open.
    expect(store.getState().results.root).toBe('unanswered')
    expect(store.getState().recallProgress.root.attempts).toBe(1)
    expect(store.getState().recallProgress.root.extraReveals).toBe(1)
  })

  it('keeps the last attempt so the field can show what was typed and how close it was', () => {
    const store = startRecallQuiz()

    store.getState().submitRecall('root', 'Bonjour', 100)

    expect(store.getState().recallProgress.root.lastTyped).toBe('Bonjour')
    expect(store.getState().recallProgress.root.lastSimilarity).toBe(71)
  })

  it('accumulates help across successive misses', () => {
    const store = startRecallQuiz()

    store.getState().submitRecall('root', 'Bonjour', 100)
    store.getState().submitRecall('root', 'Bonsour', 100)

    expect(store.getState().recallProgress.root.extraReveals).toBe(2)
  })

  it('records a card found only after retries as correct-but-assisted', () => {
    const store = startRecallQuiz()

    store.getState().submitRecall('root', 'Bonjour', 100)
    store.getState().submitRecall('root', 'Bonsoir', 100)

    expect(store.getState().results.root).toBe('correct')
    // Non-zero attempts is what the summary reads to tell this apart from a
    // first-try success.
    expect(store.getState().recallProgress.root.attempts).toBe(1)
  })

  it('grades a card the user gave up on as incorrect and marks it for full reveal', () => {
    const store = startRecallQuiz()

    store.getState().revealRecallAnswer('root')

    expect(store.getState().results.root).toBe('incorrect')
    expect(store.getState().recallProgress.root.gaveUp).toBe(true)
  })

  it('scores a submission for an unknown card as wrong rather than throwing', () => {
    const store = startRecallQuiz()

    expect(store.getState().submitRecall('absent', 'quoi', 100)).toEqual({ correct: false, similarity: 0 })
  })

  it('auto-finishes when the last recall card is answered', () => {
    const store = startRecallQuiz()

    store.getState().submitRecall('root', 'Bonsoir', 100)
    expect(store.getState().showSummary).toBe(false)

    store.getState().submitRecall('child', 'Enfant', 100)
    expect(store.getState().showSummary).toBe(true)
  })

  it('does not auto-finish on a wrong answer, which leaves the card open', () => {
    const store = startRecallQuiz()

    store.getState().submitRecall('root', 'Bonsoir', 100)
    store.getState().submitRecall('child', 'Faux', 100)

    expect(store.getState().showSummary).toBe(false)
  })

  it('auto-finishes when the last card is given up on', () => {
    const store = startRecallQuiz()

    store.getState().submitRecall('root', 'Bonsoir', 100)
    store.getState().revealRecallAnswer('child')

    expect(store.getState().showSummary).toBe(true)
  })
})
