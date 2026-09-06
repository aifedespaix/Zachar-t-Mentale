import type { Card } from '../types/card'

export function serializeCards(cards: Card[]): string {
  return JSON.stringify(cards, null, 2)
}

export function deserializeCards(json: string): Card[] {
  const parsed = JSON.parse(json)
  if (!Array.isArray(parsed)) throw new Error('deserializeCards: expected a JSON array of cards')
  return parsed as Card[]
}
