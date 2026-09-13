// src/quiz/levels.test.ts
import { describe, it, expect } from 'vitest'
import { presentLevels } from './levels'
import type { Card, CardLevel } from '../types/card'

function card(level: CardLevel, id: string, detached?: boolean): Card {
  return { id, level, title: id, parentId: null, order: 0, ...(detached ? { detached: true } : {}) }
}

describe('presentLevels', () => {
  it('returns an empty list for an empty map', () => {
    expect(presentLevels([])).toEqual([])
  })

  it('returns each level that has at least one card, sorted ascending', () => {
    expect(presentLevels([card(1, 'root'), card(3, 'a'), card(2, 'b'), card(3, 'c')])).toEqual([1, 2, 3])
  })

  it('ignores floating cards, whose level is vestigial', () => {
    expect(presentLevels([card(1, 'root'), card(4, 'floating', true)])).toEqual([1])
  })
})
