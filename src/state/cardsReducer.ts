import type { Card, CardLevel } from '../types/card'
import { canReceiveChildren, isRootCard } from '../types/card'
import type { CardBlock } from '../types/cardBlock'
import { normalizeContent } from '../content/blocks'

export const MAX_LEVEL = 4

export function createRootCard(title = 'Nouveau titre'): Card {
  return { id: crypto.randomUUID(), level: 1, title, parentId: null, order: 0 }
}

/**
 * The bucket a card's `order` is scoped to. Attached cards are ordered inside
 * their sibling group; every detached card shares one implicit group (the
 * floating-cards zone), so their orders stay a single contiguous 0..n-1 run
 * however they got there.
 */
const DETACHED_GROUP = '__detached__'
const ROOT_GROUP = '__root__'

function groupKeyOf(card: Card): string {
  if (card.detached) return DETACHED_GROUP
  return card.parentId ?? ROOT_GROUP
}

/**
 * Re-numbers every group's `order` to a contiguous 0..n-1 run, preserving the
 * current relative order (so a fractional or out-of-range order assigned by a
 * caller lands exactly where it sorts). Cards whose order is already correct
 * are returned by identity, and array positions are never shuffled — undo
 * snapshots share the untouched objects.
 */
function normalizeOrders(cards: Card[]): Card[] {
  const groups = new Map<string, Card[]>()
  for (const card of cards) {
    const key = groupKeyOf(card)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(card)
  }
  const orderById = new Map<string, number>()
  for (const group of groups.values()) {
    ;[...group]
      .sort((a, b) => a.order - b.order)
      .forEach((card, index) => orderById.set(card.id, index))
  }
  return cards.map(card => {
    const order = orderById.get(card.id)!
    return card.order === order ? card : { ...card, order }
  })
}

function nextDetachedOrder(cards: Card[]): number {
  const orders = cards.filter(c => c.detached).map(c => c.order)
  return orders.length === 0 ? 0 : Math.max(...orders) + 1
}

/** Turns a card into a floating one: out of the hierarchy, no parent, no children. */
function toDetached(card: Card, order: number): Card {
  return { ...card, parentId: null, detached: true, order }
}

/** Puts a (possibly floating) card back into the hierarchy under `parentId`. */
function toAttached(card: Card, parentId: string, level: CardLevel, order: number): Card {
  const next: Card = { ...card, parentId, level, order }
  delete next.detached
  return next
}

export function addChild(cards: Card[], parentId: string): { cards: Card[]; newCardId: string } {
  const parent = cards.find(c => c.id === parentId)
  if (!parent) throw new Error(`addChild: parent ${parentId} not found`)
  if (parent.detached) throw new Error('addChild: detached cards cannot have children')
  if (parent.level === MAX_LEVEL) throw new Error('addChild: level 4 cards cannot have children')
  const childLevel = (parent.level + 1) as CardLevel
  const siblings = cards.filter(c => c.parentId === parentId)
  const newCard: Card = {
    id: crypto.randomUUID(),
    level: childLevel,
    title: 'Nouveau titre',
    parentId,
    order: siblings.length,
  }
  return { cards: [...cards, newCard], newCardId: newCard.id }
}

export function addSibling(
  cards: Card[],
  siblingId: string,
  position: 'above' | 'below'
): { cards: Card[]; newCardId: string } {
  const reference = cards.find(c => c.id === siblingId)
  if (!reference) throw new Error(`addSibling: card ${siblingId} not found`)
  if (reference.detached) throw new Error('addSibling: detached cards have no sibling group')
  if (reference.parentId === null) {
    throw new Error('addSibling: cannot add a sibling to the root card (single-root invariant)')
  }
  const group = cards.filter(c => c.parentId === reference.parentId).sort((a, b) => a.order - b.order)
  const refIndex = group.findIndex(c => c.id === siblingId)
  const insertAt = position === 'above' ? refIndex : refIndex + 1
  const newCard: Card = {
    id: crypto.randomUUID(),
    level: reference.level,
    title: 'Nouveau titre',
    parentId: reference.parentId,
    order: 0,
  }
  const newGroup = [...group.slice(0, insertAt), newCard, ...group.slice(insertAt)].map((c, i) => ({
    ...c,
    order: i,
  }))
  const otherCards = cards.filter(c => c.parentId !== reference.parentId)
  return { cards: [...otherCards, ...newGroup], newCardId: newCard.id }
}

export function updateTitle(cards: Card[], cardId: string, title: string): Card[] {
  return cards.map(c => (c.id === cardId ? { ...c, title } : c))
}

/**
 * The ONE place `content` and `definition` are written, always together.
 *
 * `definition` is the plain-text mirror every other consumer reads — the
 * quiz's distractor pools and hints, the XMind `notes.plain.content`,
 * `salvage()`. Deriving it here, from the same blocks in the same call, is what
 * makes it impossible for the two fields to disagree. `normalizeContent` also
 * decides whether `content` is needed at all: an all-text definition is stored
 * as `definition` alone, so a plain card never acquires a `content` array just
 * by passing through the editor.
 *
 * Both fields are DELETED rather than set to `undefined`, so a card that lost
 * its definition serializes without the key — as it did before this existed.
 */
export function updateContent(cards: Card[], cardId: string, blocks: CardBlock[]): Card[] {
  const { content, definition } = normalizeContent(blocks)
  let changed = false
  const next = cards.map(card => {
    if (card.id !== cardId) return card
    // Opening the editor and closing it unchanged must not cost the user an
    // undo step, and neither must a write aimed at a card that is not there.
    if (card.definition === definition && JSON.stringify(card.content) === JSON.stringify(content)) return card
    changed = true
    const updated: Card = { ...card }
    if (content === undefined) delete updated.content
    else updated.content = content
    if (definition === undefined) delete updated.definition
    else updated.definition = definition
    return updated
  })
  // Same reference when nothing moved, so the store can skip the history push.
  return changed ? next : cards
}

/**
 * Plain-text definition write, expressed in terms of `updateContent` so it
 * cannot bypass the single-writer rule. Routing it this way is what clears a
 * stale `content` when a rich definition is replaced by plain text — otherwise
 * the card would go on rendering its old formula while `definition` said
 * something else.
 */
export function updateDefinition(cards: Card[], cardId: string, definition: string | undefined): Card[] {
  return updateContent(cards, cardId, definition === undefined ? [] : [{ kind: 'text', text: definition }])
}

export function hasChildren(cards: Card[], cardId: string): boolean {
  return cards.some(c => c.parentId === cardId)
}

export function countDescendants(cards: Card[], cardId: string): number {
  const children = cards.filter(c => c.parentId === cardId)
  return children.reduce((sum, child) => sum + 1 + countDescendants(cards, child.id), 0)
}

/**
 * Every card of the branch rooted at `cardId` (the card itself included),
 * mapped to its depth RELATIVE to that card (0 for the card, 1 for its
 * children...). Breadth-first, so iteration order is parents before children —
 * which is the order newly detached cards are parked in the floating zone.
 */
export function subtreeDepths(cards: Card[], cardId: string): Map<string, number> {
  const depths = new Map<string, number>([[cardId, 0]])
  const queue: string[] = [cardId]
  while (queue.length > 0) {
    const currentId = queue.shift()!
    const depth = depths.get(currentId)!
    for (const child of cards.filter(c => c.parentId === currentId).sort((a, b) => a.order - b.order)) {
      if (depths.has(child.id)) continue // defensive: a corrupt file could hold a cycle
      depths.set(child.id, depth + 1)
      queue.push(child.id)
    }
  }
  return depths
}

/** Number of cards a "flatten this branch" action would turn into floating cards (the card included). */
export function flattenedCardCount(cards: Card[], cardId: string): number {
  return subtreeDepths(cards, cardId).size
}

export function isDescendantOf(cards: Card[], ancestorId: string, cardId: string): boolean {
  return cardId !== ancestorId && subtreeDepths(cards, ancestorId).has(cardId)
}

/**
 * Whether `cardId` may be dropped onto `newParentId` at all — the checks
 * `moveCard` throws on, minus the depth overflow (which is allowed, at the
 * price of detaching the cards that fall past level 4). Reused by the canvas
 * to decide whether a hovered card lights up as a reparent target.
 */
export function canMoveCardTo(cards: Card[], cardId: string, newParentId: string): boolean {
  const target = cards.find(c => c.id === cardId)
  const newParent = cards.find(c => c.id === newParentId)
  if (!target || !newParent) return false
  if (isRootCard(target)) return false
  if (cardId === newParentId) return false
  if (!canReceiveChildren(newParent)) return false
  return !isDescendantOf(cards, cardId, newParentId)
}

/**
 * How many cards of the moved branch would land past level 4 — i.e. how many
 * would be turned into floating cards by this move. 0 means the move fits
 * inside the 4-level limit and needs no confirmation.
 */
export function overflowingCardCount(cards: Card[], cardId: string, newParentId: string): number {
  if (!canMoveCardTo(cards, cardId, newParentId)) return 0
  const newParent = cards.find(c => c.id === newParentId)!
  const baseLevel = newParent.level + 1
  let count = 0
  for (const depth of subtreeDepths(cards, cardId).values()) {
    if (baseLevel + depth > MAX_LEVEL) count += 1
  }
  return count
}

/**
 * Removes the card together with its whole branch.
 *
 * The root is the one exception (single-root invariant): it always survives, so
 * "delete the root" means "empty it" — its descendants go, the root stays. The
 * UI says as much before asking.
 */
export function deleteCard(cards: Card[], cardId: string): Card[] {
  const target = cards.find(c => c.id === cardId)
  if (!target) throw new Error(`deleteCard: card ${cardId} not found`)

  const branch = subtreeDepths(cards, cardId)
  const toDelete = new Set(branch.keys())
  if (isRootCard(target)) toDelete.delete(cardId)
  return normalizeOrders(cards.filter(c => !toDelete.has(c.id)))
}

/**
 * Removes the card but KEEPS everything under it: each descendant is flattened
 * into a floating card instead of being deleted with its parent — the "détacher
 * les enfants" branch of the delete dialog, for when the card itself is wrong
 * but its content is still worth keeping around.
 *
 * On the root (which is never removed) this just empties the hierarchy into the
 * floating zone.
 */
export function deleteCardDetachingChildren(cards: Card[], cardId: string): Card[] {
  const target = cards.find(c => c.id === cardId)
  if (!target) throw new Error(`deleteCardDetachingChildren: card ${cardId} not found`)

  const descendantIds = [...subtreeDepths(cards, cardId).keys()].filter(id => id !== cardId)
  let detachedOrder = nextDetachedOrder(cards)
  const detachedOrderById = new Map(descendantIds.map(id => [id, detachedOrder++]))
  const remaining = isRootCard(target) ? cards : cards.filter(c => c.id !== cardId)
  const patched = remaining.map(card =>
    detachedOrderById.has(card.id) ? toDetached(card, detachedOrderById.get(card.id)!) : card
  )
  return normalizeOrders(patched)
}

/**
 * Moves `cardId` under `newParentId`, inserted at `index` among its new
 * siblings (default: last). Unlike the original level-preserving reparent, the
 * new parent may sit at ANY level: the moved branch's levels are recomputed
 * from it, and every card that would land past level 4 is detached into the
 * floating zone instead — flattened, since floating cards have no children.
 * Cycles are ruled out explicitly (`canMoveCardTo`), as a lower-level parent no
 * longer implies "not one of my descendants".
 *
 * Returns the detached ids alongside the new cards so callers can report what
 * the move cost; `overflowingCardCount` predicts that count before committing.
 */
export interface MoveOutcome {
  cards: Card[]
  detachedIds: string[]
}

export function moveCard(
  cards: Card[],
  cardId: string,
  newParentId: string,
  index?: number
): MoveOutcome {
  const target = cards.find(c => c.id === cardId)
  if (!target) throw new Error(`moveCard: card ${cardId} not found`)
  if (isRootCard(target)) {
    throw new Error('moveCard: cannot move the root card (single-root invariant)')
  }
  const newParent = cards.find(c => c.id === newParentId)
  if (!newParent) throw new Error(`moveCard: new parent ${newParentId} not found`)
  if (cardId === newParentId) throw new Error('moveCard: a card cannot be its own parent')
  if (!canReceiveChildren(newParent)) {
    throw new Error(
      `moveCard: ${newParent.detached ? 'a detached card' : 'a level-4 card'} cannot receive children`
    )
  }
  if (isDescendantOf(cards, cardId, newParentId)) {
    throw new Error('moveCard: cannot move a card under one of its own descendants (cycle)')
  }

  const depths = subtreeDepths(cards, cardId)
  const baseLevel = newParent.level + 1
  const detachedIds = [...depths.entries()]
    .filter(([, depth]) => baseLevel + depth > MAX_LEVEL)
    .map(([id]) => id)

  let detachedOrder = nextDetachedOrder(cards)
  const detachedOrderById = new Map(detachedIds.map(id => [id, detachedOrder++]))

  // Levels first: the moved card and every descendant that still fits get
  // re-levelled from the new parent, the rest become floating cards.
  const relevelled = cards.map(card => {
    const depth = depths.get(card.id)
    if (depth === undefined) return card
    if (detachedOrderById.has(card.id)) return toDetached(card, detachedOrderById.get(card.id)!)
    const level = (baseLevel + depth) as CardLevel
    // Only the moved card itself changes parent; its descendants keep theirs.
    if (card.id === cardId) return toAttached(card, newParentId, level, card.order)
    return card.level === level ? card : { ...card, level }
  })

  // Then the new sibling group's ordering, rebuilt explicitly so the moved card
  // lands exactly at `index` (past-the-end and negative indices are clamped).
  const movedCard = relevelled.find(c => c.id === cardId)!
  const newSiblings = relevelled
    .filter(c => c.id !== cardId && c.parentId === newParentId && !c.detached)
    .sort((a, b) => a.order - b.order)
  const insertAt = Math.max(0, Math.min(index ?? newSiblings.length, newSiblings.length))
  const orderInGroup = new Map(
    [...newSiblings.slice(0, insertAt), movedCard, ...newSiblings.slice(insertAt)].map((c, i) => [c.id, i])
  )
  const reordered = relevelled.map(card => {
    const order = orderInGroup.get(card.id)
    return order === undefined || card.order === order ? card : { ...card, order }
  })

  // `normalizeOrders` closes the gap the card left in its old sibling group and
  // packs the floating zone (whose newcomers were parked past its last order).
  return { cards: normalizeOrders(reordered), detachedIds }
}

/**
 * Backwards-compatible reparent helper: appends the card at the end of the new
 * parent's children. A no-op when it is already that parent's child (moving a
 * card onto the parent it already has must not silently reorder it).
 */
export function moveCardToParent(cards: Card[], cardId: string, newParentId: string): Card[] {
  const target = cards.find(c => c.id === cardId)
  if (target && !target.detached && target.parentId === newParentId) return cards
  return moveCard(cards, cardId, newParentId).cards
}

/**
 * Detaches a whole branch into the floating zone: the card AND all of its
 * descendants become individual floating cards (flattened — floating cards
 * cannot have children). `flattenedCardCount` predicts how many that is.
 */
export function detachCard(cards: Card[], cardId: string): Card[] {
  const target = cards.find(c => c.id === cardId)
  if (!target) throw new Error(`detachCard: card ${cardId} not found`)
  if (isRootCard(target)) {
    throw new Error('detachCard: cannot detach the root card (single-root invariant)')
  }
  if (target.detached) return cards

  const depths = subtreeDepths(cards, cardId)
  let detachedOrder = nextDetachedOrder(cards)
  const detachedOrderById = new Map([...depths.keys()].map(id => [id, detachedOrder++]))
  const patched = cards.map(card =>
    detachedOrderById.has(card.id) ? toDetached(card, detachedOrderById.get(card.id)!) : card
  )
  return normalizeOrders(patched)
}

export function moveCardToIndex(cards: Card[], cardId: string, newIndex: number): Card[] {
  const target = cards.find(c => c.id === cardId)
  if (!target) throw new Error(`moveCardToIndex: card ${cardId} not found`)

  const groupKey = groupKeyOf(target)
  const group = cards.filter(c => groupKeyOf(c) === groupKey).sort((a, b) => a.order - b.order)
  const currentIndex = group.findIndex(c => c.id === cardId)
  const clampedIndex = Math.max(0, Math.min(newIndex, group.length - 1))

  const [moved] = group.splice(currentIndex, 1)
  group.splice(clampedIndex, 0, moved)
  const reindexed = group.map((c, i) => ({ ...c, order: i }))

  const others = cards.filter(c => groupKeyOf(c) !== groupKey)
  return [...others, ...reindexed]
}
