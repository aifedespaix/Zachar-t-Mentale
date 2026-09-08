import { useEffect, useState, type RefObject } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'

const INVALID_FILE_MESSAGE =
  'Seuls les fichiers .json de carte mentale et les images peuvent être déposés ici.'

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.svg']

function isImagePath(path: string): boolean {
  const lower = path.toLowerCase()
  return IMAGE_EXTENSIONS.some(extension => lower.endsWith(extension))
}

/**
 * The card under a drop point, or `null`.
 *
 * Dropping a picture ONTO a card is the gesture that needs no explanation —
 * far better than requiring the definition popover to be open first. The
 * position arrives in physical pixels like every other coordinate here, so it
 * is scaled before being handed to `elementFromPoint`.
 */
function cardIdAtPoint(position: { x: number; y: number }): string | null {
  // Guarded rather than assumed: `elementFromPoint` is standard in the Tauri
  // webviews but absent from some non-browser DOM implementations, and this
  // runs inside an event handler where a throw would be swallowed silently.
  if (typeof document.elementFromPoint !== 'function') return null

  const scale = window.devicePixelRatio || 1
  const element = document.elementFromPoint(position.x / scale, position.y / scale)
  const card = element?.closest('[data-testid^="card-"]')
  const testId = card?.getAttribute('data-testid')
  return testId ? testId.slice('card-'.length) : null
}

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
  onOpenFile: (path: string) => void,
  /**
   * Called when an image file is dropped onto a card. Absent when the host
   * cannot store images — the drop is then reported as an unsupported file
   * rather than silently ignored.
   */
  onDropImageOnCard?: (cardId: string, path: string) => void
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

            // A mind map opens; an image joins the card it landed on. Routing
            // by extension rather than refusing everything but `.json` is what
            // lets one window-level event serve both gestures.
            const jsonPath = payload.paths.find(path => path.toLowerCase().endsWith('.json'))
            if (jsonPath) {
              setDropError(null)
              onOpenFile(jsonPath)
              return
            }

            const imagePath = payload.paths.find(isImagePath)
            if (imagePath !== undefined && onDropImageOnCard !== undefined) {
              const cardId = cardIdAtPoint(payload.position)
              if (cardId !== null) {
                setDropError(null)
                onDropImageOnCard(cardId, imagePath)
                return
              }
              setDropError('Dépose l’image sur une carte pour l’ajouter à sa définition.')
              return
            }

            setDropError(INVALID_FILE_MESSAGE)
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
  }, [zoneRef, onOpenFile, onDropImageOnCard])

  return { isDragActive, dropError }
}
