import { useEffect } from 'react'
import { useCardsStore } from '../state/useCardsStore'

// Ctrl+Z inside a text field must undo the TEXT, not the card structure —
// hijacking it there silently reverts a structural action while the editor
// stays open with a now-stale draft, which then gets re-committed on blur.
function isEditableTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) return true
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLElement && target.isContentEditable) return true
  return false
}

export function useUndoRedoShortcuts(): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return

      const isUndoCombo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey
      const isRedoCombo =
        (event.ctrlKey || event.metaKey) &&
        ((event.key.toLowerCase() === 'z' && event.shiftKey) || event.key.toLowerCase() === 'y')

      if (isRedoCombo) {
        event.preventDefault()
        useCardsStore.getState().redo()
      } else if (isUndoCombo) {
        event.preventDefault()
        useCardsStore.getState().undo()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
