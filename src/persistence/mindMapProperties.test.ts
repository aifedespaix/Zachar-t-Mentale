import { describe, it, expect } from 'vitest'
import { formatFileSize, formatDateTime, tallyCards, tallyTree } from './mindMapProperties'
import type { Card } from '../types/card'
import type { FileTreeNode } from '../types/workspace'

function card(id: string, level: 1 | 2 | 3 | 4): Card {
  return { id, level, title: id, parentId: null, order: 0 }
}

describe('formatFileSize', () => {
  it('stays byte-precise below one kilobyte', () => {
    expect(formatFileSize(0)).toBe('0 o')
    expect(formatFileSize(1023)).toBe('1023 o')
  })

  it('switches to binary units, with a decimal under ten', () => {
    expect(formatFileSize(1024)).toBe('1,0 Ko')
    expect(formatFileSize(1536)).toBe('1,5 Ko')
    expect(formatFileSize(15360)).toBe('15 Ko')
    expect(formatFileSize(1024 * 1024)).toBe('1,0 Mo')
    expect(formatFileSize(1024 ** 4)).toBe('1,0 To')
  })

  it('says nothing rather than zero when the size is unknown', () => {
    expect(formatFileSize(null)).toBe('—')
    expect(formatFileSize(undefined)).toBe('—')
    expect(formatFileSize(Number.NaN)).toBe('—')
    expect(formatFileSize(-1)).toBe('—')
  })
})

describe('formatDateTime', () => {
  it('formats a known timestamp with its year', () => {
    expect(formatDateTime('2026-09-15T10:30:00.000Z')).toContain('2026')
  })

  it('returns null for « no date » and for a value that does not parse', () => {
    expect(formatDateTime(null)).toBeNull()
    expect(formatDateTime(undefined)).toBeNull()
    expect(formatDateTime('')).toBeNull()
    expect(formatDateTime('pas une date')).toBeNull()
  })
})

describe('tallyCards', () => {
  it('counts the total and every level', () => {
    const cards = [card('r', 1), card('a', 2), card('b', 2), card('c', 3)]
    expect(tallyCards(cards)).toEqual({ total: 4, byLevel: { 1: 1, 2: 2, 3: 1, 4: 0 } })
  })

  it('is all zeroes for a map with no cards', () => {
    expect(tallyCards([])).toEqual({ total: 0, byLevel: { 1: 0, 2: 0, 3: 0, 4: 0 } })
  })
})

describe('tallyTree', () => {
  const folder: FileTreeNode = {
    type: 'folder',
    name: 'C',
    path: '/c',
    children: [
      { type: 'mindmap', name: 'a.zmap', path: '/c/a.zmap' },
      { type: 'other', name: 'n.pdf', path: '/c/n.pdf' },
      {
        type: 'folder',
        name: 'D',
        path: '/c/D',
        children: [{ type: 'mindmap', name: 'b.zmap', path: '/c/D/b.zmap' }],
      },
    ],
  }

  it('counts everything under a folder by kind', () => {
    expect(tallyTree(folder)).toEqual({ folders: 1, mindmaps: 2, others: 1, total: 4 })
  })

  it('counts nothing for a leaf node', () => {
    expect(tallyTree({ type: 'mindmap', name: 'x.zmap', path: '/x.zmap' })).toEqual({
      folders: 0,
      mindmaps: 0,
      others: 0,
      total: 0,
    })
  })
})
