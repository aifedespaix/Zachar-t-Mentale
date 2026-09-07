export type CardLevel = 1 | 2 | 3 | 4

export interface Card {
  id: string
  level: CardLevel
  title: string
  definition?: string
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
