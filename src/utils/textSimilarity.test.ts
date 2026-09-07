import { describe, it, expect } from 'vitest'
import { normalizeForComparison, computeTitleSimilarity, similarityColor } from './textSimilarity'

describe('normalizeForComparison', () => {
  it('lowercases, strips accents, and trims', () => {
    expect(normalizeForComparison('  Photosynthèse  ')).toBe('photosynthese')
  })
})

describe('computeTitleSimilarity', () => {
  it('returns 100 for an exact match', () => {
    expect(computeTitleSimilarity('Chat', 'Chat')).toBe(100)
  })

  it('returns 100 for a match differing only by case and accents', () => {
    expect(computeTitleSimilarity('photosynthese', 'Photosynthèse')).toBe(100)
  })

  it('returns a partial percentage for a near match (one substitution out of 4 chars)', () => {
    expect(computeTitleSimilarity('Chah', 'Chat')).toBe(75)
  })

  it('returns 0 for a completely different, same-length string', () => {
    expect(computeTitleSimilarity('Xyzw', 'Chat')).toBe(0)
  })
})

describe('similarityColor', () => {
  it('is green at or above 85%', () => {
    expect(similarityColor(85)).toBe('#16a34a')
    expect(similarityColor(100)).toBe('#16a34a')
  })

  it('is amber between 50% and 85%', () => {
    expect(similarityColor(50)).toBe('#d97706')
    expect(similarityColor(84)).toBe('#d97706')
  })

  it('is red below 50%', () => {
    expect(similarityColor(0)).toBe('#dc2626')
    expect(similarityColor(49)).toBe('#dc2626')
  })
})
