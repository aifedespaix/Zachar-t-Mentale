import { describe, expect, it } from 'vitest'
import { compareMindMaps, summarizeComparison } from './compare'
import type { Card } from '@app/types/card'

function card(id: string, title: string, definition?: string): Card {
  return { id, level: 2, title, parentId: 'root', order: 0, ...(definition === undefined ? {} : { definition }) }
}

const root: Card = { id: 'root', level: 1, title: 'Chapitre', parentId: null, order: 0 }

const bare = (cards: Card[]) => JSON.stringify(cards)
const enveloped = (cards: Card[]) =>
  JSON.stringify({ meta: { id: 'f', author: 'a', role: 'eleve', lastModified: '' }, cards })

describe('compareMindMaps', () => {
  it('says nothing separates two identical versions', () => {
    const cards = [root, card('a', 'Notion', 'x')]
    const comparison = compareMindMaps(bare(cards), bare(cards))

    expect(comparison).toMatchObject({ onlyLocal: [], onlyRemote: [], changed: [], identical: 2, unreadable: false })
    expect(summarizeComparison(comparison)).toBe('Les deux versions ont exactement le même contenu.')
  })

  it('compares across the two shapes a .zmap can take', () => {
    const cards = [root, card('a', 'Notion', 'x')]
    expect(compareMindMaps(bare(cards), enveloped(cards)).identical).toBe(2)
  })

  it('lists what only one side has', () => {
    const local = [root, card('a', 'Notion'), card('b', 'Ajoutée en local')]
    const remote = [root, card('a', 'Notion'), card('c', 'Ajoutée sur le serveur')]
    const comparison = compareMindMaps(bare(local), bare(remote))

    expect(comparison.onlyLocal.map(entry => entry.title)).toEqual(['Ajoutée en local'])
    expect(comparison.onlyRemote.map(entry => entry.title)).toEqual(['Ajoutée sur le serveur'])
  })

  it('reads a rename as a modification, not as a deletion plus an addition', () => {
    const local = [root, card('a', 'Coefficient directeur')]
    const remote = [root, card('a', 'Coefficient directeur (pente)')]
    const comparison = compareMindMaps(bare(local), bare(remote))

    expect(comparison.onlyLocal).toEqual([])
    expect(comparison.onlyRemote).toEqual([])
    expect(comparison.changed).toEqual([
      { id: 'a', title: 'Coefficient directeur', otherTitle: 'Coefficient directeur (pente)' },
    ])
  })

  it('detects a definition that changed under an unchanged title', () => {
    const comparison = compareMindMaps(
      bare([root, card('a', 'Notion', 'première version')]),
      bare([root, card('a', 'Notion', 'seconde version')])
    )
    expect(comparison.changed).toEqual([{ id: 'a', title: 'Notion' }])
  })

  it('ignores a move, which is not a content difference', () => {
    const local = [root, { ...card('a', 'Notion', 'x'), order: 0 }]
    const remote = [root, { ...card('a', 'Notion', 'x'), order: 5 }]
    expect(compareMindMaps(bare(local), bare(remote)).changed).toEqual([])
  })

  it('reports unreadable rather than inventing a comparison', () => {
    const comparison = compareMindMaps('pas du json', bare([root]))
    expect(comparison.unreadable).toBe(true)
    expect(summarizeComparison(comparison)).toMatch(/illisible/)
  })

  it('ignores an entry too broken to carry an id', () => {
    const comparison = compareMindMaps(JSON.stringify([root, { level: 2 }]), bare([root]))
    expect(comparison.onlyLocal).toEqual([])
    expect(comparison.identical).toBe(1)
  })
})

describe('summarizeComparison', () => {
  it('counts each kind of difference in one sentence', () => {
    const local = [root, card('a', 'Notion', 'v1'), card('b', 'Locale')]
    const remote = [root, card('a', 'Notion', 'v2'), card('c', 'Distante')]
    expect(summarizeComparison(compareMindMaps(bare(local), bare(remote)))).toBe(
      '1 seulement en local, 1 seulement sur le serveur, 1 modifiée · 1 identique'
    )
  })
})
