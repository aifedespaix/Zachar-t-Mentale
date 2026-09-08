import { useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

/** What the Rust side emits when a second launch hands its file to this one. */
const OPEN_EVENT = 'open-mind-map'

/**
 * Opens the mind map the OS asked the app to open.
 *
 * Two moments, one behaviour. Double-clicking a `.zmap` while the app is
 * closed launches it with the path in `argv`, which `launch_mind_map` reads
 * back. Double-clicking one while it is already running starts a second
 * process that the single-instance plugin folds into this one, forwarding its
 * argv as `open-mind-map`.
 *
 * `openFile` goes through the same guard as the sidebar and drag & drop, so an
 * unsaved map still gets its prompt rather than being switched out from under
 * the user. It is held in a ref: the callback is rebuilt on most renders, and
 * making it an effect dependency would re-run the launch query — reopening the
 * launch file over whatever the user had navigated to since.
 *
 * A no-op outside a Tauri window: `invoke` and `listen` reject there, and a
 * plain browser tab has no command line to read.
 */
export function useLaunchFile(openFile: (path: string) => void): void {
  const openFileRef = useRef(openFile)
  openFileRef.current = openFile

  useEffect(() => {
    let cancelled = false

    invoke<string | null>('launch_mind_map')
      .then(path => {
        if (cancelled || !path) return
        openFileRef.current(path)
      })
      .catch(() => {
        // Not running under Tauri, or the command is unavailable. Launching
        // with no file is the normal case; there is nothing to report.
      })

    const unlisten = listen<string>(OPEN_EVENT, event => {
      openFileRef.current(event.payload)
    })
    unlisten.catch(() => {})

    return () => {
      cancelled = true
      unlisten.then(stop => stop()).catch(() => {})
    }
  }, [])
}
