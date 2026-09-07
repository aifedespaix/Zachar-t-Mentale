import { useCallback, useEffect, useRef } from 'react'
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
 *
 * The returned `flush` writes a pending change immediately instead of waiting
 * out the debounce — used before an action that leaves this path behind
 * (switching files, closing the window) so a change made moments earlier is
 * never silently dropped along with the cancelled timer.
 */
export function useAutosave(
  path: string,
  cards: Card[],
  delayMs = 500,
  enabled = true,
  onError?: (error: unknown) => void
): { flush: () => Promise<void> } {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Kept in refs so a caller passing an inline arrow does not restart the
  // debounce on every render, and so `flush` (a stable callback) always acts
  // on the latest values without itself needing to change identity.
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const pathRef = useRef(path)
  pathRef.current = path
  const cardsRef = useRef(cards)
  cardsRef.current = cards
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  // Whether `cardsRef`/`pathRef` hold a value not yet confirmed written to
  // disk — set whenever a save is scheduled, cleared only once it succeeds,
  // so a failed write stays flush-able even after its timer has already fired.
  const dirtyRef = useRef(false)

  useEffect(() => {
    if (!enabled) return

    dirtyRef.current = true
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = undefined
      saveMindMap(path, cards)
        .then(() => {
          dirtyRef.current = false
        })
        .catch(error => {
          onErrorRef.current?.(error)
        })
    }, delayMs)
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [path, cards, delayMs, enabled])

  const flush = useCallback(async () => {
    if (!dirtyRef.current || !enabledRef.current) return
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = undefined
    }
    try {
      await saveMindMap(pathRef.current, cardsRef.current)
      dirtyRef.current = false
    } catch (error) {
      onErrorRef.current?.(error)
      throw error
    }
  }, [])

  return { flush }
}
