import { describe, it, expect } from 'vitest'
import { cardsToXmindContent, writeXmindFile } from './exportXmind'
import { xmindContentToCards } from './importXmind'
import type { Card } from '../types/card'

const cards: Card[] = [
  { id: 'root', level: 1, title: 'Chapitre', parentId: null, order: 0 },
  { id: 'a', level: 2, title: 'Thème', definition: 'note', parentId: 'root', order: 0 },
  { id: 'a1', level: 3, title: 'Règle', parentId: 'a', order: 0 },
  { id: 'f1', level: 2, title: 'Idée en vrac', parentId: null, order: 0, detached: true },
]

describe('cardsToXmindContent', () => {
  it('maps the root card to the sheet\'s central topic, with children nested by level', () => {
    const [sheet] = cardsToXmindContent(cards) as [{ title: string; rootTopic: { title: string; children: { attached: unknown[] } } }]
    expect(sheet.title).toBe('Chapitre')
    expect(sheet.rootTopic.title).toBe('Chapitre')
  })

  it('adds a synthetic "Cartes volantes" topic under the root for detached cards', () => {
    const [sheet] = cardsToXmindContent(cards) as [
      { rootTopic: { children: { attached: { title: string; children?: { attached: { title: string }[] } }[] } } },
    ]
    const volantes = sheet.rootTopic.children.attached.find(t => t.title === 'Cartes volantes')!
    expect(volantes).toBeDefined()
    expect(volantes.children!.attached.map(t => t.title)).toEqual(['Idée en vrac'])
  })

  it('throws when there is no root card', () => {
    expect(() => cardsToXmindContent([])).toThrow(/racine/)
  })
})

describe('round trip', () => {
  it('re-imports what it exported with the same titles, levels, definitions, and structure', () => {
    const content = cardsToXmindContent(cards)
    const [reimported] = xmindContentToCards(content)
    // A detached card's `level` is vestigial (see `Card.detached` in ../types/card): it's
    // recomputed from its new parent when re-attached, and re-importing it under the synthetic
    // "Cartes volantes" wrapper naturally nests it one level deeper. So it's excluded here, on
    // both sides, along with the wrapper topic itself — the wrapper's own shape is asserted
    // separately, above.
    const detachedTitles = new Set(cards.filter(c => c.detached).map(c => c.title))
    const shape = (list: Card[]) =>
      list
        .filter(c => c.title !== 'Cartes volantes')
        .map(c => ({
          title: c.title,
          level: detachedTitles.has(c.title) ? undefined : c.level,
          definition: c.definition,
        }))
        .sort((x, y) => x.title.localeCompare(y.title))
    expect(shape(reimported.cards)).toEqual(shape(cards.filter(c => c.title !== 'Cartes volantes')))
  })
})

describe('writeXmindFile', () => {
  it('produces a zip whose content.json matches cardsToXmindContent', async () => {
    const bytes = await writeXmindFile(cards)
    expect(bytes.length).toBeGreaterThan(0)
    // Byte 0-1 of a zip file is the local file header signature "PK".
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
  })
})
