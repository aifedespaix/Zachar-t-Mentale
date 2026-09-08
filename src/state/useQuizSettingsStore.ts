import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { QuizSettings } from '../types/quizSettings'
import { DEFAULT_QUIZ_SETTINGS } from '../types/quizSettings'
import { loadQuizSettings, saveQuizSettings } from '../persistence/quizSettings'

interface QuizSettingsState extends QuizSettings {
  init: () => Promise<void>
  setSimilarityThreshold: (value: number) => Promise<void>
  setLengthGuideEnabled: (value: boolean) => Promise<void>
  setLiveLetterFeedback: (value: boolean) => Promise<void>
  /** Apply settings in memory WITHOUT writing them to disk — see `commit`. */
  applyDraft: (settings: QuizSettings) => void
  /** Persist whatever is currently in memory. */
  commit: () => Promise<void>
  /** The current values, to snapshot before editing. */
  snapshot: () => QuizSettings
}

export type QuizSettingsStore = UseBoundStore<StoreApi<QuizSettingsState>>

function currentSettings(state: QuizSettings): QuizSettings {
  return {
    similarityThreshold: state.similarityThreshold,
    lengthGuideEnabled: state.lengthGuideEnabled,
    liveLetterFeedback: state.liveLetterFeedback,
  }
}

export function createQuizSettingsStore(): QuizSettingsStore {
  return create<QuizSettingsState>((set, get) => {
    async function persist(next: QuizSettings): Promise<void> {
      set(next)
      try {
        await saveQuizSettings(next)
      } catch {
        // Best-effort persistence: the in-memory value is already applied, and
        // a failed write must not throw into the click handler that caused it.
      }
    }

    return {
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
      setSimilarityThreshold: value => persist({ ...currentSettings(get()), similarityThreshold: value }),
      setLengthGuideEnabled: value => persist({ ...currentSettings(get()), lengthGuideEnabled: value }),
      setLiveLetterFeedback: value => persist({ ...currentSettings(get()), liveLetterFeedback: value }),
      // The settings dialog edits through `applyDraft` so every change is
      // previewed live but nothing touches the disk until "Enregistrer" —
      // which is what makes "Annuler" able to put the old values back by
      // replaying the snapshot it took when it opened.
      applyDraft: settings => set(settings),
      commit: () => persist(currentSettings(get())),
      snapshot: () => currentSettings(get()),
    }
  })
}

export const useQuizSettingsStore = createQuizSettingsStore()
