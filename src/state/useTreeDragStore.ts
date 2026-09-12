import { create } from 'zustand'

/** The row in flight: what the ghost shows and what the drop validation needs. */
export interface TreeDragSource {
  path: string
  /** What the row already displays — extension stripped when unreadable files are hidden. */
  name: string
  kind: 'folder' | 'mindmap'
}

export interface TreeDragPointer {
  x: number
  y: number
}

interface TreeDragState {
  /** The row being dragged, or `null` when no drag is in progress. */
  source: TreeDragSource | null
  /** Cursor position in client pixels, for the floating ghost. */
  pointer: TreeDragPointer | null
  /** The folder that would receive the drop, or `null` when there is no valid one. */
  targetPath: string | null
  begin: (source: TreeDragSource, pointer: TreeDragPointer) => void
  movePointer: (pointer: TreeDragPointer) => void
  setTarget: (targetPath: string | null) => void
  end: () => void
}

/**
 * The sidebar's drag & drop, as state — deliberately NOT React context: a row
 * subscribes to the two booleans it needs (`is this row in flight?`, `is it the
 * target?`), so a pointer move re-renders the ghost alone rather than the whole
 * tree, however many rows are on screen.
 */
export const useTreeDragStore = create<TreeDragState>(set => ({
  source: null,
  pointer: null,
  targetPath: null,
  begin: (source, pointer) => set({ source, pointer, targetPath: null }),
  movePointer: pointer => set({ pointer }),
  setTarget: targetPath => set(state => (state.targetPath === targetPath ? state : { targetPath })),
  end: () => set({ source: null, pointer: null, targetPath: null }),
}))
