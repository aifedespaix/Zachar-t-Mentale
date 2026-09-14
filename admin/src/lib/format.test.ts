import { describe, expect, it } from 'vitest'
import { fullDate, humanSize, parseServerDate, plural, relativeTime } from './format'

describe('parseServerDate', () => {
  it('reads the space-separated form PocketBase actually returns', () => {
    // Safari rend `Invalid Date` sur cette forme : c'est le bug qu'on ne voit
    // que sur le téléphone, donc celui qui mérite son test.
    const date = parseServerDate('2026-09-14 08:00:00.000Z')
    expect(date?.toISOString()).toBe('2026-09-14T08:00:00.000Z')
  })

  it('reads ordinary ISO 8601 too', () => {
    expect(parseServerDate('2026-09-14T08:00:00.000Z')?.toISOString()).toBe('2026-09-14T08:00:00.000Z')
  })

  it('assumes UTC when the string carries no zone, as PocketBase does', () => {
    expect(parseServerDate('2026-09-14 08:00:00')?.toISOString()).toBe('2026-09-14T08:00:00.000Z')
  })

  it('answers null rather than an Invalid Date nobody can test against', () => {
    expect(parseServerDate('')).toBeNull()
    expect(parseServerDate('pas une date')).toBeNull()
  })
})

describe('relativeTime', () => {
  const now = new Date('2026-09-14T12:00:00.000Z')

  it('says « à l’instant » under a minute', () => {
    expect(relativeTime('2026-09-14 11:59:30.000Z', now)).toBe('à l’instant')
  })

  it('counts minutes, then hours', () => {
    expect(relativeTime('2026-09-14 11:38:00.000Z', now)).toBe('il y a 22 min')
    expect(relativeTime('2026-09-14 07:00:00.000Z', now)).toBe('il y a 5 h')
  })

  it('says « hier » rather than « il y a 1 jour »', () => {
    expect(relativeTime('2026-09-13 10:00:00.000Z', now)).toBe('hier')
  })

  it('switches to an absolute date past a week, which needs no mental arithmetic', () => {
    expect(relativeTime('2026-08-14 10:00:00.000Z', now)).toMatch(/août/)
  })

  it('shows the year only when it is not the current one', () => {
    expect(relativeTime('2025-08-14 10:00:00.000Z', now)).toMatch(/2025/)
    expect(relativeTime('2026-08-14 10:00:00.000Z', now)).not.toMatch(/2026/)
  })

  it('never shows a negative delay for a clock slightly ahead', () => {
    expect(relativeTime('2026-09-14 12:00:30.000Z', now)).toBe('à l’instant')
  })

  it('degrades to a dash rather than to Invalid Date', () => {
    expect(relativeTime('', now)).toBe('—')
  })
})

describe('fullDate', () => {
  it('degrades to a dash on an unreadable value', () => {
    expect(fullDate('n’importe quoi')).toBe('—')
  })
})

describe('plural', () => {
  it('keeps the singular at zero and one', () => {
    expect(plural(0, 'carte')).toBe('0 carte')
    expect(plural(1, 'carte')).toBe('1 carte')
    expect(plural(2, 'carte')).toBe('2 cartes')
  })

  it('accepts an irregular plural', () => {
    expect(plural(2, 'travail', 'travaux')).toBe('2 travaux')
  })
})

describe('humanSize', () => {
  it('uses French units and a French decimal comma', () => {
    expect(humanSize(512)).toBe('512 o')
    expect(humanSize(2048)).toBe('2,0 Kio')
    expect(humanSize(3 * 1024 * 1024)).toBe('3,0 Mio')
  })
})
