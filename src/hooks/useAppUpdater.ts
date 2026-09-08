import { useEffect, useRef, useState } from 'react'
import { check, type Update } from '@tauri-apps/plugin-updater'

export interface AppUpdaterState {
  /** True once a signed update has been fully downloaded (not yet
   * installed) — the download itself never interrupts the app; only
   * `applyUpdate` does, and only on user action. */
  updateReady: boolean
  /** True after the user has dismissed the banner for this update. The
   * update is still ready and will still apply on the next natural
   * relaunch — dismissing only hides the banner. */
  dismissed: boolean
  /** Installs the downloaded update. On Windows this launches the
   * installer and exits the current process — the installer itself
   * relaunches the app into the new version (`restartAfterInstall`
   * defaults to true). Never called automatically. */
  applyUpdate: () => Promise<void>
  dismissUpdate: () => void
}

/**
 * Checks for an update once on mount and, if one exists, downloads it
 * silently in the background — no progress UI, no prompt. Downloading
 * never installs or restarts the app (see `applyUpdate`). Any failure
 * (offline, unreachable endpoint, bad signature, dropped download) is
 * swallowed: the app just tries again on its next launch.
 */
export function useAppUpdater(): AppUpdaterState {
  const [updateReady, setUpdateReady] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const updateRef = useRef<Update | null>(null)
  const installTriggeredRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    async function run() {
      try {
        const update = await check()
        if (!update || cancelled) return
        updateRef.current = update
        await update.download()
        if (!cancelled) setUpdateReady(true)
      } catch (error) {
        console.error('Échec de la vérification/téléchargement de la mise à jour :', error)
      }
    }
    run()

    return () => {
      cancelled = true
      if (updateRef.current && !installTriggeredRef.current) {
        updateRef.current.close().catch(() => {})
      }
    }
  }, [])

  async function applyUpdate() {
    if (!updateRef.current) return
    installTriggeredRef.current = true
    try {
      await updateRef.current.install()
    } catch (error) {
      console.error('Échec de l’installation de la mise à jour :', error)
    }
  }

  function dismissUpdate() {
    setDismissed(true)
  }

  return { updateReady, dismissed, applyUpdate, dismissUpdate }
}
