import type { Card, CardLevel } from '../types/card'

export function createRootCard(title = 'Nouveau titre'): Card {
  return { id: crypto.randomUUID(), level: 1, title, parentId: null, order: 0 }
}

export function addChild(cards: Card[], parentId: string): { cards: Card[]; newCardId: string } {
  const parent = cards.find(c => c.id === parentId)
  if (!parent) throw new Error(`addChild: parent ${parentId} not found`)
  if (parent.level === 4) throw new Error('addChild: level 4 cards cannot have children')
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

export function updateDefinition(cards: Card[], cardId: string, definition: string | undefined): Card[] {
  return cards.map(c => (c.id === cardId ? { ...c, definition } : c))
}

export function hasChildren(cards: Card[], cardId: string): boolean {
  return cards.some(c => c.parentId === cardId)
}

export function countDescendants(cards: Card[], cardId: string): number {
  const children = cards.filter(c => c.parentId === cardId)
  return children.reduce((sum, child) => sum + 1 + countDescendants(cards, child.id), 0)
}

export function deleteCard(cards: Card[], cardId: string): Card[] {
  const target = cards.find(c => c.id === cardId)
  if (!target) throw new Error(`deleteCard: card ${cardId} not found`)
  if (target.parentId === null) {
    throw new Error('deleteCard: cannot delete the root card (single-root invariant)')
  }

  const toDelete = new Set<string>([cardId])
  let added = true
  while (added) {
    added = false
    for (const c of cards) {
      if (c.parentId && toDelete.has(c.parentId) && !toDelete.has(c.id)) {
        toDelete.add(c.id)
        added = true
      }
    }
  }

  const remaining = cards.filter(c => !toDelete.has(c.id))
  const siblings = remaining
    .filter(c => c.parentId === target.parentId)
    .sort((a, b) => a.order - b.order)
    .map((c, i) => ({ ...c, order: i }))
  const others = remaining.filter(c => c.parentId !== target.parentId)
  return [...others, ...siblings]
}

// Reattaches a card to a different parent WITHOUT changing its level/column:
// the new parent must sit at the level directly above the card, same as the
// current one. This makes cycles structurally impossible (an ancestor is
// always at a strictly lower level than any of its descendants, so a level-1
// parent match can never resolve to one of the card's own descendants) and
// means no other card's level ever needs to cascade-update.
export function moveCardToParent(cards: Card[], cardId: string, newParentId: string): Card[] {
  const target = cards.find(c => c.id === cardId)
  if (!target) throw new Error(`moveCardToParent: card ${cardId} not found`)
  if (target.parentId === null) {
    throw new Error('moveCardToParent: cannot reparent the root card (single-root invariant)')
  }
  const newParent = cards.find(c => c.id === newParentId)
  if (!newParent) throw new Error(`moveCardToParent: new parent ${newParentId} not found`)
  if (newParent.level !== target.level - 1) {
    throw new Error(
      `moveCardToParent: new parent must be at level ${target.level - 1}, got ${newParent.level}`
    )
  }
  if (newParentId === target.parentId) return cards

  const oldSiblings = cards
    .filter(c => c.parentId === target.parentId && c.id !== cardId)
    .sort((a, b) => a.order - b.order)
    .map((c, i) => ({ ...c, order: i }))
  const newSiblings = cards.filter(c => c.parentId === newParentId)
  const moved: Card = { ...target, parentId: newParentId, order: newSiblings.length }
  const untouched = cards.filter(
    c => c.id !== cardId && c.parentId !== target.parentId && c.parentId !== newParentId
  )
  return [...untouched, ...oldSiblings, ...newSiblings, moved]
}

export function moveCardToIndex(cards: Card[], cardId: string, newIndex: number): Card[] {
  const target = cards.find(c => c.id === cardId)
  if (!target) throw new Error(`moveCardToIndex: card ${cardId} not found`)

  const group = cards.filter(c => c.parentId === target.parentId).sort((a, b) => a.order - b.order)
  const currentIndex = group.findIndex(c => c.id === cardId)
  const clampedIndex = Math.max(0, Math.min(newIndex, group.length - 1))

  const [moved] = group.splice(currentIndex, 1)
  group.splice(clampedIndex, 0, moved)
  const reindexed = group.map((c, i) => ({ ...c, order: i }))

  const others = cards.filter(c => c.parentId !== target.parentId)
  return [...others, ...reindexed]
}
