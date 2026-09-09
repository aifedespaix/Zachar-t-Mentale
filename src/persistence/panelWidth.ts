/**
 * Remembered width for a resizable side panel.
 *
 * Two panels now flank the canvas — the file tree on the left, a card's fiche
 * on the right — and they want the same behaviour with different numbers: read
 * synchronously on the first render, clamped rather than trusted, and never
 * allowed to fail loudly when storage is blocked.
 *
 * `localStorage` beside the rest of the UI session state (`sessionState.ts`)
 * rather than Tauri's config file: it is a per-screen layout preference, it has
 * to be readable synchronously on the very first render (an async read would
 * make the panel visibly jump from the default to the saved width), and a
 * browser reload during development must restore it too.
 */
export interface PanelWidthStorage {
  MIN: number
  MAX: number
  DEFAULT: number
  /** Keeps a width inside the bounds; a non-finite value falls back to the default. */
  clamp: (width: number) => number
  /**
   * The width from the last session. A stored value that is out of bounds — a
   * hand-edited entry, or one saved before the bounds changed — is clamped
   * rather than trusted.
   */
  load: () => number
  save: (width: number) => void
}

export function createPanelWidthStorage(options: {
  key: string
  min: number
  max: number
  fallback: number
}): PanelWidthStorage {
  const { key, min, max, fallback } = options

  function clamp(width: number): number {
    if (!Number.isFinite(width)) return fallback
    return Math.min(max, Math.max(min, Math.round(width)))
  }

  return {
    MIN: min,
    MAX: max,
    DEFAULT: fallback,
    clamp,
    load() {
      try {
        const raw = localStorage.getItem(key)
        if (raw === null) return fallback
        return clamp(Number.parseFloat(raw))
      } catch {
        return fallback
      }
    },
    save(width) {
      try {
        localStorage.setItem(key, String(clamp(width)))
      } catch {
        // Best-effort, same contract as `saveSessionState`: storage being
        // blocked only costs the next launch its remembered width.
      }
    },
  }
}
