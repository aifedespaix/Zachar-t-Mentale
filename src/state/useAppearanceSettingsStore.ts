import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { AppearanceSettings, ThemeMode } from '../types/appearanceSettings'
import { DEFAULT_APPEARANCE_SETTINGS } from '../types/appearanceSettings'
import { loadAppearanceSettings, saveAppearanceSettings } from '../persistence/appearanceSettings'

interface AppearanceSettingsState extends AppearanceSettings {
  init: () => Promise<void>
  setFontFamily: (fontFamily: string) => Promise<void>
  setThemeMode: (themeMode: ThemeMode) => Promise<void>
  /** Apply settings in memory WITHOUT writing them to disk — see `commit`. */
  applyDraft: (settings: AppearanceSettings) => void
  /** Persist whatever is currently in memory. */
  commit: () => Promise<void>
  /** The current values, to snapshot before editing. */
  snapshot: () => AppearanceSettings
}

/**
 * The settings fields alone, without the actions the store mixes in beside
 * them. A snapshot has to be a plain settings object: it is kept across the
 * lifetime of the settings dialog and replayed through `applyDraft` on
 * "Annuler", so carrying stale action closures in it would be meaningless at
 * best and would re-install superseded actions at worst.
 */
function currentSettings(state: AppearanceSettings): AppearanceSettings {
  return { levels: state.levels, fontFamily: state.fontFamily, themeMode: state.themeMode }
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
    // The settings dialog edits through `applyDraft` so every change is
    // previewed live — a colour you cannot see while picking it is a colour
    // you cannot pick — but nothing touches the disk until "Enregistrer".
    // That is also what lets "Annuler" put the old look back: it replays the
    // snapshot it took when it opened.
    applyDraft: settings => set(settings),
    commit: () => persist(currentSettings(get())),
    snapshot: () => currentSettings(get()),
  }))
}

export const useAppearanceSettingsStore = createAppearanceSettingsStore()
