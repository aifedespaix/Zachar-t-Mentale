import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { QuizConfig, QuizQuestion, QuizResult, RecallProgress } from '../types/quiz'
import { EMPTY_RECALL_PROGRESS } from '../types/quiz'
import { selectQuizQuestions, attachDistractors } from './quizReducer'
import { computeTitleSimilarity } from '../utils/textSimilarity'
import { useCardsStore } from './useCardsStore'

/** What a recall submission did, so the dialog can react without re-reading the store. */
export interface RecallOutcome {
  correct: boolean
  similarity: number
}

interface QuizState {
  active: boolean
  showSummary: boolean
  config: QuizConfig | null
  questions: QuizQuestion[]
  results: Record<string, QuizResult>
  recallProgress: Record<string, RecallProgress>
  wasLockedBeforeQuiz: boolean
  startQuiz: (config: QuizConfig) => void
  restartQuiz: () => void
  submitRecall: (cardId: string, typed: string, threshold: number) => RecallOutcome
  revealRecallAnswer: (cardId: string) => void
  answerQcmDefinition: (cardId: string, chosenDefinition: string) => void
  answerQcmTitle: (cardId: string, chosenTitle: string) => void
  finishQuiz: () => void
  endQuiz: () => void
}

export type QuizStore = UseBoundStore<StoreApi<QuizState>>

/**
 * Records one card's verdict, and closes the quiz when that was the last one.
 *
 * Auto-finishing here rather than in a component is what makes it
 * unconditional: every answer path — the two QCM kinds, a recall found, a
 * recall given up on — funnels through this, so the summary cannot be missed
 * because one of them forgot to check. The user never has to hunt for
 * "Terminer" after answering the last card; that button is only there for
 * leaving a quiz early.
 */
function withResult(
  state: { results: Record<string, QuizResult> },
  cardId: string,
  result: QuizResult
): { results: Record<string, QuizResult>; showSummary?: true } {
  const results = { ...state.results, [cardId]: result }
  const allAnswered = Object.values(results).every(entry => entry !== 'unanswered')
  return allAnswered ? { results, showSummary: true } : { results }
}

export function createQuizStore(): QuizStore {
  return create<QuizState>((set, get) => ({
    active: false,
    showSummary: false,
    config: null,
    questions: [],
    results: {},
    recallProgress: {},
    wasLockedBeforeQuiz: false,
    startQuiz: config => {
      // Floating cards are a scratch area, not revision material: they are kept
      // out of both the drawn questions and the distractor pool.
      const cards = useCardsStore.getState().history.present.filter(c => !c.detached)
      const questions = attachDistractors(cards, selectQuizQuestions(cards, config), config.difficulty)
      const results: Record<string, QuizResult> = {}
      const recallProgress: Record<string, RecallProgress> = {}
      for (const q of questions) {
        results[q.cardId] = 'unanswered'
        if (q.type === 'recall') recallProgress[q.cardId] = { ...EMPTY_RECALL_PROGRESS }
      }

      const wasLocked = useCardsStore.getState().locked
      if (!wasLocked) useCardsStore.getState().toggleLock()

      set({
        active: true,
        showSummary: false,
        config,
        questions,
        results,
        recallProgress,
        wasLockedBeforeQuiz: wasLocked,
      })
    },
    /**
     * "Recommencer" from the summary: the same settings, freshly drawn.
     *
     * It goes back through `startQuiz` rather than resetting the results in
     * place, so the cards sampled and the distractors offered are drawn again —
     * replaying the identical questions would test memory of the last screen,
     * not of the course. `wasLockedBeforeQuiz` survives because `startQuiz`
     * re-reads the CURRENT lock state, which the quiz already forced on.
     */
    restartQuiz: () => {
      const { config } = get()
      if (config) get().startQuiz(config)
    },
    /**
     * Grade a typed recall answer — and, when it is wrong, help instead of judging.
     *
     * A miss does NOT close the question: it costs one attempt, buys one more
     * revealed letter, and leaves the card unanswered so the user can try
     * again with a better-scaffolded blank. That is the difference between
     * practising and being examined, and it is why the answer is never simply
     * printed on a wrong try. The loop terminates on its own: help grows one
     * letter at a time until the blank spells the answer out.
     */
    submitRecall: (cardId, typed, threshold) => {
      const card = useCardsStore.getState().history.present.find(c => c.id === cardId)
      const similarity = card ? computeTitleSimilarity(typed, card.title) : 0
      const correct = similarity >= threshold
      set(state => {
        const previous = state.recallProgress[cardId] ?? EMPTY_RECALL_PROGRESS
        const recallProgress = {
          ...state.recallProgress,
          [cardId]: {
            ...previous,
            attempts: correct ? previous.attempts : previous.attempts + 1,
            extraReveals: correct ? previous.extraReveals : previous.extraReveals + 1,
            lastTyped: typed,
            lastSimilarity: similarity,
          },
        }
        return correct ? { ...withResult(state, cardId, 'correct'), recallProgress } : { recallProgress }
      })
      return { correct, similarity }
    },
    /**
     * "Voir la réponse": the way out of a card the user genuinely cannot find.
     *
     * Graded incorrect — they did not recall it — but recorded as `gaveUp` so
     * the field shows the answer in full instead of leaving them staring at a
     * blank they have already given up on.
     */
    revealRecallAnswer: cardId =>
      set(state => ({
        ...withResult(state, cardId, 'incorrect'),
        recallProgress: {
          ...state.recallProgress,
          [cardId]: { ...(state.recallProgress[cardId] ?? EMPTY_RECALL_PROGRESS), gaveUp: true },
        },
      })),
    answerQcmDefinition: (cardId, chosenDefinition) => {
      const card = useCardsStore.getState().history.present.find(c => c.id === cardId)
      const correct = card?.definition === chosenDefinition
      set(state => withResult(state, cardId, correct ? 'correct' : 'incorrect'))
    },
    answerQcmTitle: (cardId, chosenTitle) => {
      const card = useCardsStore.getState().history.present.find(c => c.id === cardId)
      const correct = card?.title === chosenTitle
      set(state => withResult(state, cardId, correct ? 'correct' : 'incorrect'))
    },
    finishQuiz: () => set({ showSummary: true }),
    endQuiz: () => {
      if (!get().wasLockedBeforeQuiz && useCardsStore.getState().locked) useCardsStore.getState().toggleLock()
      set({
        active: false,
        showSummary: false,
        config: null,
        questions: [],
        results: {},
        recallProgress: {},
      })
    },
  }))
}

export const useQuizStore = createQuizStore()
