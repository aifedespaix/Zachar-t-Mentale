import { describe, it, expect } from 'vitest'
import type { Card } from '../types/card'
import { validateCards, repairCards, summarizeIssues, type CardIssueKind } from './cardsValidation'

/**
 * Card builder for tests. `level` is deliberately widened to `number`: half the
 * point of these tests is feeding the validator levels the type system forbids
 * (a level-5 card in a hand-edited file), which is exactly the data that
 * reaches `validateCards` at runtime.
 */
function card(partial: Partial<Omit<Card, 'level'>> & { id: string; level?: number }): Card {
  return {
    level: 1,
    title: partial.id,
    parentId: null,
    order: 0,
    ...partial,
  } as Card
}

/** A healthy 4-level chain plus a sibling, the shape every "corrupt" case below deviates from. */
function healthyMap(): Card[] {
  return [
    card({ id: 'root', level: 1, parentId: null, order: 0 }),
    card({ id: 'a', level: 2, parentId: 'root', order: 0 }),
    card({ id: 'b', level: 2, parentId: 'root', order: 1 }),
    card({ id: 'a1', level: 3, parentId: 'a', order: 0 }),
    card({ id: 'a1x', level: 4, parentId: 'a1', order: 0 }),
  ]
}

function kinds(cards: unknown): CardIssueKind[] {
  return validateCards(cards).issues.map(issue => issue.kind)
}

describe('validateCards', () => {
  it('accepts a well-formed map', () => {
    expect(validateCards(healthyMap())).toEqual({ valid: true, issues: [] })
  })

  it('accepts an empty map and a map made only of floating cards', () => {
    expect(validateCards([]).valid).toBe(true)
    expect(validateCards([card({ id: 'v', detached: true })]).valid).toBe(true)
  })

  it('accepts floating cards alongside a healthy tree', () => {
    const cards = [...healthyMap(), card({ id: 'v1', level: 3, detached: true, order: 0 })]
    expect(validateCards(cards).valid).toBe(true)
  })

  it('rejects anything that is not an array of cards', () => {
    expect(kinds({ cards: [] })).toEqual(['malformed'])
    expect(kinds(null)).toEqual(['malformed'])
  })

  it('detects a ghost card: its parent no longer exists', () => {
    const cards = [...healthyMap(), card({ id: 'ghost', level: 2, parentId: 'disparu', order: 0 })]
    const report = validateCards(cards)
    expect(report.valid).toBe(false)
    expect(report.issues).toEqual([
      expect.objectContaining({ kind: 'ghost-parent', cardId: 'ghost' }),
    ])
  })

  it('detects the whole branch hanging under a ghost card', () => {
    const cards = [
      ...healthyMap(),
      card({ id: 'ghost', level: 2, parentId: 'disparu', order: 0 }),
      card({ id: 'ghost-child', level: 3, parentId: 'ghost', order: 0 }),
    ]
    expect(kinds(cards)).toEqual(['ghost-parent', 'orphan-branch'])
  })

  it('detects a card past the strict 4-level limit', () => {
    const cards = [...healthyMap(), card({ id: 'too-deep', level: 5, parentId: 'a1x', order: 0 })]
    const report = validateCards(cards)
    expect(report.valid).toBe(false)
    expect(report.issues).toEqual([expect.objectContaining({ kind: 'depth-overflow', cardId: 'too-deep' })])
  })

  it('detects a card that is its own parent', () => {
    const cards = [...healthyMap(), card({ id: 'self', level: 2, parentId: 'self', order: 0 })]
    expect(kinds(cards)).toEqual(['cycle'])
  })

  it('detects a two-card parent loop without hanging', () => {
    const cards = [
      ...healthyMap(),
      card({ id: 'x', level: 2, parentId: 'y', order: 0 }),
      card({ id: 'y', level: 2, parentId: 'x', order: 0 }),
    ]
    expect(kinds(cards)).toEqual(['cycle', 'cycle'])
  })

  it('detects a card that is the child of its own child', () => {
    const cards = healthyMap().map(c => (c.id === 'a' ? { ...c, parentId: 'a1x' } : c))
    const report = validateCards(cards)
    expect(report.valid).toBe(false)
    expect(report.issues.map(i => i.kind)).toContain('cycle')
  })

  it('detects a second root, and a card hanging off a floating one', () => {
    const cards = [
      ...healthyMap(),
      card({ id: 'root2', level: 1, parentId: null, order: 1 }),
      card({ id: 'v', level: 2, detached: true, order: 0 }),
      card({ id: 'under-v', level: 3, parentId: 'v', order: 0 }),
    ]
    expect(kinds(cards)).toEqual(['extra-root', 'detached-parent'])
  })

  it('detects duplicate identifiers and unusable records', () => {
    const cards = [
      ...healthyMap(),
      card({ id: 'a', level: 2, parentId: 'root', order: 5 }),
      { id: 'no-title', level: 2, parentId: 'root', order: 6 },
      'pas une carte',
    ]
    expect(kinds(cards)).toEqual(expect.arrayContaining(['duplicate-id', 'malformed']))
  })

  it('detects a level that disagrees with the card’s real depth', () => {
    const cards = healthyMap().map(c => (c.id === 'a1' ? { ...c, level: 2 as const } : c))
    expect(kinds(cards)).toEqual(['invalid-level'])
  })

  it('summarizes issues by kind for display', () => {
    const cards = [
      ...healthyMap(),
      card({ id: 'g1', level: 2, parentId: 'nope', order: 0 }),
      card({ id: 'g2', level: 2, parentId: 'nope', order: 1 }),
    ]
    expect(summarizeIssues(validateCards(cards).issues)).toEqual(['2 × carte fantôme (parent introuvable)'])
  })
})

describe('repairCards', () => {
  it('leaves a healthy map untouched', () => {
    const cards = healthyMap()
    expect(repairCards(cards)).toEqual(cards)
  })

  it('never mutates the data it is given', () => {
    const cards = [...healthyMap(), card({ id: 'ghost', level: 2, parentId: 'disparu', order: 0 })]
    const snapshot = structuredClone(cards)
    repairCards(cards)
    expect(cards).toEqual(snapshot)
  })

  it('keeps every valid card in place and floats only the broken ones', () => {
    const cards = [...healthyMap(), card({ id: 'ghost', level: 2, parentId: 'disparu', order: 0 })]
    const repaired = repairCards(cards)

    for (const original of healthyMap()) {
      expect(repaired).toContainEqual(original)
    }
    expect(repaired.find(c => c.id === 'ghost')).toEqual(
      expect.objectContaining({ id: 'ghost', parentId: null, detached: true })
    )
  })

  it('flattens a broken branch: children follow their parent into the floating zone', () => {
    const cards = [
      ...healthyMap(),
      card({ id: 'ghost', level: 2, parentId: 'disparu', order: 0, title: 'Orpheline' }),
      card({ id: 'ghost-child', level: 3, parentId: 'ghost', order: 0, title: 'Enfant' }),
    ]
    const repaired = repairCards(cards)
    const floating = repaired.filter(c => c.detached)
    expect(floating.map(c => c.id)).toEqual(['ghost', 'ghost-child'])
    // Flattened: neither keeps a parent, and their titles survive.
    expect(floating.every(c => c.parentId === null)).toBe(true)
    expect(floating.map(c => c.title)).toEqual(['Orpheline', 'Enfant'])
  })

  it('floats the cards that overflow the 4-level limit, keeping the first four levels', () => {
    const cards = [
      ...healthyMap(),
      card({ id: 'level5', level: 5, parentId: 'a1x', order: 0 }),
      card({ id: 'level6', level: 6, parentId: 'level5', order: 0 }),
    ]
    const repaired = repairCards(cards)
    expect(repaired.find(c => c.id === 'a1x')).toEqual(expect.objectContaining({ level: 4, parentId: 'a1' }))
    expect(repaired.filter(c => c.detached).map(c => c.id)).toEqual(['level5', 'level6'])
  })

  it('breaks a parent loop by floating every card caught in it', () => {
    const cards = [
      ...healthyMap(),
      card({ id: 'x', level: 2, parentId: 'y', order: 0 }),
      card({ id: 'y', level: 2, parentId: 'x', order: 0 }),
    ]
    const repaired = repairCards(cards)
    expect(repaired.filter(c => c.detached).map(c => c.id)).toEqual(['x', 'y'])
  })

  it('recomputes levels from the real depth instead of trusting the file', () => {
    const cards = healthyMap().map(c => (c.id === 'a1' ? { ...c, level: 2 as const } : c))
    expect(repairCards(cards).find(c => c.id === 'a1')).toEqual(expect.objectContaining({ level: 3, parentId: 'a' }))
  })

  it('keeps cards that were already floating, before the newcomers', () => {
    const cards = [
      ...healthyMap(),
      card({ id: 'old-v', level: 2, detached: true, order: 0 }),
      card({ id: 'ghost', level: 2, parentId: 'disparu', order: 0 }),
    ]
    const floating = repairCards(cards).filter(c => c.detached)
    expect(floating.map(c => c.id)).toEqual(['old-v', 'ghost'])
    expect(floating.map(c => c.order)).toEqual([0, 1])
  })

  it('gives duplicated identifiers a fresh id instead of dropping the card', () => {
    const cards = [...healthyMap(), card({ id: 'a', level: 2, parentId: 'root', order: 5, title: 'Doublon' })]
    const repaired = repairCards(cards)
    const duplicate = repaired.find(c => c.title === 'Doublon')!
    expect(duplicate.id).not.toBe('a')
    expect(duplicate.detached).toBe(true)
    expect(repaired.find(c => c.id === 'a')?.title).toBe('a')
  })

  it('renumbers sibling groups so no gap is left by a floated card', () => {
    const cards = [
      card({ id: 'root', level: 1, order: 0 }),
      card({ id: 'keep', level: 2, parentId: 'root', order: 3 }),
      card({ id: 'ghost', level: 2, parentId: 'nope', order: 0 }),
    ]
    expect(repairCards(cards).find(c => c.id === 'keep')?.order).toBe(0)
  })

  it('gives the cards a home when the file has no usable root', () => {
    const cards = [card({ id: 'orphan', level: 2, parentId: 'nope', order: 0 })]
    const repaired = repairCards(cards)
    expect(repaired[0]).toEqual(expect.objectContaining({ level: 1, parentId: null }))
    expect(repaired[0].detached).toBeUndefined()
    expect(repaired.find(c => c.id === 'orphan')?.detached).toBe(true)
  })

  it('produces a structure that always passes validation', () => {
    const corruptMaps: unknown[] = [
      [...healthyMap(), card({ id: 'ghost', level: 2, parentId: 'disparu', order: 0 })],
      [...healthyMap(), card({ id: 'self', level: 2, parentId: 'self', order: 0 })],
      [...healthyMap(), card({ id: 'x', level: 2, parentId: 'y', order: 0 }), card({ id: 'y', level: 2, parentId: 'x', order: 0 })],
      [...healthyMap(), card({ id: 'deep', level: 5, parentId: 'a1x', order: 0 })],
      [...healthyMap(), card({ id: 'root2', level: 1, parentId: null, order: 1 })],
      [...healthyMap(), card({ id: 'v', detached: true, order: 0 }), card({ id: 'under-v', level: 2, parentId: 'v', order: 0 })],
      [...healthyMap(), card({ id: 'a', level: 2, parentId: 'root', order: 9, title: 'Doublon' })],
      [{ id: 'bad-level', level: Number.NaN, title: 'x', parentId: null, order: 0 }, 42, null],
      { not: 'an array' },
    ]
    for (const corrupt of corruptMaps) {
      expect(validateCards(repairCards(corrupt))).toEqual({ valid: true, issues: [] })
    }
  })
})

/**
 * The maps shipped with the app are the reference for "healthy data". A rule
 * that flags one of them is too strict — and a validator that is too strict is
 * worse than none, since it would block real files behind a repair dialog.
 */
describe('the mind maps bundled with the app', () => {
  const files = import.meta.glob('../../.cartes-mentales/**/*.json', { eager: true, import: 'default' })

  it('finds at least one bundled map to check', () => {
    expect(Object.keys(files).length).toBeGreaterThan(0)
  })

  it.each(Object.keys(files))('%s passes validation untouched', path => {
    expect(validateCards(files[path])).toEqual({ valid: true, issues: [] })
  })
})

describe('content blocks', () => {
  const root = { id: 'r', level: 1, title: 'Racine', parentId: null, order: 0 }

  it('accepts a card carrying content blocks', () => {
    const report = validateCards([
      root,
      { id: 'a', level: 2, title: 'A', parentId: 'r', order: 0, definition: 'x²',
        content: [{ kind: 'math', latex: 'x^2' }] },
    ])
    expect(report.valid).toBe(true)
  })

  it('accepts a block kind it does not know, instead of rejecting the card', () => {
    // Forward compatibility: a file written by a later version must open.
    const report = validateCards([
      root,
      { id: 'a', level: 2, title: 'A', parentId: 'r', order: 0, definition: '[partition]',
        content: [{ kind: 'music', abc: 'X:1' }] },
    ])
    expect(report.valid).toBe(true)
  })

  it('rejects a card whose content is not an array at all', () => {
    const report = validateCards([
      root,
      { id: 'a', level: 2, title: 'A', parentId: 'r', order: 0, content: 'pas un tableau' },
    ])
    expect(report.valid).toBe(false)
    expect(report.issues[0].kind).toBe('malformed')
  })

  it('salvages a card whose only content is an image, instead of dropping it', () => {
    // `id: 42` makes the entry fail isUsableCardRecord, which is what actually
    // routes it through salvage(). An entry with a well-typed id and a ghost
    // parent takes the newlyFloating branch instead and never reaches it.
    const repaired = repairCards([
      root,
      { id: 42, level: 2, title: '', parentId: 'r', order: 0,
        content: [{ kind: 'image', asset: 'a1.png', alt: 'Schéma', width: 100, height: 50 }] },
    ])
    const rescued = repaired.find(c => c.content?.[0]?.kind === 'image')
    expect(rescued).toBeDefined()
    expect(rescued!.detached).toBe(true)
    // The mirror MUST be derived: without it the card is invisible to the quiz,
    // the XMind note and the export, all of which read `definition`.
    expect(rescued!.definition).toBe('[image : Schéma]')
  })

  it('does not resurrect junk content as a blank, unrenderable card', () => {
    const repaired = repairCards([
      root,
      { id: 1, title: '', content: [null] },
      { id: 2, title: '', content: [1, 2, 3] },
      { id: 3, title: '', content: [{ kind: 'image', asset: 'a.png' }] },
    ])
    expect(repaired.filter(c => c.id !== 'r')).toHaveLength(0)
  })

  it('drops an image whose dimensions are not finite, rather than keeping a reference that dies on reload', () => {
    const repaired = repairCards([
      root,
      { id: 9, title: '', content: [{ kind: 'image', asset: 'a.png', alt: 'x', width: null, height: 10 }] },
    ])
    expect(repaired.filter(c => c.id !== 'r')).toHaveLength(0)
  })

  it('leaves a repaired file valid even when it carries unknown blocks', () => {
    const repaired = repairCards([
      root,
      { id: 'a', level: 2, title: 'A', parentId: 'r', order: 0,
        content: [{ kind: 'music', abc: 'X:1' }] },
    ])
    expect(validateCards(repaired).valid).toBe(true)
  })
})
