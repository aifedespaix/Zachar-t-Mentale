import { describe, it, expect } from 'vitest'
import { computeLayout, COLUMN_WIDTH, ROW_HEIGHT } from './columns'
import type { Card } from '../types/card'

describe('computeLayout', () => {
  it('places each level at its fixed column x position', () => {
    const cards: Card[] = [
      { id: 'root', level: 1, title: 'r', parentId: null, order: 0 },
      { id: 'child', level: 2, title: 'c', parentId: 'root', order: 0 },
    ]
    const positions = computeLayout(cards)
    expect(positions.root.x).toBe(0)
    expect(positions.child.x).toBe(COLUMN_WIDTH)
  })

  it('stacks siblings vertically by sorted order, independent of gaps in the order field', () => {
    const cards: Card[] = [
      { id: 'root', level: 1, title: 'r', parentId: null, order: 0 },
      { id: 'a', level: 2, title: 'a', parentId: 'root', order: 5 },
      { id: 'b', level: 2, title: 'b', parentId: 'root', order: 10 },
    ]
    const positions = computeLayout(cards)
    expect(positions.a.y).toBe(0)
    expect(positions.b.y).toBe(ROW_HEIGHT)
  })
})
