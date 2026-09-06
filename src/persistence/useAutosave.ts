import { useEffect, useRef } from 'react'
import type { Card } from '../types/card'
import { saveMindMap } from './fileStore'

/**
 * Debounced autosave.
 *
 * `enabled` gates the whole effect: the caller must keep it false until it
 * knows saving is safe (i.e. the initial load either produced cards or proved
 * there is no file yet). Without that gate the debounce can fire before a slow
 * load resolves — or after a failed one — and overwrite a real chapter with the
 * store's transient default root card.
 *
 * `onError` surfaces a rejected write. The app has no manual Save button, so a
 * silently failed autosave would leave the user with no signal at all.
 */
export function useAutosave(
  path: string,
  cards: Card[],
  delayMs = 500,
  enabled = true,
  onError?: (error: unknown) => void
): void {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Kept in a ref so a caller passing an inline arrow does not restart the
  // debounce on every render.
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  useEffect(() => {
    if (!enabled) return

    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      saveMindMap(path, cards).catch(error => {
        onErrorRef.current?.(error)
      })
    }, delayMs)
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [path, cards, delayMs, enabled])
}
