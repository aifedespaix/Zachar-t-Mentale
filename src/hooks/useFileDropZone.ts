import { useEffect, useState, type RefObject } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'

const INVALID_FILE_MESSAGE = 'Seuls les fichiers .json de carte mentale peuvent être ouverts par glisser-déposer.'

function isInZone(zoneRef: RefObject<HTMLElement | null>, position: { x: number; y: number }): boolean {
  const el = zoneRef.current
  if (!el) return false
  const rect = el.getBoundingClientRect()
  // Tauri reports the drop position in physical pixels; the DOM rect is in
  // logical (CSS) pixels, so it must be scaled back down before comparing.
  const scale = window.devicePixelRatio || 1
  const x = position.x / scale
  const y = position.y / scale
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

/**
 * Opens a `.json` mind map dropped on `zoneRef`. Uses Tauri's window-level
 * drag & drop event (not the DOM `drop` event, which never fires: Tauri
 * intercepts OS file drops before they reach the webview by default) and
 * intersects its physical-pixel position with the zone's own bounding rect,
 * so a drop elsewhere in the window (e.g. the sidebar) is ignored.
 *
 * A no-op outside a Tauri window (`getCurrentWindow()` throws there) — there
 * is nothing to subscribe to in a plain browser tab.
 */
export function useFileDropZone(
  zoneRef: RefObject<HTMLElement | null>,
  onOpenFile: (path: string) => void
): { isDragActive: boolean; dropError: string | null } {
  const [isDragActive, setIsDragActive] = useState(false)
  const [dropError, setDropError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined

    try {
      getCurrentWindow()
        .onDragDropEvent(event => {
          const { payload } = event
          if (payload.type === 'enter' || payload.type === 'over') {
            setIsDragActive(isInZone(zoneRef, payload.position))
            return
          }
          if (payload.type === 'drop') {
            setIsDragActive(false)
            if (!isInZone(zoneRef, payload.position)) return
            const jsonPath = payload.paths.find(p => p.toLowerCase().endsWith('.json'))
            if (jsonPath) {
              setDropError(null)
              onOpenFile(jsonPath)
            } else {
              setDropError(INVALID_FILE_MESSAGE)
            }
            return
          }
          // 'leave'
          setIsDragActive(false)
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
  }, [zoneRef, onOpenFile])

  return { isDragActive, dropError }
}
