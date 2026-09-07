import { describe, it, expect } from 'vitest'
import { paginateForExport } from './pagination'
import type { Card } from '../types/card'

describe('paginateForExport', () => {
  it('returns a single page when the whole tree fits the budget', () => {
    const cards: Card[] = [
      { id: 'root', level: 1, title: 'R', parentId: null, order: 0 },
      { id: 'a', level: 2, title: 'A', parentId: 'root', order: 0 },
      { id: 'b', level: 2, title: 'B', parentId: 'root', order: 1 },
    ]
    const pages = paginateForExport(cards, { includeDetached: false }, 5)
    expect(pages).toHaveLength(1)
    expect(pages[0].cards.map(c => c.id).sort()).toEqual(['a', 'b', 'root'])
  })

  it('splits by branch when two branches together exceed the budget but each fits alone, repeating the root on every page', () => {
    const cards: Card[] = [
      { id: 'root', level: 1, title: 'R', parentId: null, order: 0 },
      { id: 'a', level: 2, title: 'A', parentId: 'root', order: 0 },
      { id: 'a1', level: 3, title: 'A1', parentId: 'a', order: 0 },
      { id: 'a2', level: 3, title: 'A2', parentId: 'a', order: 1 },
      { id: 'b', level: 2, title: 'B', parentId: 'root', order: 1 },
      { id: 'b1', level: 3, title: 'B1', parentId: 'b', order: 0 },
      { id: 'b2', level: 3, title: 'B2', parentId: 'b', order: 1 },
    ]
    const pages = paginateForExport(cards, { includeDetached: false }, 2)
    expect(pages).toHaveLength(2)
    expect(pages[0].cards.map(c => c.id).sort()).toEqual(['a', 'a1', 'a2', 'root'])
    expect(pages[1].cards.map(c => c.id).sort()).toEqual(['b', 'b1', 'b2', 'root'])
  })

  it('batches a branch of many leaf children into several pages, each repeating the ancestor chain', () => {
    const cards: Card[] = [
      { id: 'root', level: 1, title: 'R', parentId: null, order: 0 },
      { id: 'p', level: 2, title: 'P', parentId: 'root', order: 0 },
      { id: 'c1', level: 3, title: 'C1', parentId: 'p', order: 0 },
      { id: 'c2', level: 3, title: 'C2', parentId: 'p', order: 1 },
      { id: 'c3', level: 3, title: 'C3', parentId: 'p', order: 2 },
    ]
    const pages = paginateForExport(cards, { includeDetached: false }, 2)
    expect(pages).toHaveLength(2)
    expect(pages[0].cards.map(c => c.id)).toEqual(['root', 'p', 'c1', 'c2'])
    expect(pages[1].cards.map(c => c.id)).toEqual(['root', 'p', 'c3'])
  })

  it('appends a dedicated final page of detached cards only when includeDetached is true', () => {
    const cards: Card[] = [
      { id: 'root', level: 1, title: 'R', parentId: null, order: 0 },
      { id: 'f1', level: 2, title: 'F1', parentId: null, order: 0, detached: true },
    ]
    const withDetached = paginateForExport(cards, { includeDetached: true }, 5)
    expect(withDetached).toHaveLength(2)
    expect(withDetached[1].cards.map(c => c.id)).toEqual(['f1'])

    const withoutDetached = paginateForExport(cards, { includeDetached: false }, 5)
    expect(withoutDetached).toHaveLength(1)
  })

  it('returns no pages for a file with no root', () => {
    expect(paginateForExport([], { includeDetached: false })).toEqual([])
  })

  it('packs multiple small sibling branches onto shared pages instead of one page per leaf', () => {
    const cards: Card[] = [
      { id: 'root', level: 1, title: 'R', parentId: null, order: 0 },
      { id: 'fat', level: 2, title: 'Fat', parentId: 'root', order: 0 },
      ...Array.from({ length: 4 }, (_, i) => ({
        id: `fatleaf${i}`, level: 3 as const, title: `FL${i}`, parentId: 'fat', order: i,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `theme${i}`, level: 2 as const, title: `Theme${i}`, parentId: 'root', order: i + 1,
      })),
    ]
    // budget 2: 'fat' alone has 4 leaves (> budget) so it splits into its own pages;
    // the 3 single-leaf themes (1 each) should pack two-per-page, not one-per-page.
    const pages = paginateForExport(cards, { includeDetached: false }, 2)
    const themePages = pages.filter(p => p.cards.some(c => c.title.startsWith('Theme')))
    expect(themePages.length).toBeLessThan(3) // NOT one page per theme
  })
})
