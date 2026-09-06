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
