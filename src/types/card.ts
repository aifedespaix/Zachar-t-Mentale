import type { CardBlock } from './cardBlock'

export type CardLevel = 1 | 2 | 3 | 4

export interface Card {
  id: string
  level: CardLevel
  title: string
  /**
   * The definition as plain text. Stays the field every consumer reads — the
   * quiz's distractor pools and hints, the XMind `notes.plain.content`,
   * `salvage()` — whether or not the card also has `content`.
   *
   * When `content` is present this is its DERIVED mirror, never typed by hand:
   * `updateContent` recomputes it through `blocksToPlainText` on every write,
   * so the two cannot disagree.
   */
  definition?: string
  /**
   * Rich content, when the definition is more than plain text. Absent for a
   * plain-text card — including one that was just re-saved through the block
   * editor (see `normalizeContent`), so existing files do not churn.
   */
  content?: CardBlock[]
  parentId: string | null
  order: number
  /**
   * A "carte volante" (floating/draft card): detached from the hierarchy and
   * parked in its own zone of the canvas. Detached cards have `parentId: null`
   * — like the root — and may NOT have children: they are a scratch area, not
   * a second tree. Their `level` is vestigial (the level they last had before
   * being detached); nothing renders or lays them out by it, and re-attaching
   * one recomputes it from its new parent.
   */
  detached?: boolean
  /**
   * A picture hook for the card, as a Lucide icon name in PascalCase
   * (`'Atom'`, `'BookOpen'`, ...). Purely mnemonic — nothing in the layout,
   * the quiz or the export depends on it — so an unknown name (a card written
   * by a later version of the app, or a hand-edited file) renders as no icon
   * at all rather than breaking the card. See `src/content/icons.ts`.
   */
  icon?: string
}

/**
 * The single hierarchy root. `parentId === null` alone is NOT enough: detached
 * cards share that shape, so every "is this the untouchable root?" check has to
 * exclude them (otherwise a floating card would inherit the root's protections
 * — undeletable, unmovable — instead of behaving like the draft it is).
 */
export function isRootCard(card: Card): boolean {
  return card.parentId === null && !card.detached
}

/** Level-4 cards have nowhere to put a level-5 child; detached cards may never have children at all. */
export function canReceiveChildren(card: Card): boolean {
  return !card.detached && card.level < 4
}
