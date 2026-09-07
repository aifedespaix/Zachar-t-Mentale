import { useCallback, useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { describeError } from '../state/useWorkspaceStore'

export interface UnsavedChangesPrompt {
  message: string
  continueLabel: string
  onContinue: () => void
}

/**
 * Guards the two moments a pending autosave could otherwise be silently
 * dropped: switching to a different file, and closing the window. Both
 * flush first; on success the action proceeds with no interruption (the
 * common case — autosave already covers it). Only a FAILED flush surfaces
 * a prompt, since that is the one case where continuing really would lose
 * the change.
 */
export function useUnsavedChangesGuard(
  flush: () => Promise<void>,
  setCurrentFile: (path: string | null) => void
): {
  requestOpenFile: (path: string) => void
  prompt: UnsavedChangesPrompt | null
  dismissPrompt: () => void
} {
  const [prompt, setPrompt] = useState<UnsavedChangesPrompt | null>(null)

  const requestOpenFile = useCallback(
    (path: string) => {
      flush()
        .then(() => setCurrentFile(path))
        .catch((error: unknown) => {
          setPrompt({
            message: `La sauvegarde a échoué : ${describeError(error)}`,
            continueLabel: 'Ouvrir quand même',
            onContinue: () => {
              setPrompt(null)
              setCurrentFile(path)
            },
          })
        })
    },
    [flush, setCurrentFile]
  )

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined

    try {
      const win = getCurrentWindow()
      win
        .onCloseRequested(async event => {
          event.preventDefault()
          try {
            await flush()
            await win.destroy()
          } catch (error) {
            setPrompt({
              message: `La sauvegarde a échoué : ${describeError(error)}`,
              continueLabel: 'Quitter quand même',
              onContinue: () => {
                setPrompt(null)
                win.destroy()
              },
            })
          }
        })
        .then(fn => {
          if (cancelled) fn()
          else unlisten = fn
        })
        .catch(() => {})
    } catch {
      // Not running inside a Tauri window.
    }

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [flush])

  return { requestOpenFile, prompt, dismissPrompt: () => setPrompt(null) }
}
