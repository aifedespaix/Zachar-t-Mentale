import { describe, expect, it } from 'vitest'
import type { Card } from '@app/types/card'
import {
  findCopyGroups,
  findDuplicateGroups,
  fingerprintCards,
  originalPathOf,
  planCleanup,
  type DuplicateFile,
} from './duplicates'

/**
 * La détection de doublons se juge sur une seule chose : deux fichiers qui
 * portent exactement les mêmes cartes doivent se retrouver dans le même
 * groupe, quels que soient leur nom, leur auteur, leur type, leurs dates et
 * l'identité interne de leurs cartes — et deux fichiers qui diffèrent d'une
 * seule carte, d'une définition ou d'un lien hiérarchique ne le doivent pas.
 */

function card(id: string, title: string, parentId: string | null, extra: Partial<Card> = {}): Card {
  return {
    id,
    level: parentId === null ? 1 : 2,
    title,
    parentId,
    order: 0,
    ...extra,
  }
}

interface FileOverrides {
  id?: string
  path?: string
  author?: string
  type?: string
  created?: string
  updated?: string
  metaId?: string
}

function fileOf(cards: readonly Card[], overrides: FileOverrides = {}): DuplicateFile {
  const id = overrides.id ?? 'rec-default'
  const author = overrides.author ?? 'eleve1'
  const metaId = overrides.metaId ?? `file-${id}`
  return {
    id,
    file_id: metaId,
    author,
    path: overrides.path ?? `${id}.zmap`,
    type: overrides.type ?? 'default',
    created: overrides.created ?? '2026-09-01 10:00:00.000Z',
    updated: overrides.updated ?? '2026-09-02 10:00:00.000Z',
    content: JSON.stringify({
      meta: { id: metaId, author, role: 'eleve', lastModified: '2026-09-02T10:00:00.000Z' },
      cards,
    }),
  }
}

const ROOT = card('root', 'Chapitre 1', null)
const NOTION = card('n1', 'Notion', 'root')

describe('fingerprintCards', () => {
  it('is null when the content cannot be read', () => {
    expect(fingerprintCards('ceci n’est pas du JSON')).toBeNull()
    expect(fingerprintCards('')).toBeNull()
  })

  it('is stable across the identity and the placement of the cards', () => {
    const one = fingerprintCards(JSON.stringify({ meta: { id: 'a' }, cards: [ROOT, NOTION] }))
    const other = fingerprintCards(
      JSON.stringify({
        meta: { id: 'b' },
        cards: [{ ...ROOT, id: 'autre-root', order: 42 }, { ...NOTION, id: 'autre-notion', parentId: 'autre-root', order: 7 }],
      })
    )

    expect(one).not.toBeNull()
    expect(other).toBe(one)
  })
})

describe('findDuplicateGroups', () => {
  it('groups two files with the same cards, whatever their metadata', () => {
    const first = fileOf([ROOT, NOTION], { id: 'rec-a', path: 'Maths/Chapitre 1.zmap' })
    const copy = fileOf([{ ...ROOT, id: 'r2' }, { ...NOTION, id: 'x2', parentId: 'r2' }], {
      id: 'rec-b',
      path: 'Sauvegardes/Chapitre 1 (copie).zmap',
      author: 'prof',
      type: 'corrections',
      created: '2025-01-01 00:00:00.000Z',
      updated: '2025-06-01 00:00:00.000Z',
    })

    const groups = findDuplicateGroups([first, copy])

    expect(groups).toHaveLength(1)
    expect(groups[0].files.map(entry => entry.id).sort()).toEqual(['rec-a', 'rec-b'])
    expect(groups[0].cardCount).toBe(2)
  })

  it('ignores the declared order of sibling cards', () => {
    const first = fileOf([ROOT, { ...NOTION, order: 0 }, card('n2', 'Autre', 'root', { order: 1 })])
    const swapped = fileOf([ROOT, { ...NOTION, order: 1 }, card('n2', 'Autre', 'root', { order: 0 })], { id: 'rec-b' })

    expect(findDuplicateGroups([first, swapped])).toHaveLength(1)
  })

  it('ignores a purely mnemonic icon and surrounding whitespace', () => {
    const first = fileOf([{ ...ROOT, title: ' Chapitre 1 ' }, NOTION])
    const other = fileOf([{ ...ROOT, icon: 'Atom' }, { ...NOTION, title: 'Notion ' }], { id: 'rec-b' })

    expect(findDuplicateGroups([first, other])).toHaveLength(1)
  })

  it('does not group the same cards wired into a different hierarchy', () => {
    const mid = card('mid', 'Partie', 'root')
    const leaf = card('leaf', 'Detail', 'mid')
    const nested = fileOf([ROOT, mid, leaf])
    const flattened = fileOf([ROOT, { ...mid, parentId: 'root' }, { ...leaf, parentId: 'root' }], { id: 'rec-b' })

    expect(findDuplicateGroups([nested, flattened])).toEqual([])
  })

  it('does not group a file that has one card more', () => {
    const first = fileOf([ROOT, NOTION])
    const bigger = fileOf([ROOT, NOTION, card('n2', 'En plus', 'root')], { id: 'rec-b' })

    expect(findDuplicateGroups([first, bigger])).toEqual([])
  })

  it('does not group a file whose definition changed', () => {
    const first = fileOf([ROOT, { ...NOTION, definition: 'Texte A' }])
    const other = fileOf([ROOT, { ...NOTION, definition: 'Texte B' }], { id: 'rec-b' })

    expect(findDuplicateGroups([first, other])).toEqual([])
  })

  it('leaves unreadable files out rather than proposing them for deletion', () => {
    const broken: DuplicateFile = { ...fileOf([ROOT, NOTION], { id: 'rec-broken' }), content: 'contenu corrompu' }

    const groups = findDuplicateGroups([fileOf([ROOT, NOTION], { id: 'rec-a' }), fileOf([ROOT, NOTION], { id: 'rec-c' }), broken])

    expect(groups).toHaveLength(1)
    expect(groups[0].files.map(entry => entry.id)).toEqual(['rec-a', 'rec-c'])
  })

  it('reports nothing when every file is alone', () => {
    expect(findDuplicateGroups([fileOf([ROOT, NOTION])])).toEqual([])
    expect(findDuplicateGroups([])).toEqual([])
  })

  it('sorts groups by number of copies and members by last modification', () => {
    const pair = [fileOf([ROOT], { id: 'p1', updated: '2026-01-01 00:00:00.000Z' }), fileOf([ROOT], { id: 'p2' })]
    const triple = [
      fileOf([ROOT, NOTION], { id: 't1', updated: '2026-01-01 00:00:00.000Z' }),
      fileOf([ROOT, NOTION], { id: 't2', updated: '2026-03-01 00:00:00.000Z' }),
      fileOf([ROOT, NOTION], { id: 't3', updated: '2026-02-01 00:00:00.000Z' }),
    ]

    const groups = findDuplicateGroups([...pair, ...triple])

    expect(groups.map(group => group.files.length)).toEqual([3, 2])
    expect(groups[0].files.map(entry => entry.id)).toEqual(['t2', 't3', 't1'])
  })
})

describe('originalPathOf', () => {
  it('recognises the copy names the app used to write', () => {
    expect(originalPathOf('Maths/Chapitre 1 (copie).zmap')).toBe('Maths/Chapitre 1.zmap')
    expect(originalPathOf('Maths/Chapitre 1 (copie 3).zmap')).toBe('Maths/Chapitre 1.zmap')
    expect(originalPathOf('Chapitre 1 (Copie).json')).toBe('Chapitre 1.json')
  })

  it('is null for anything that is not a copy', () => {
    expect(originalPathOf('Maths/Chapitre 1.zmap')).toBeNull()
    expect(originalPathOf('(copie).zmap')).toBeNull()
  })
})

describe('findCopyGroups', () => {
  it('groups an original with its sync copies, most recently modified first', () => {
    const original = fileOf([ROOT], { id: 'o', path: 'Maths/Ch 1.zmap', updated: '2026-01-01 00:00:00.000Z' })
    const copy = fileOf([ROOT, NOTION], { id: 'c', path: 'Maths/Ch 1 (copie).zmap', updated: '2026-03-01 00:00:00.000Z' })
    const elsewhere = fileOf([ROOT], { id: 'e', path: 'Physique/Ch 1 (copie).zmap' })

    const groups = findCopyGroups([original, copy, elsewhere])

    expect(groups).toHaveLength(1)
    expect(groups[0].path).toBe('Maths/Ch 1.zmap')
    expect(groups[0].original?.id).toBe('o')
    expect(groups[0].files.map(file => file.id)).toEqual(['c', 'o'])
  })

  it('judges by the edit date written in the content, not by the server revision', () => {
    const edited = (id: string, path: string, lastModified: string, updated: string): DuplicateFile => ({
      ...fileOf([ROOT], { id, path, updated }),
      content: JSON.stringify({ meta: { id, author: 'eleve1', role: 'eleve', lastModified }, cards: [ROOT] }),
    })
    // L'original a été DÉPLACÉ récemment (updated), mais édité il y a longtemps.
    const original = edited('o', 'Ch.zmap', '2026-01-01T00:00:00.000Z', '2026-05-01 00:00:00.000Z')
    const copy = edited('c', 'Ch (copie).zmap', '2026-02-01T00:00:00.000Z', '2026-02-01 00:00:00.000Z')

    expect(findCopyGroups([original, copy])[0].files[0].id).toBe('c')
  })
})

describe('planCleanup', () => {
  it('keeps only the most recent of identical files', () => {
    const old = fileOf([ROOT], { id: 'old', path: 'a.zmap', updated: '2026-01-01 00:00:00.000Z' })
    const recent = fileOf([ROOT], { id: 'new', path: 'b.zmap', updated: '2026-03-01 00:00:00.000Z' })

    const plan = planCleanup([old, recent])

    expect(plan.remove.map(file => file.id)).toEqual(['old'])
    expect(plan.rewrite).toEqual([])
    expect(plan.rename).toEqual([])
  })

  it('deletes older copies when the original is the most recent', () => {
    const original = fileOf([ROOT, NOTION], { id: 'o', path: 'Ch.zmap', updated: '2026-03-01 00:00:00.000Z' })
    const copy = fileOf([ROOT], { id: 'c', path: 'Ch (copie).zmap', updated: '2026-01-01 00:00:00.000Z' })

    const plan = planCleanup([original, copy])

    expect(plan.remove.map(file => file.id)).toEqual(['c'])
    expect(plan.rewrite).toEqual([])
  })

  it('moves a more recent copy into the original — same place, same identity — then deletes the copy', () => {
    const original = fileOf([ROOT], { id: 'o', path: 'Ch.zmap', updated: '2026-01-01 00:00:00.000Z' })
    const copy = fileOf([ROOT, NOTION], { id: 'c', path: 'Ch (copie).zmap', updated: '2026-03-01 00:00:00.000Z' })

    const plan = planCleanup([original, copy])

    expect(plan.rewrite).toEqual([{ target: original, source: copy }])
    expect(plan.remove.map(file => file.id)).toEqual(['c'])
  })

  it('renames the newest of several orphan copies to the original name', () => {
    const first = fileOf([ROOT], { id: 'c1', path: 'Ch (copie).zmap', updated: '2026-01-01 00:00:00.000Z' })
    const second = fileOf([ROOT, NOTION], { id: 'c2', path: 'Ch (copie 2).zmap', updated: '2026-03-01 00:00:00.000Z' })

    const plan = planCleanup([first, second])

    expect(plan.rename).toEqual([{ file: second, path: 'Ch.zmap' }])
    expect(plan.remove.map(file => file.id)).toEqual(['c1'])
  })

  it('never keeps, in a copy group, a file the content pass already deleted', () => {
    // La copie est identique à un autre fichier plus récent : elle part dès
    // la première passe, et ne peut plus écraser l'original.
    const original = fileOf([ROOT], { id: 'o', path: 'Ch.zmap', updated: '2026-01-01 00:00:00.000Z' })
    const copy = fileOf([ROOT, NOTION], { id: 'c', path: 'Ch (copie).zmap', updated: '2026-02-01 00:00:00.000Z' })
    const twin = fileOf([ROOT, NOTION], { id: 't', path: 'Autre.zmap', updated: '2026-03-01 00:00:00.000Z' })

    const plan = planCleanup([original, copy, twin])

    expect(plan.remove.map(file => file.id)).toEqual(['c'])
    expect(plan.rewrite).toEqual([])
  })

  it('does nothing to a lone file named like a copy', () => {
    const plan = planCleanup([fileOf([ROOT], { id: 'c', path: 'Ch (copie).zmap' })])

    expect(plan).toEqual({ remove: [], rewrite: [], rename: [] })
  })
})
