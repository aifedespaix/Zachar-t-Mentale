import type { Card } from '../types/card'

export const COLUMN_WIDTH = 320
export const ROW_HEIGHT = 120

export interface Position {
  x: number
  y: number
}

export function computeLayout(cards: Card[]): Record<string, Position> {
  const positions: Record<string, Position> = {}
  const groups = new Map<string | null, Card[]>()

  for (const card of cards) {
    const key = card.parentId
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(card)
  }

  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.order - b.order)
    sorted.forEach((card, index) => {
      positions[card.id] = {
        x: (card.level - 1) * COLUMN_WIDTH,
        y: index * ROW_HEIGHT,
      }
    })
  }

  return positions
}
