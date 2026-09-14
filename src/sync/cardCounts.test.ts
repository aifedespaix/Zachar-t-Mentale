import { describe, it, expect } from 'vitest'
import { countCards, countDelta, emptyCardCounts } from './cardCounts'
import type { Card } from '../types/card'

function card(partial: Partial<Card> & Pick<Card, 'id' | 'level'>): Card {
  return { title: partial.id, parentId: null, order: 0, ...partial }
}

describe('countCards', () => {
  it('counts an empty map as zero everywhere', () => {
    expect(countCards([])).toEqual(emptyCardCounts())
  })

  it('counts cards by level and in total', () => {
    const counts = countCards([
      card({ id: 'root', level: 1 }),
      card({ id: 'a', level: 2, parentId: 'root' }),
      card({ id: 'b', level: 2, parentId: 'root' }),
      card({ id: 'c', level: 3, parentId: 'a' }),
      card({ id: 'd', level: 4, parentId: 'c' }),
    ])
    expect(counts).toEqual({ total: 5, byLevel: { 1: 1, 2: 2, 3: 1, 4: 1 }, detached: 0 })
  })

  it('counts a detached card apart from its vestigial level, but still in the total', () => {
    const counts = countCards([card({ id: 'root', level: 1 }), card({ id: 'volante', level: 2, detached: true })])
    expect(counts).toEqual({ total: 2, byLevel: { 1: 1, 2: 0, 3: 0, 4: 0 }, detached: 1 })
  })

  it('still counts a card whose level is outside 1-4 in the total', () => {
    const counts = countCards([card({ id: 'futur', level: 9 as Card['level'] })])
    expect(counts.total).toBe(1)
    expect(counts.byLevel).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0 })
  })
})

describe('countDelta', () => {
  it('says nothing when both sides agree', () => {
    expect(countDelta(4, 4)).toBeNull()
  })

  it('signs the difference', () => {
    expect(countDelta(6, 4)).toBe('+2')
    expect(countDelta(3, 4)).toBe('-1')
  })
})
