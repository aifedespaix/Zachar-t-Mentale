import type { CardBlock } from '../types/cardBlock'
import { blocksDiffer } from './blocks'

/**
 * The description editor's own undo/redo — separate from the app's global
 * document history (`src/state/history.ts`).
 *
 * The global history holds one step per autosave, coarse by design: it is
 * what "undo" means for the document as a whole, interleaved with every other
 * kind of edit. Inside a single description, a student wants something finer
 * — undo the last few characters or the block they just deleted, the way any
 * text editor works — without walking back through unrelated changes made
 * elsewhere in the map.
 *
 * Keyed by card id, kept at module scope rather than in the dialog's own
 * React state: the dialog remounts every time it opens on a different card —
 * closing it, or the new "jump to the parent/a sibling" navigation, both do
 * that by design (see `DescriptionDialog`) — and the whole point of "its own
 * history" is that it survives leaving and coming back within the same app
 * session. It does not survive a reload; that is what the global history and
 * the file on disk are for.
 */
interface Entry {
  stack: CardBlock[][]
  index: number
}

const MAX_DEPTH = 100

const entries = new Map<string, Entry>()

function entryFor(cardId: string, initial: CardBlock[]): Entry {
  let entry = entries.get(cardId)
  if (entry === undefined) {
    entry = { stack: [initial], index: 0 }
    entries.set(cardId, entry)
  }
  return entry
}

/** Starts (or resumes) a card's history at `initial` — call once when the dialog opens. */
export function ensureDescriptionHistory(cardId: string, initial: CardBlock[]): void {
  entryFor(cardId, initial)
}

/** Records a new state, dropping any redo tail — a no-op if nothing actually changed. */
export function recordDescriptionState(cardId: string, blocks: CardBlock[]): void {
  const entry = entryFor(cardId, blocks)
  if (!blocksDiffer(entry.stack[entry.index], blocks)) return
  entry.stack = entry.stack.slice(0, entry.index + 1)
  entry.stack.push(blocks)
  entry.index += 1
  if (entry.stack.length > MAX_DEPTH) {
    entry.stack.shift()
    entry.index -= 1
  }
}

/** The previous state, or `null` when there is nothing to undo to. */
export function undoDescription(cardId: string): CardBlock[] | null {
  const entry = entries.get(cardId)
  if (entry === undefined || entry.index <= 0) return null
  entry.index -= 1
  return entry.stack[entry.index]
}

/** The next state, or `null` when there is nothing to redo. */
export function redoDescription(cardId: string): CardBlock[] | null {
  const entry = entries.get(cardId)
  if (entry === undefined || entry.index >= entry.stack.length - 1) return null
  entry.index += 1
  return entry.stack[entry.index]
}
