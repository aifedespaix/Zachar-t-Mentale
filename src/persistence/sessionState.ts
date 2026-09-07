const STORAGE_KEY = 'zachart-mentale:session'

export interface SessionState {
  currentFilePath: string | null
  expandedPaths: string[]
}

const EMPTY_SESSION: SessionState = { currentFilePath: null, expandedPaths: [] }

/**
 * The last open file and expanded sidebar folders, kept in `localStorage` so
 * a page reload — whether from a dev-server HMR reload or a plain browser
 * refresh, where there is no Tauri config file to fall back to — can put the
 * app straight back where the user left it.
 */
export function loadSessionState(): SessionState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY_SESSION
    const parsed = JSON.parse(raw) as Partial<SessionState>
    return {
      currentFilePath: parsed.currentFilePath ?? null,
      expandedPaths: parsed.expandedPaths ?? [],
    }
  } catch {
    return EMPTY_SESSION
  }
}

export function saveSessionState(state: SessionState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Best-effort: a browser blocking storage (e.g. private mode) just means
    // the next reload won't restore the session — not worth surfacing.
  }
}
