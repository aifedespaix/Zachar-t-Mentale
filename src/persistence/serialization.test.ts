import { describe, it, expect } from 'vitest'
import { serializeMindMap, deserializeMindMap } from './serialization'
import type { Card, MindMapMeta } from '../types/card'

const cards: Card[] = [{ id: 'root', level: 1, title: 'Chapitre', parentId: null, order: 0 }]
const meta: MindMapMeta = { id: 'abc-123', author: 'aife', role: 'prof', lastModified: '2026-09-10T12:00:00.000Z' }

describe('serializeMindMap', () => {
  it('writes a bare array when meta is null — byte-identical to the pre-sync format', () => {
    expect(serializeMindMap(null, cards)).toBe(JSON.stringify(cards, null, 2))
  })

  it('writes an enveloped object when meta is present', () => {
    expect(serializeMindMap(meta, cards)).toBe(JSON.stringify({ meta, cards }, null, 2))
  })
})

describe('deserializeMindMap', () => {
  it('reads a legacy bare array as meta: null', () => {
    expect(deserializeMindMap(JSON.stringify(cards))).toEqual({ meta: null, cards })
  })

  it('reads an enveloped object', () => {
    expect(deserializeMindMap(JSON.stringify({ meta, cards }))).toEqual({ meta, cards })
  })

  it('treats an enveloped object with no meta field as meta: null', () => {
    expect(deserializeMindMap(JSON.stringify({ cards }))).toEqual({ meta: null, cards })
  })

  it('throws on anything that is neither a bare array nor an object with cards', () => {
    expect(() => deserializeMindMap(JSON.stringify({ foo: 'bar' }))).toThrow()
    expect(() => deserializeMindMap('"just a string"')).toThrow()
  })
})
