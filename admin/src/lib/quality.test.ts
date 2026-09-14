import { describe, expect, it } from 'vitest'
import {
  LONG_DEFINITION_CHARS,
  analyzeMindMapText,
  parseMindMapText,
  qualityWarnings,
  repairMindMapText,
} from './quality'
import type { Card } from '@app/types/card'

function card(overrides: Partial<Card> & { id: string }): Card {
  return {
    level: 1,
    title: 'Titre',
    parentId: null,
    order: 0,
    ...overrides,
  }
}

/** Une carte mentale minimale mais VALIDE : une racine, deux enfants qui définissent quelque chose. */
function healthy(): Card[] {
  return [
    card({ id: 'root', level: 1, title: 'Les fonctions affines', parentId: null, order: 0 }),
    card({ id: 'a', level: 2, title: 'Coefficient directeur', definition: 'Le a de ax + b.', parentId: 'root', order: 0 }),
    card({ id: 'b', level: 2, title: 'Ordonnée à l’origine', definition: 'Le b de ax + b.', parentId: 'root', order: 1 }),
    card({ id: 'c', level: 3, title: 'Signe de a', definition: 'Croissante si a > 0.', parentId: 'a', order: 0 }),
  ]
}

const codes = (raw: string) => analyzeMindMapText(raw).findings.map(entry => entry.code)

describe('parseMindMapText', () => {
  it('accepts the bare array a never-synced file carries', () => {
    const parsed = parseMindMapText(JSON.stringify(healthy()))
    expect(parsed.cards).toHaveLength(4)
    expect(parsed.meta).toBeNull()
    expect(parsed.error).toBeNull()
  })

  it('accepts the { meta, cards } envelope a published file carries', () => {
    const meta = { id: 'file-1', author: 'aife', role: 'prof', lastModified: '2026-09-01T00:00:00.000Z' }
    const parsed = parseMindMapText(JSON.stringify({ meta, cards: healthy() }))
    expect(parsed.cards).toHaveLength(4)
    expect(parsed.meta).toMatchObject({ id: 'file-1', author: 'aife' })
  })

  it('says what is wrong with a text that is not JSON at all', () => {
    expect(parseMindMapText('voici ma carte').error).toMatch(/pas du JSON valide/)
  })

  it('refuses JSON that is valid but is not a mind map', () => {
    expect(parseMindMapText('{"titre":"Maths"}').error).toMatch(/pas une carte mentale/)
    expect(parseMindMapText('42').error).toMatch(/ni une liste de cartes/)
  })

  it('treats an empty paste as nothing to do, not as a syntax error', () => {
    expect(parseMindMapText('   ').error).toMatch(/texte est vide/)
  })
})

describe('analyzeMindMapText — ce qui bloque', () => {
  it('accepts a healthy map with nothing to say about it', () => {
    const report = analyzeMindMapText(JSON.stringify(healthy()))
    expect(report.saveable).toBe(true)
    expect(report.findings).toEqual([])
    expect(report.cards).toHaveLength(4)
  })

  it('refuses an empty list', () => {
    expect(codes('[]')).toEqual(['empty'])
    expect(analyzeMindMapText('[]').saveable).toBe(false)
  })

  it('refuses what the canvas itself would refuse to open, and offers to repair it', () => {
    // Deux racines : exactement ce que `validateCards` appelle 'extra-root'.
    const broken = [...healthy(), card({ id: 'second-root', level: 1, title: 'Autre racine', parentId: null, order: 9 })]
    const report = analyzeMindMapText(JSON.stringify(broken))

    expect(report.saveable).toBe(false)
    expect(report.repairable).toBe(true)
    expect(report.findings[0].code).toBe('structure')
    expect(report.findings.some(entry => entry.code === 'structure:extra-root')).toBe(true)
  })

  it('refuses a card pointing at a parent that does not exist', () => {
    const broken = [...healthy(), card({ id: 'ghost', level: 2, title: 'Orpheline', parentId: 'nulle-part', order: 5 })]
    expect(analyzeMindMapText(JSON.stringify(broken)).saveable).toBe(false)
  })

  it('reports no quality warning when the structure is already broken', () => {
    // Sinon le vrai problème se noie dans ses propres symptômes.
    const broken = [card({ id: 'a', level: 2, title: '', parentId: 'absent', order: 0 })]
    expect(codes(JSON.stringify(broken)).every(code => code.startsWith('structure'))).toBe(true)
  })
})

describe('analyzeMindMapText — ce qui avertit sans bloquer', () => {
  it('lets a deliberately incomplete skeleton through, with a warning', () => {
    const skeleton = [
      card({ id: 'root', title: 'Chapitre 3', parentId: null, order: 0 }),
      card({ id: 'a', level: 2, title: 'À remplir', parentId: 'root', order: 0 }),
      card({ id: 'b', level: 3, title: 'Et ça aussi', parentId: 'a', order: 0 }),
    ]
    const report = analyzeMindMapText(JSON.stringify(skeleton))

    expect(report.saveable).toBe(true)
    expect(report.findings.map(entry => entry.code)).toContain('no-definition')
  })

  it('names the cards concerned, because « où ça ? » est la question suivante', () => {
    const skeleton = [
      card({ id: 'root', title: 'Chapitre 3', parentId: null, order: 0 }),
      card({ id: 'a', level: 2, title: 'Vide 1', parentId: 'root', order: 0 }),
      card({ id: 'b', level: 2, title: 'Vide 2', parentId: 'root', order: 1 }),
      card({ id: 'c', level: 3, title: 'Vide 3', parentId: 'a', order: 0 }),
    ]
    const hollow = analyzeMindMapText(JSON.stringify(skeleton)).findings.find(
      entry => entry.code === 'no-definition'
    )
    expect(hollow?.count).toBe(3)
    expect(hollow?.samples).toEqual(['Vide 1', 'Vide 2', 'Vide 3'])
  })

  it('never blames the root for having no definition: a root is a subject', () => {
    const report = analyzeMindMapText(JSON.stringify(healthy()))
    expect(report.findings.map(entry => entry.code)).not.toContain('no-definition')
  })

  it('never blames a media card for having no definition', () => {
    const cards = [
      ...healthy(),
      card({ id: 'img', level: 2, title: 'Schéma', kind: 'media', parentId: 'root', order: 2 }),
    ]
    expect(codes(JSON.stringify(cards))).not.toContain('no-definition')
  })

  it('flags an untitled card', () => {
    const cards = [...healthy(), card({ id: 'x', level: 2, title: '  ', definition: 'quelque chose', parentId: 'root', order: 2 })]
    expect(codes(JSON.stringify(cards))).toContain('untitled')
  })

  it('flags two siblings sharing a title, which review cannot tell apart', () => {
    const cards = [
      ...healthy(),
      card({ id: 'dup', level: 2, title: 'Coefficient directeur', definition: 'encore', parentId: 'root', order: 2 }),
    ]
    expect(codes(JSON.stringify(cards))).toContain('duplicate-siblings')
  })

  it('accepts the same title under two different parents: context distinguishes them', () => {
    const cards = [
      ...healthy(),
      card({ id: 'd', level: 2, title: 'Exemple', definition: 'un', parentId: 'root', order: 2 }),
      card({ id: 'e', level: 3, title: 'Exemple', definition: 'deux', parentId: 'a', order: 1 }),
    ]
    expect(codes(JSON.stringify(cards))).not.toContain('duplicate-siblings')
  })

  it('flags a definition that has become a paragraph of the course', () => {
    const cards = [
      ...healthy(),
      card({ id: 'long', level: 2, title: 'Trop long', definition: 'x'.repeat(LONG_DEFINITION_CHARS + 1), parentId: 'root', order: 2 }),
    ]
    expect(codes(JSON.stringify(cards))).toContain('long-definition')
  })

  it('warns that a pasted card referencing an image will render nothing', () => {
    const cards = [
      ...healthy(),
      card({
        id: 'img',
        level: 2,
        title: 'Schéma',
        parentId: 'root',
        order: 2,
        content: [{ kind: 'image', asset: 'abc123.png', alt: 'schéma', width: 100, height: 80 }],
      }),
    ]
    expect(codes(JSON.stringify(cards))).toContain('images')
  })

  it('flags a map that is only its root', () => {
    expect(codes(JSON.stringify([card({ id: 'root', title: 'Seule' })]))).toContain('root-only')
  })

  it('flags a two-level tree as the list it really is', () => {
    const flat = [
      card({ id: 'root', title: 'Chapitre', parentId: null, order: 0 }),
      card({ id: 'a', level: 2, title: 'Un', definition: '1', parentId: 'root', order: 0 }),
      card({ id: 'b', level: 2, title: 'Deux', definition: '2', parentId: 'root', order: 1 }),
    ]
    expect(codes(JSON.stringify(flat))).toContain('flat')
  })

  it('says nothing about flatness once a third level exists', () => {
    expect(codes(JSON.stringify(healthy()))).not.toContain('flat')
  })
})

describe('qualityWarnings', () => {
  it('flags a floating card as unrevisable rather than as an error', () => {
    const cards = [...healthy(), card({ id: 'float', level: 2, title: 'Brouillon', parentId: null, order: 0, detached: true })]
    const warnings = qualityWarnings(cards)
    expect(warnings.map(entry => entry.code)).toContain('detached')
    expect(warnings.every(entry => entry.severity === 'warning')).toBe(true)
  })
})

describe('stats', () => {
  it('counts what the editor shows at a glance', () => {
    const stats = analyzeMindMapText(JSON.stringify(healthy())).stats
    expect(stats).toMatchObject({ total: 4, detached: 0, withDefinition: 3, withImages: 0, depth: 3 })
    expect(stats?.byLevel).toEqual({ 1: 1, 2: 2, 3: 1, 4: 0 })
  })
})

describe('repairMindMapText', () => {
  it('turns a file the canvas would refuse into one it accepts', () => {
    const broken = [...healthy(), card({ id: 'second-root', level: 1, title: 'Autre racine', parentId: null, order: 9 })]
    const repaired = repairMindMapText(JSON.stringify(broken))

    expect(repaired).not.toBeNull()
    expect(analyzeMindMapText(JSON.stringify(repaired)).saveable).toBe(true)
  })

  it('has nothing to repair in a text it cannot even read', () => {
    expect(repairMindMapText('pas du json')).toBeNull()
  })
})
