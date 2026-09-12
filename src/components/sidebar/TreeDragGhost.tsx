import { createPortal } from 'react-dom'
import { FileJson, Folder } from 'lucide-react'
import { useTreeDragStore } from '../../state/useTreeDragStore'
import { lastSegment } from './treeFilter'

/**
 * What follows the cursor during a sidebar drag.
 *
 * Two lines on purpose: the first is the row that is in flight (so a drag that
 * started on a deeply indented file still says what it is carrying), the second
 * says where it would land — the destination folder's name, or a plain refusal
 * when the pointer is not over a valid one. Showing the destination is what
 * makes the gesture answer "où ça va se déposer ?" without the user having to
 * guess from a highlight alone.
 *
 * Portalled to `document.body` and positioned `fixed`: the sidebar scrolls and
 * clips its content, so a ghost rendered inside it would be cut off exactly
 * when the drag reaches the bottom of the list.
 */
export function TreeDragGhost() {
  const source = useTreeDragStore(s => s.source)
  const pointer = useTreeDragStore(s => s.pointer)
  const targetPath = useTreeDragStore(s => s.targetPath)

  if (source === null || pointer === null) return null

  const label = targetPath === null ? 'Déposer sur un dossier' : `Déplacer dans « ${lastSegment(targetPath)} »`

  return createPortal(
    <div
      className="tree-drag-ghost"
      data-testid="tree-drag-ghost"
      data-valid={targetPath !== null}
      style={{ left: pointer.x + 14, top: pointer.y + 14 }}
    >
      <span className="tree-drag-ghost__name">
        {source.kind === 'folder' ? <Folder size={14} /> : <FileJson size={14} />}
        {source.name}
      </span>
      <span className="tree-drag-ghost__target">{label}</span>
    </div>,
    document.body
  )
}
