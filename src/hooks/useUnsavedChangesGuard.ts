import { useCallback, useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { describeError, useWorkspaceStore } from '../state/useWorkspaceStore'
import { useSyncStore } from '../state/useSyncStore'

export interface UnsavedChangesPrompt {
  message: string
  /**
   * Replaces the dialog's default "continuer perdra ce changement" line, for a
   * prompt whose problem is not a lost change.
   */
  detail?: string
  /**
   * What continuing actually does — `null` when there is nothing left to
   * continue to, which turns the dialog into an acknowledgement rather than a
   * choice. A button that can only fail again is worse than no button.
   */
  continueLabel: string | null
  onContinue: (() => void) | null
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
      // Lu AVANT `setCurrentFile` : c'est le fichier qu'on QUITTE qu'il faut
      // synchroniser, pas celui qu'on ouvre — voir `syncOneFile`.
      const outgoingPath = useWorkspaceStore.getState().currentFilePath
      flush()
        .then(() => {
          setCurrentFile(path)
          // Fire-and-forget: switching files must never wait on the network,
          // and the file we just left is no longer "open in the canvas" —
          // see `SyncOneFileParams.openFilePath` — so it is now safe to pull
          // into. Un seul fichier, jamais le dossier entier : voir
          // `2026-09-15-suppression-publication-auto-sync-ciblee-design.md`.
          if (outgoingPath !== null) void useSyncStore.getState().syncOneFile(outgoingPath)
        })
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

      /**
       * `destroy`, never `close`: `close` re-emits close-requested and would
       * come straight back into the handler below, forever.
       *
       * The failure branch matters as much as the success one. The handler has
       * already vetoed the close with `preventDefault`, so a failed `destroy`
       * leaves the window standing — dismissing the dialog there would look
       * exactly like the button doing nothing at all.
       */
      async function closeNow(): Promise<void> {
        try {
          await win.destroy()
        } catch (error) {
          setPrompt({
            message: `Impossible de fermer la fenêtre : ${describeError(error)}`,
            detail:
              'Vos modifications sont enregistrées. Fermez la fenêtre depuis votre système d’exploitation (Alt+F4), puis signalez ce message.',
            continueLabel: null,
            onContinue: null,
          })
        }
      }

      win
        .onCloseRequested(async event => {
          event.preventDefault()
          // Lu AVANT `flush()` : c'est le fichier encore ouvert au moment de
          // fermer qu'il faut synchroniser — voir `requestOpenFile`.
          const closingPath = useWorkspaceStore.getState().currentFilePath
          try {
            await flush()
          } catch (error) {
            // Reported separately from a failed close on purpose: only a failed
            // SAVE puts a change at risk, and only it justifies asking the user
            // to quit anyway. Lumping the two together blamed the autosave for
            // a window that would not close, and offered to discard a change
            // that had in fact been written.
            setPrompt({
              message: `La sauvegarde a échoué : ${describeError(error)}`,
              continueLabel: 'Quitter quand même',
              onContinue: () => {
                setPrompt(null)
                void closeNow()
              },
            })
            return
          }
          if (closingPath !== null) void useSyncStore.getState().syncOneFile(closingPath)
          await closeNow()
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
