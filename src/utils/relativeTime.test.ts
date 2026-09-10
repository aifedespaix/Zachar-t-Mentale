import { describe, it, expect } from 'vitest'
import { formatRelativeTime } from './relativeTime'

const NOW = new Date('2026-09-10T20:00:00.000Z')

describe('formatRelativeTime', () => {
  it('reads as « à l’instant » under a minute', () => {
    expect(formatRelativeTime('2026-09-10T19:59:30.000Z', NOW)).toBe('à l’instant')
  })

  it('counts minutes, then hours, then days', () => {
    expect(formatRelativeTime('2026-09-10T19:48:00.000Z', NOW)).toBe('il y a 12 min')
    expect(formatRelativeTime('2026-09-10T17:00:00.000Z', NOW)).toBe('il y a 3 h')
    expect(formatRelativeTime('2026-09-08T20:00:00.000Z', NOW)).toBe('il y a 2 j')
  })

  it('returns null for "never", for an empty string and for an unparseable date', () => {
    expect(formatRelativeTime(null, NOW)).toBeNull()
    expect(formatRelativeTime('', NOW)).toBeNull()
    expect(formatRelativeTime('pas une date', NOW)).toBeNull()
  })

  it('reads a timestamp from the future as « à l’instant », never as a negative age', () => {
    expect(formatRelativeTime('2026-09-10T20:05:00.000Z', NOW)).toBe('à l’instant')
  })
})
