import { describe, it, expect } from 'vitest'
import { mergeCards } from './cardMerge'
import type { Card } from '../types/card'

function card(overrides: Partial<Card> = {}): Card {
  return { id: 'c1', level: 1, title: 't', parentId: null, order: 0, ...overrides }
}

describe('mergeCards', () => {
  it('keeps the remote list untouched when every local card is present remotely', () => {
    const remote = [card({ id: 'a' }), card({ id: 'b' })]
    const local = [card({ id: 'a', title: 'edited locally' }), card({ id: 'b' })]

    expect(mergeCards(local, remote)).toEqual({ cards: remote, floatedCount: 0 })
  })

  it('floats a local card missing from the remote version instead of dropping it', () => {
    const remote = [card({ id: 'a' })]
    const extra = card({ id: 'extra', parentId: 'a', level: 2 })
    const local = [card({ id: 'a' }), extra]

    const result = mergeCards(local, remote)

    expect(result.floatedCount).toBe(1)
    expect(result.cards).toEqual([remote[0], { ...extra, parentId: null, detached: true }])
  })

  it('leaves an already-detached local-only card detached', () => {
    const local = [card({ id: 'x', parentId: null, detached: true })]

    const result = mergeCards(local, [])

    expect(result.cards).toEqual([{ ...local[0], parentId: null, detached: true }])
    expect(result.floatedCount).toBe(1)
  })

  it('prefers the remote version of a card edited on both sides, with no field-level merge', () => {
    const remote = [card({ id: 'a', title: 'version du prof' })]
    const local = [card({ id: 'a', title: 'version de l’élève' })]

    expect(mergeCards(local, remote)).toEqual({ cards: remote, floatedCount: 0 })
  })
})
