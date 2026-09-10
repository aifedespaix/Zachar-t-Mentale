import { useEffect, useRef } from 'react'
import { useSyncStore } from '../state/useSyncStore'

/**
 * Runs the sync on its own — but only when the user asked for it, with
 * « Synchroniser au lancement » or an interval, in Réglages → Synchronisation.
 *
 * Three things it deliberately does NOT do:
 *
 * - fire without a signed-in account and a chosen folder (there would be
 *   nothing to sync, and the store would answer with a failure banner),
 * - fire twice at launch, whatever re-renders happen,
 * - overlap two runs: the store's own guard drops the second caller, so a slow
 *   sync simply absorbs the next tick.
 */
export function useAutoSync() {
  const ready = useSyncStore(state => state.currentUser !== null && state.syncFolderPath !== null)
  const onLaunch = useSyncStore(state => state.autoSyncOnLaunch)
  const intervalMinutes = useSyncStore(state => state.autoSyncIntervalMinutes)
  const syncNow = useSyncStore(state => state.syncNow)
  // One launch sync per app session: refs survive re-renders, and a fresh mount
  // is exactly what "at launch" means.
  const launched = useRef(false)

  useEffect(() => {
    if (!ready || !onLaunch || launched.current) return
    launched.current = true
    void syncNow({ trigger: 'auto' })
  }, [ready, onLaunch, syncNow])

  useEffect(() => {
    if (!ready || intervalMinutes <= 0) return
    const timer = setInterval(() => void syncNow({ trigger: 'auto' }), intervalMinutes * 60_000)
    return () => clearInterval(timer)
  }, [ready, intervalMinutes, syncNow])
}
