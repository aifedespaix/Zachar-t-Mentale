import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { QuizSettings } from '../types/quizSettings'
import { DEFAULT_QUIZ_SETTINGS } from '../types/quizSettings'
import { loadQuizSettings, saveQuizSettings } from '../persistence/quizSettings'

interface QuizSettingsState extends QuizSettings {
  init: () => Promise<void>
  setSimilarityThreshold: (value: number) => Promise<void>
  setLengthGuideEnabled: (value: boolean) => Promise<void>
}

export type QuizSettingsStore = UseBoundStore<StoreApi<QuizSettingsState>>

export function createQuizSettingsStore(): QuizSettingsStore {
  return create<QuizSettingsState>((set, get) => ({
    ...DEFAULT_QUIZ_SETTINGS,
    init: async () => {
      const settings = await loadQuizSettings()
      set(settings)
    },
    setSimilarityThreshold: async value => {
      const next = { similarityThreshold: value, lengthGuideEnabled: get().lengthGuideEnabled }
      set(next)
      await saveQuizSettings(next)
    },
    setLengthGuideEnabled: async value => {
      const next = { similarityThreshold: get().similarityThreshold, lengthGuideEnabled: value }
      set(next)
      await saveQuizSettings(next)
    },
  }))
}

export const useQuizSettingsStore = createQuizSettingsStore()
