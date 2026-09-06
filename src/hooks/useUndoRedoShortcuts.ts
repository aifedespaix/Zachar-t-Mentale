import { useEffect } from 'react'
import { useCardsStore } from '../state/useCardsStore'

export function useUndoRedoShortcuts(): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
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
