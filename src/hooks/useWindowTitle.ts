import { useEffect } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { windowTitleFor } from '../persistence/windowTitle'

/**
 * Keeps the OS window title in sync with the open file. A failed update is
 * cosmetic (e.g. running outside a Tauri window, in a plain browser tab —
 * `getCurrentWindow()` throws synchronously there rather than rejecting) and
 * is silently ignored rather than surfaced to the user.
 */
export function useWindowTitle(currentFilePath: string | null): void {
  useEffect(() => {
    try {
      getCurrentWindow()
        .setTitle(windowTitleFor(currentFilePath))
        .catch(() => {})
    } catch {
      // Not running inside a Tauri window — nothing to update.
    }
  }, [currentFilePath])
}
