import { useCallback, useEffect, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { describeError, useWorkspaceStore } from '../state/useWorkspaceStore'
import { useSyncStore } from '../state/useSyncStore'

/**
 * Plafond de la synchronisation de fermeture. Une fenêtre qui refuse de se
 * fermer parce que le réseau traîne est pire qu'une synchro manquée : au-delà,
 * on ferme quand même, et le prochain lancement rattrapera.
 */
export const CLOSE_SYNC_TIMEOUT_MS = 5000

/** La question posée au moment de fermer, isolée pour que les tests la pilotent. */
function defaultIsOnline(): boolean {
  return navigator.onLine
}

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
export interface UnsavedChangesGuardOptions {
  /**
   * Répond « y a-t-il un réseau ? ». La synchro de fermeture ne part que si
   * oui ; sinon on ferme normalement, comme si de rien n'était.
   */
  isOnline?: () => boolean
}

export function useUnsavedChangesGuard(
  flush: () => Promise<void>,
  setCurrentFile: (path: string | null) => void,
  options: UnsavedChangesGuardOptions = {}
): {
  requestOpenFile: (path: string) => void
  prompt: UnsavedChangesPrompt | null
  dismissPrompt: () => void
  /** Vrai pendant la synchro de fermeture : l'écran de chargement se montre. */
  closing: boolean
} {
  const [prompt, setPrompt] = useState<UnsavedChangesPrompt | null>(null)
  const [closing, setClosing] = useState(false)
  // Le « en ligne » du dernier rendu, lu au moment de fermer. Une ref plutôt
  // qu'une dépendance d'effet : repasser par onCloseRequested à chaque rendu
  // reposerait un écouteur pour rien.
  const isOnline = options.isOnline ?? defaultIsOnline
  const isOnlineRef = useRef(isOnline)
  useEffect(() => {
    isOnlineRef.current = isOnline
  }, [isOnline])

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
          // Pas de réseau : on ferme normalement, la synchro attendra un
          // prochain lancement — c'est la consigne, et insister ne ferait que
          // retarder une fermeture pour un run qui échouerait de toute façon.
          if (!isOnlineRef.current()) {
            await closeNow()
            return
          }
          // Un réseau, donc : on synchronise TOUT le dossier avant de partir —
          // dernière occasion de pousser quoi que ce soit. L'écran de chargement
          // couvre l'attente, plafonnée pour ne jamais bloquer la fermeture.
          setClosing(true)
          let timer: ReturnType<typeof setTimeout> | undefined
          try {
            await Promise.race([
              useSyncStore.getState().syncNow({ trigger: 'auto' }),
              new Promise<void>(resolve => {
                timer = setTimeout(resolve, CLOSE_SYNC_TIMEOUT_MS)
              }),
            ])
          } finally {
            if (timer !== undefined) clearTimeout(timer)
            // L'écran reste jusqu'au dernier instant : le retirer avant
            // `destroy` ferait réapparaître l'application une fraction de
            // seconde, juste avant qu'elle disparaisse.
            await closeNow()
            setClosing(false)
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

  return { requestOpenFile, prompt, dismissPrompt: () => setPrompt(null), closing }
}
