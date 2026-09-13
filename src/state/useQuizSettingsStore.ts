import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { QuizSettings } from '../types/quizSettings'
import { DEFAULT_QUIZ_SETTINGS } from '../types/quizSettings'
import type { QuizConfig } from '../types/quiz'
import { loadQuizSettings, saveQuizSettings } from '../persistence/quizSettings'

interface QuizSettingsState extends QuizSettings {
  init: () => Promise<void>
  setSimilarityThreshold: (value: number) => Promise<void>
  setLengthGuideEnabled: (value: boolean) => Promise<void>
  setLiveLetterFeedback: (value: boolean) => Promise<void>
  /** Remember the quiz modal's configuration for the next launch. */
  setLastQuizConfig: (config: QuizConfig) => Promise<void>
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
    // Carried through every save: a write that dropped it would silently wipe
    // the remembered modal configuration on the next app start.
    lastQuizConfig: state.lastQuizConfig,
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
      //
      // Merged over the defaults rather than assigned, so a file missing a field
      // written by a later version cannot leave that field undefined in memory.
      init: async () => {
        try {
          const settings = await loadQuizSettings()
          set({ ...DEFAULT_QUIZ_SETTINGS, ...settings })
        } catch {
          set(DEFAULT_QUIZ_SETTINGS)
        }
      },
      setSimilarityThreshold: value => persist({ ...currentSettings(get()), similarityThreshold: value }),
      setLengthGuideEnabled: value => persist({ ...currentSettings(get()), lengthGuideEnabled: value }),
      setLiveLetterFeedback: value => persist({ ...currentSettings(get()), liveLetterFeedback: value }),
      setLastQuizConfig: config => persist({ ...currentSettings(get()), lastQuizConfig: config }),
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
