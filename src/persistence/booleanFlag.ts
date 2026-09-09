/**
 * Remembered on/off state for a small UI preference (a toggle button), kept
 * in `localStorage` beside the panel widths and session state — same
 * contract as `panelWidth.ts`: best-effort, never throws when storage is
 * blocked, and read synchronously so the first render already reflects it.
 */
export interface BooleanFlagStorage {
  load: () => boolean
  save: (value: boolean) => void
}

export function createBooleanFlagStorage(options: { key: string; fallback: boolean }): BooleanFlagStorage {
  const { key, fallback } = options

  return {
    load() {
      try {
        const raw = localStorage.getItem(key)
        if (raw === 'true') return true
        if (raw === 'false') return false
        return fallback
      } catch {
        return fallback
      }
    },
    save(value) {
      try {
        localStorage.setItem(key, String(value))
      } catch {
        // Best-effort: storage being blocked only costs the next launch its
        // remembered preference.
      }
    },
  }
}
