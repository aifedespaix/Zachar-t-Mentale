import type { Card, CardLevel } from '../types/card'

/**
 * The levels the quiz can actually ask about.
 *
 * A level counts as present when at least one card sits at it. Floating cards
 * are excluded: their `level` is vestigial (the one they last had before being
 * detached) and the quiz already keeps them out of its draw, so a level kept
 * alive only by a floating card is not somewhere a question can come from.
 */
export function presentLevels(cards: Card[]): CardLevel[] {
  const present = new Set<CardLevel>()
  for (const card of cards) {
    if (!card.detached) present.add(card.level)
  }
  return [...present].sort((a, b) => a - b)
}
