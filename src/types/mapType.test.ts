import { describe, it, expect } from 'vitest'
import {
  DEFAULT_MAP_TYPE,
  MAP_TYPES,
  MAP_TYPE_DESCRIPTIONS,
  MAP_TYPE_LABELS,
  isKnownMapType,
  mapTypeOf,
} from './mapType'

describe('mapTypeOf', () => {
  it('renders every value of the closed vocabulary', () => {
    for (const type of MAP_TYPES) expect(mapTypeOf(type)).toBe(type)
    expect(mapTypeOf('default')).toBe('default')
  })

  it('falls back to default for anything else, without throwing', () => {
    expect(mapTypeOf('examen')).toBe(DEFAULT_MAP_TYPE)
    expect(mapTypeOf('')).toBe(DEFAULT_MAP_TYPE)
    expect(mapTypeOf(42)).toBe(DEFAULT_MAP_TYPE)
    expect(mapTypeOf(null)).toBe(DEFAULT_MAP_TYPE)
    expect(mapTypeOf(undefined)).toBe(DEFAULT_MAP_TYPE)
    expect(mapTypeOf({ type: 'cours' })).toBe(DEFAULT_MAP_TYPE)
  })
})

describe('isKnownMapType', () => {
  it('accepts the four classified types and default', () => {
    for (const type of MAP_TYPES) expect(isKnownMapType(type)).toBe(true)
    expect(isKnownMapType('default')).toBe(true)
  })

  it('rejects an unknown string, the way a hand-edited file can produce one', () => {
    expect(isKnownMapType('examen')).toBe(false)
    expect(isKnownMapType(undefined)).toBe(false)
    expect(isKnownMapType(3)).toBe(false)
  })
})

describe('libellés et descriptions', () => {
  it('names every type and describes every classified one', () => {
    for (const type of MAP_TYPES) {
      expect(MAP_TYPE_LABELS[type]).toBeTruthy()
      expect(MAP_TYPE_DESCRIPTIONS[type]).toBeTruthy()
    }
    expect(MAP_TYPE_LABELS.default).toBe('Sans type')
  })
})
