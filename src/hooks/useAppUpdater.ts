import { useEffect, useState } from 'react'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

export interface AppUpdaterState {
  /** True once a signed update has been fully downloaded and installed —
   * restarting the app is safe and will boot into the new version. */
  updateReady: boolean
  applyUpdate: () => Promise<void>
}

/**
 * Checks for an update once on mount and, if one exists, downloads and
 * installs it silently in the background — no progress UI, no prompt.
 * Any failure (offline, unreachable endpoint, bad signature, dropped
 * download) is swallowed: the app just tries again on its next launch.
 * `applyUpdate` (relaunch) is never called automatically — only a user
 * action should ever restart the app.
 */
export function useAppUpdater(): AppUpdaterState {
  const [updateReady, setUpdateReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    check()
      .then(async update => {
        if (!update || update.available === false) return
        await update.downloadAndInstall()
        if (!cancelled) setUpdateReady(true)
      })
      .catch(error => {
        console.error('Échec de la vérification/installation de la mise à jour :', error)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { updateReady, applyUpdate: relaunch }
}
