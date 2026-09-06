import { describe, it, expect } from 'vitest'
import { serializeCards, deserializeCards } from './serialization'
import type { Card } from '../types/card'

const sample: Card[] = [{ id: 'root', level: 1, title: 'Chapitre', parentId: null, order: 0 }]

describe('serializeCards / deserializeCards', () => {
  it('round-trips a card list', () => {
    const json = serializeCards(sample)
    expect(deserializeCards(json)).toEqual(sample)
  })

  it('throws on malformed JSON that is not an array', () => {
    expect(() => deserializeCards('{"not":"an array"}')).toThrow()
  })
})
