import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { QuizConfig, QuizQuestion, QuizResult } from '../types/quiz'
import { selectQuizQuestions, attachDistractors } from './quizReducer'
import { useCardsStore } from './useCardsStore'

interface QuizState {
  active: boolean
  showSummary: boolean
  config: QuizConfig | null
  questions: QuizQuestion[]
  results: Record<string, QuizResult>
  wasLockedBeforeQuiz: boolean
  startQuiz: (config: QuizConfig) => void
  answerRecall: (cardId: string, correct: boolean) => void
  answerQcm: (cardId: string, chosenDefinition: string) => void
  finishQuiz: () => void
  endQuiz: () => void
}

export type QuizStore = UseBoundStore<StoreApi<QuizState>>

export function createQuizStore(): QuizStore {
  return create<QuizState>((set, get) => ({
    active: false,
    showSummary: false,
    config: null,
    questions: [],
    results: {},
    wasLockedBeforeQuiz: false,
    startQuiz: config => {
      const cards = useCardsStore.getState().history.present
      const questions = attachDistractors(cards, selectQuizQuestions(cards, config), config.difficulty)
      const results: Record<string, QuizResult> = {}
      for (const q of questions) results[q.cardId] = 'unanswered'

      const wasLocked = useCardsStore.getState().locked
      if (!wasLocked) useCardsStore.getState().toggleLock()

      set({ active: true, showSummary: false, config, questions, results, wasLockedBeforeQuiz: wasLocked })
    },
    answerRecall: (cardId, correct) =>
      set(state => ({ results: { ...state.results, [cardId]: correct ? 'correct' : 'incorrect' } })),
    answerQcm: (cardId, chosenDefinition) => {
      const card = useCardsStore.getState().history.present.find(c => c.id === cardId)
      const correct = card?.definition === chosenDefinition
      set(state => ({ results: { ...state.results, [cardId]: correct ? 'correct' : 'incorrect' } }))
    },
    finishQuiz: () => set({ showSummary: true }),
    endQuiz: () => {
      if (!get().wasLockedBeforeQuiz && useCardsStore.getState().locked) useCardsStore.getState().toggleLock()
      set({ active: false, showSummary: false, config: null, questions: [], results: {} })
    },
  }))
}

export const useQuizStore = createQuizStore()
