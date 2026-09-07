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
    // Same shape as `useWorkspaceStore.init`: a corrupt or unreadable settings
    // file must degrade to the defaults, never surface as an unhandled
    // rejection from the `init()` App fires on mount. These settings have no
    // user-facing error surface (unlike the workspace's `workspaceError`), so
    // the fallback is silent.
    init: async () => {
      try {
        const settings = await loadQuizSettings()
        set(settings)
      } catch {
        set(DEFAULT_QUIZ_SETTINGS)
      }
    },
    setSimilarityThreshold: async value => {
      const next = { similarityThreshold: value, lengthGuideEnabled: get().lengthGuideEnabled }
      set(next)
      try {
        await saveQuizSettings(next)
      } catch {
        // Best-effort persistence: the in-memory value is already applied, and
        // a failed write must not throw into the click handler that caused it.
      }
    },
    setLengthGuideEnabled: async value => {
      const next = { similarityThreshold: get().similarityThreshold, lengthGuideEnabled: value }
      set(next)
      try {
        await saveQuizSettings(next)
      } catch {
        // Best-effort persistence; see `setSimilarityThreshold`.
      }
    },
  }))
}

export const useQuizSettingsStore = createQuizSettingsStore()
