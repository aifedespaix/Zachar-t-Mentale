const STORAGE_KEY = 'zachart-mentale:sidebar-width'

/**
 * The bounds a drag on the sidebar's right border may land in. Below the
 * minimum a nested mind map's name is already elided down to nothing usable,
 * and past the maximum the sidebar starts eating the canvas — which is the
 * part of the app the user is actually working in.
 */
export const MIN_SIDEBAR_WIDTH = 180
export const MAX_SIDEBAR_WIDTH = 520
export const DEFAULT_SIDEBAR_WIDTH = 240

/** Keeps a width inside the bounds; a non-finite value falls back to the default. */
export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_SIDEBAR_WIDTH
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)))
}

/**
 * The sidebar width from the last session, in `localStorage` beside the rest
 * of the UI session state (`sessionState.ts`) rather than in Tauri's config
 * file: it is a per-screen layout preference, it has to be readable
 * synchronously on the very first render (an async read would make the
 * sidebar visibly jump from the default to the saved width), and a browser
 * reload during development must restore it too.
 *
 * A stored value that is out of bounds — a hand-edited entry, or one saved
 * before the bounds changed — is clamped rather than trusted.
 */
export function loadSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return DEFAULT_SIDEBAR_WIDTH
    return clampSidebarWidth(Number.parseFloat(raw))
  } catch {
    return DEFAULT_SIDEBAR_WIDTH
  }
}

export function saveSidebarWidth(width: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(clampSidebarWidth(width)))
  } catch {
    // Best-effort, same contract as `saveSessionState`: storage being blocked
    // only costs the next launch its remembered width.
  }
}
