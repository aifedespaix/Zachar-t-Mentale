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

export function nextDetachedOrder(cards: Card[]): number {
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

/**
 * Creates a brand-new floating card, out of the hierarchy from the start.
 * Lands in the floating-cards zone's layout at whatever slot
 * `nextDetachedOrder` computes — no position math needed here, the grid
 * layout places every detached card the same way regardless of how it
 * became detached.
 */
export function addFloatingCard(cards: Card[]): { cards: Card[]; newCardId: string } {
  const newCard: Card = {
    id: crypto.randomUUID(),
    level: 1,
    title: 'Nouveau titre',
    parentId: null,
    detached: true,
    order: nextDetachedOrder(cards),
  }
  return { cards: [...cards, newCard], newCardId: newCard.id }
}

export function updateTitle(cards: Card[], cardId: string, title: string): Card[] {
  return cards.map(c => (c.id === cardId ? { ...c, title } : c))
}

/**
 * Sets (or, with `undefined`, clears) a card's mnemonic icon.
 *
 * Clearing DELETES the key rather than writing `undefined`, so a card that
 * lost its icon serializes exactly as it did before icons existed — the same
 * contract `updateContent` follows for `definition`/`content`. A write that
 * changes nothing returns the array by identity so the caller can skip
 * spending an undo step on it.
 */
export function updateIcon(cards: Card[], cardId: string, icon: string | undefined): Card[] {
  let changed = false
  const next = cards.map(card => {
    if (card.id !== cardId || card.icon === icon) return card
    changed = true
    if (icon === undefined) {
      const { icon: _removed, ...rest } = card
      return rest
    }
    return { ...card, icon }
  })
  return changed ? next : cards
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

/**
 * The titles of a card's ancestors, root first, excluding the card itself.
 *
 * Used as the breadcrumb of the description editor, whose whole job is to make
 * "which card am I editing?" unambiguous when it opens over a canvas of
 * near-identical boxes.
 *
 * Walks up rather than down, with a `seen` guard for the same reason
 * `computeLayout` carries one: a `.zmap` may have been shared or hand-edited,
 * and a parent cycle would spin here forever. A detached card has no ancestry
 * to show — its `parentId` is null like the root's — so it yields an empty
 * chain rather than a misleading one.
 */
export function ancestorTitles(cards: Card[], cardId: string): string[] {
  const byId = new Map(cards.map(card => [card.id, card]))
  const titles: string[] = []
  const seen = new Set<string>([cardId])

  let parentId = byId.get(cardId)?.parentId ?? null
  while (parentId !== null && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = byId.get(parentId)
    if (parent === undefined) break
    titles.push(parent.title)
    parentId = parent.parentId
  }
  return titles.reverse()
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

/**
 * A branch lifted out of a mind map: the card, its descendants, and nothing
 * else. Ids are the ones the cards had when it was taken — `pasteBranch`
 * re-issues them, so the same branch can be pasted any number of times, into
 * the map it came from, without two cards ever sharing an id.
 */
export interface CardBranch {
  /** Breadth-first, the branch's own root first. */
  cards: Card[]
  rootId: string
}

/** The branch rooted at `cardId`, deep-copied, or `null` when there is no such card. */
export function extractBranch(cards: Card[], cardId: string): CardBranch | null {
  if (!cards.some(card => card.id === cardId)) return null
  const byId = new Map(cards.map(card => [card.id, card]))
  const branch = [...subtreeDepths(cards, cardId).keys()]
    .map(id => byId.get(id))
    .filter((card): card is Card => card !== undefined)
  return { cards: structuredClone(branch), rootId: cardId }
}

/** Depth of every card of a standalone branch, relative to its root. */
function branchDepths(branch: CardBranch): Map<string, number> {
  const depths = new Map<string, number>([[branch.rootId, 0]])
  // The branch is stored breadth-first, so one forward pass is enough: a
  // card's parent has always been visited before the card itself.
  for (const card of branch.cards) {
    if (card.id === branch.rootId) continue
    const parentDepth = card.parentId === null ? undefined : depths.get(card.parentId)
    if (parentDepth === undefined) continue
    depths.set(card.id, parentDepth + 1)
  }
  return depths
}

export interface PasteOutcome {
  cards: Card[]
  /** The pasted copy's root — what the canvas selects and scrolls to. */
  newCardId: string
  /** Copies that fell past level 4 and became floating cards instead. */
  detachedIds: string[]
}

/**
 * Pastes a copy of `branch` under `parentId`, at `index` among that parent's
 * children (appended when omitted).
 *
 * `parentId: null` pastes into the floating-cards zone, where the branch is
 * flattened — floating cards may not have children. The same flattening
 * catches copies that would land past level 4, exactly as `moveCard` does for
 * a drag: the cards are kept as floating cards rather than silently dropped,
 * and `detachedIds` says how many, so a caller can tell the user.
 */
export function pasteBranch(
  cards: Card[],
  branch: CardBranch,
  parentId: string | null,
  index?: number
): PasteOutcome {
  if (branch.cards.length === 0) throw new Error('pasteBranch: the branch is empty')

  let parent: Card | null = null
  if (parentId !== null) {
    const found = cards.find(card => card.id === parentId)
    if (found === undefined) throw new Error(`pasteBranch: parent ${parentId} not found`)
    parent = found
  }
  if (parent !== null && !canReceiveChildren(parent)) {
    throw new Error(
      `pasteBranch: ${parent.detached ? 'a detached card' : 'a level-4 card'} cannot receive children`
    )
  }

  const depths = branchDepths(branch)
  const newIdByOldId = new Map(branch.cards.map(card => [card.id, crypto.randomUUID()]))
  const baseLevel = parent === null ? 1 : parent.level + 1
  let detachedOrder = nextDetachedOrder(cards)
  const detachedIds: string[] = []
  const detached = new Set<string>()

  // Breadth-first, so a card is always decided after its parent — which is
  // what lets the "my parent became a floating card" case below be a lookup
  // rather than a second pass.
  const copies = branch.cards.map(card => {
    const id = newIdByOldId.get(card.id)!
    const depth = depths.get(card.id) ?? 0
    const copy: Card = { ...structuredClone(card), id }
    const newParentId = card.id === branch.rootId ? parent?.id : newIdByOldId.get(card.parentId ?? '')
    const overflows = parent === null || baseLevel + depth > MAX_LEVEL
    if (overflows || newParentId === undefined || detached.has(newParentId)) {
      detachedIds.push(id)
      detached.add(id)
      return toDetached(copy, detachedOrder++)
    }
    return toAttached(copy, newParentId, (baseLevel + depth) as CardLevel, copy.order)
  })

  const newRootId = newIdByOldId.get(branch.rootId)!
  const withCopies = [...cards, ...copies]

  // The pasted root only takes a slot in the sibling group when it actually
  // joined one — a branch pasted into the floating zone has no group to be
  // ordered inside, `normalizeOrders` packs that zone on its own.
  if (parent === null || detachedIds.includes(newRootId)) {
    return { cards: normalizeOrders(withCopies), newCardId: newRootId, detachedIds }
  }

  const siblings = withCopies
    .filter(card => card.id !== newRootId && card.parentId === parent.id && !card.detached)
    .sort((a, b) => a.order - b.order)
  const insertAt = Math.max(0, Math.min(index ?? siblings.length, siblings.length))
  const root = withCopies.find(card => card.id === newRootId)!
  const orderInGroup = new Map(
    [...siblings.slice(0, insertAt), root, ...siblings.slice(insertAt)].map((card, i) => [card.id, i])
  )
  const reordered = withCopies.map(card => {
    const order = orderInGroup.get(card.id)
    return order === undefined || card.order === order ? card : { ...card, order }
  })
  return { cards: normalizeOrders(reordered), newCardId: newRootId, detachedIds }
}

/**
 * Copies a branch in place: the duplicate lands right after the original,
 * among the same siblings — which is what « Dupliquer » means everywhere else.
 *
 * The root card is refused rather than special-cased: a second root would
 * break the single-root invariant, and pasting the whole map into itself as a
 * floating pile is not what anyone means by duplicating a chapter.
 */
export function duplicateCard(cards: Card[], cardId: string): PasteOutcome {
  const target = cards.find(card => card.id === cardId)
  if (!target) throw new Error(`duplicateCard: card ${cardId} not found`)
  if (isRootCard(target)) throw new Error('duplicateCard: the root card cannot be duplicated')

  const branch = extractBranch(cards, cardId)!
  if (target.detached) return pasteBranch(cards, branch, null)

  const siblings = cards
    .filter(card => card.parentId === target.parentId && !card.detached)
    .sort((a, b) => a.order - b.order)
  const position = siblings.findIndex(card => card.id === cardId)
  return pasteBranch(cards, branch, target.parentId!, position + 1)
}

/**
 * A branch as an indented plain-text outline, for the system clipboard.
 *
 * The point is getting revision notes OUT of the app — into a message, a
 * document, a printout — without an export dialog and without a file. Titles
 * become the list; a card's definition follows it, indented one level further,
 * so the shape of the outline survives the paste.
 */
export function branchToText(cards: Card[], cardId: string): string {
  const lines: string[] = []

  function walk(id: string, depth: number) {
    const card = cards.find(entry => entry.id === id)
    if (!card) return
    const indent = '  '.repeat(depth)
    lines.push(`${indent}- ${card.title}`)
    const definition = card.definition?.trim()
    if (definition) {
      for (const line of definition.split('\n')) lines.push(`${indent}  ${line}`)
    }
    const children = cards.filter(entry => entry.parentId === id && !entry.detached).sort((a, b) => a.order - b.order)
    for (const child of children) walk(child.id, depth + 1)
  }

  walk(cardId, 0)
  return lines.join('\n')
}

/**
 * The index of a card among its own sibling group (or among the floating
 * cards). `-1` when the card does not exist.
 */
export function siblingIndexOf(cards: Card[], cardId: string): number {
  const target = cards.find(card => card.id === cardId)
  if (!target) return -1
  const key = groupKeyOf(target)
  return cards
    .filter(card => groupKeyOf(card) === key)
    .sort((a, b) => a.order - b.order)
    .findIndex(card => card.id === cardId)
}

/** The cards of `cardId`'s own sibling group, in display order. */
export function siblingsOf(cards: Card[], cardId: string): Card[] {
  const target = cards.find(card => card.id === cardId)
  if (!target) return []
  const key = groupKeyOf(target)
  return cards.filter(card => groupKeyOf(card) === key).sort((a, b) => a.order - b.order)
}

/** A card's children, in display order — the order arrow-key navigation walks. */
export function childrenOf(cards: Card[], cardId: string): Card[] {
  return cards.filter(card => card.parentId === cardId && !card.detached).sort((a, b) => a.order - b.order)
}
