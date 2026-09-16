import { useCallback, useSyncExternalStore } from 'react'
import { canRedoDescription, canUndoDescription, subscribeDescriptionHistory } from './descriptionHistory'

/**
 * Whether a description can be undone or redone right now, as React state.
 *
 * `useSyncExternalStore` rather than a `useState` kept in step by hand. The
 * history moves from OUTSIDE React — the autosave debounce, the keyboard, a
 * symbol inserted from the palette — so recomputing the flags after each of
 * those would be a list of call sites to keep complete, and the one that got
 * missed would be a button that lies. Subscribing to the store itself is what
 * makes that impossible rather than merely unlikely.
 *
 * The snapshot is a NUMBER, not an object: `useSyncExternalStore` compares
 * snapshots by identity, so a fresh `{ canUndo, canRedo }` on every read would
 * re-render forever.
 */
export function useDescriptionHistory(cardId: string): { canUndo: boolean; canRedo: boolean } {
  const getSnapshot = useCallback(
    () => (canUndoDescription(cardId) ? 1 : 0) | (canRedoDescription(cardId) ? 2 : 0),
    [cardId]
  )
  const flags = useSyncExternalStore(subscribeDescriptionHistory, getSnapshot, getSnapshot)
  return { canUndo: (flags & 1) !== 0, canRedo: (flags & 2) !== 0 }
}
