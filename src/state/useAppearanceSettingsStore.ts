import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { AppearanceSettings, ThemeMode } from '../types/appearanceSettings'
import { DEFAULT_APPEARANCE_SETTINGS } from '../types/appearanceSettings'
import type { LevelColor } from '../colors/levelColors'
import type { CardLevel } from '../types/card'
import { loadAppearanceSettings, saveAppearanceSettings } from '../persistence/appearanceSettings'

interface AppearanceSettingsState extends AppearanceSettings {
  init: () => Promise<void>
  setLevelLabel: (level: CardLevel, label: string) => Promise<void>
  setLevelColor: (level: CardLevel, theme: 'light' | 'dark', patch: Partial<LevelColor>) => Promise<void>
  setFontFamily: (fontFamily: string) => Promise<void>
  setThemeMode: (themeMode: ThemeMode) => Promise<void>
}

export type AppearanceSettingsStore = UseBoundStore<StoreApi<AppearanceSettingsState>>

// Serializes persistence writes so overlapping setter calls (e.g. dragging an
// OKLCH slider fires setLevelColor repeatedly) can never land out of order —
// each write waits for the previous one to finish before starting, so the
// last write to actually run always reflects the most recent in-memory state.
let writeQueue: Promise<void> = Promise.resolve()

function persist(settings: AppearanceSettings): Promise<void> {
  writeQueue = writeQueue.then(() =>
    saveAppearanceSettings(settings).catch(() => {
      // Best-effort persistence: the in-memory value is already applied, and
      // a failed write must not throw into the caller.
    })
  )
  return writeQueue
}

export function createAppearanceSettingsStore(): AppearanceSettingsStore {
  return create<AppearanceSettingsState>((set, get) => ({
    ...DEFAULT_APPEARANCE_SETTINGS,
    // Same shape as `useQuizSettingsStore.init`: a corrupt or unreadable
    // settings file must degrade to the defaults, never surface as an
    // unhandled rejection from the `init()` App fires on mount.
    init: async () => {
      try {
        const settings = await loadAppearanceSettings()
        set(settings)
      } catch {
        set(DEFAULT_APPEARANCE_SETTINGS)
      }
    },
    setLevelLabel: async (level, label) => {
      const current = get()
      const next: AppearanceSettings = {
        ...current,
        levels: { ...current.levels, [level]: { ...current.levels[level], label } },
      }
      set(next)
      await persist(next)
    },
    setLevelColor: async (level, theme, patch) => {
      const current = get()
      const currentLevel = current.levels[level]
      const next: AppearanceSettings = {
        ...current,
        levels: {
          ...current.levels,
          [level]: {
            ...currentLevel,
            color: { ...currentLevel.color, [theme]: { ...currentLevel.color[theme], ...patch } },
          },
        },
      }
      set(next)
      await persist(next)
    },
    setFontFamily: async fontFamily => {
      const next: AppearanceSettings = { ...get(), fontFamily }
      set(next)
      await persist(next)
    },
    setThemeMode: async themeMode => {
      const next: AppearanceSettings = { ...get(), themeMode }
      set(next)
      await persist(next)
    },
  }))
}

export const useAppearanceSettingsStore = createAppearanceSettingsStore()
