import type { CardBlock } from './cardBlock'

export type CardLevel = 1 | 2 | 3 | 4

export type CardKind = 'definition' | 'media'

export type UserRole = 'eleve' | 'prof'

/**
 * Present only once a `.zmap` has been synced at least once. `null` (the
 * field is simply absent from the file) is the normal, permanent state for
 * anyone who never uses sync — the file stays a bare array on disk and stays
 * fully editable locally forever.
 */
export interface MindMapMeta {
  id: string
  author: string
  role: UserRole
  lastModified: string
}

/**
 * Who is signed in. `username` is what owns files (`meta.author`), `role` is
 * what decides who may rearrange them — a prof may move, rename and delete
 * anyone's map; an eleve only their own. The role never grants the right to
 * write someone else's CONTENT.
 */
export interface SyncUser {
  username: string
  role: UserRole
}

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
  /**
   * Absent means `'definition'` — every card written before this field
   * existed keeps behaving exactly as it does today, no migration needed.
   * `'media'` tells the quiz not to treat this card's `definition` mirror as
   * a real definition to recognise from its title (see `quizReducer.ts`).
   */
  kind?: CardKind
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
