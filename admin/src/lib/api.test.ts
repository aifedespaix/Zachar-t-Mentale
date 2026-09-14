import { describe, expect, it, vi } from 'vitest'

vi.mock('./pb', () => ({ pb: { collection: vi.fn(), filter: vi.fn() } }))

import { FOLDERS, MIND_MAPS, buildNewMapContent, buildUpdatedMapContent, planRelocation, planRemoval } from './api'
import type { LibraryFolder, LibraryMap } from './tree'
import type { Card } from '@app/types/card'

function map(path: string, id = `rec-${path}`): LibraryMap {
  return { id, file_id: `file-${path}`, author: 'eleve1', path, type: '', updated: '2026-09-01 10:00:00.000Z' }
}

const maps: LibraryMap[] = [
  map('Maths/Algebre/Chapitre 1.zmap'),
  map('Maths/Chapitre 0.zmap'),
  map('Maths2/Piege.zmap'),
  map('Racine.zmap'),
]

const folders: LibraryFolder[] = [
  { id: 'f-maths', path: 'Maths' },
  { id: 'f-algebre', path: 'Maths/Algebre' },
  { id: 'f-vide', path: 'Maths/Vide' },
  { id: 'f-autre', path: 'Maths2' },
]

describe('planRelocation', () => {
  it('rewrites every path a renamed folder carries, at any depth', () => {
    const plan = planRelocation(maps, folders, 'Maths', 'Mathématiques')

    expect(plan).toContainEqual({ collection: MIND_MAPS, id: 'rec-Maths/Algebre/Chapitre 1.zmap', path: 'Mathématiques/Algebre/Chapitre 1.zmap' })
    expect(plan).toContainEqual({ collection: MIND_MAPS, id: 'rec-Maths/Chapitre 0.zmap', path: 'Mathématiques/Chapitre 0.zmap' })
  })

  it('rewrites the folder record itself, and its empty sub-folders', () => {
    const plan = planRelocation(maps, folders, 'Maths', 'Mathématiques')

    expect(plan).toContainEqual({ collection: FOLDERS, id: 'f-maths', path: 'Mathématiques' })
    expect(plan).toContainEqual({ collection: FOLDERS, id: 'f-algebre', path: 'Mathématiques/Algebre' })
    // Un dossier vide se déplace comme les autres : c'est tout l'intérêt qu'il
    // existe comme enregistrement.
    expect(plan).toContainEqual({ collection: FOLDERS, id: 'f-vide', path: 'Mathématiques/Vide' })
  })

  it('never touches a sibling that merely shares the prefix', () => {
    const plan = planRelocation(maps, folders, 'Maths', 'Mathématiques')
    const touched = plan.map(entry => entry.id)

    expect(touched).not.toContain('rec-Maths2/Piege.zmap')
    expect(touched).not.toContain('f-autre')
  })

  it('never touches an unrelated file at the root', () => {
    const plan = planRelocation(maps, folders, 'Maths', 'Archive/Maths')
    expect(plan.map(entry => entry.id)).not.toContain('rec-Racine.zmap')
  })

  it('moves a single map as one update', () => {
    const plan = planRelocation(maps, folders, 'Racine.zmap', 'Maths/Racine.zmap')
    expect(plan).toEqual([{ collection: MIND_MAPS, id: 'rec-Racine.zmap', path: 'Maths/Racine.zmap' }])
  })

  it('computes every target from the state BEFORE the move, so the plan is replayable', () => {
    const plan = planRelocation(maps, folders, 'Maths', 'Maths/Algebre-bis')
    // Aucun chemin cible ne doit avoir été calculé depuis un chemin déjà réécrit.
    expect(plan.filter(entry => entry.path.includes('Algebre-bis/Algebre-bis'))).toEqual([])
  })

  it('has nothing to do when the path does not change', () => {
    expect(planRelocation(maps, folders, 'Maths', 'Maths')).toEqual([])
  })
})

describe('planRemoval', () => {
  it('takes the whole branch, cards and folders alike', () => {
    const plan = planRemoval(maps, folders, 'Maths')
    expect(plan).toContainEqual({ collection: MIND_MAPS, id: 'rec-Maths/Algebre/Chapitre 1.zmap' })
    expect(plan).toContainEqual({ collection: FOLDERS, id: 'f-maths' })
    expect(plan).toContainEqual({ collection: FOLDERS, id: 'f-algebre' })
  })

  it('spares the sibling that shares the prefix', () => {
    expect(planRemoval(maps, folders, 'Maths').map(entry => entry.id)).not.toContain('rec-Maths2/Piege.zmap')
  })

  it('deletes a single map on its own', () => {
    expect(planRemoval(maps, folders, 'Racine.zmap')).toEqual([{ collection: MIND_MAPS, id: 'rec-Racine.zmap' }])
  })
})

const cards: Card[] = [
  { id: 'root', level: 1, title: 'Chapitre', parentId: null, order: 0 },
  { id: 'a', level: 2, title: 'Notion', definition: 'x', parentId: 'root', order: 0 },
]

describe('buildNewMapContent', () => {
  it('gives the file a sync identity, without which it would be invisible to the app', () => {
    const built = buildNewMapContent(cards, 'aife', 'prof', 'cours', new Date('2026-09-14T08:00:00.000Z'))
    const parsed = JSON.parse(built.content)

    expect(parsed.meta.id).toBe(built.fileId)
    expect(parsed.meta.author).toBe('aife')
    expect(parsed.meta.role).toBe('prof')
    expect(parsed.meta.lastModified).toBe('2026-09-14T08:00:00.000Z')
    expect(parsed.cards).toHaveLength(2)
  })

  it('falls back to « sans type » for a type the app does not know', () => {
    const built = buildNewMapContent(cards, 'aife', 'prof', 'n’importe quoi')
    expect(JSON.parse(built.content).meta.type).toBe('default')
  })
})

describe('buildUpdatedMapContent', () => {
  it('leaves the author alone: correcting a pupil’s card does not take it from them', () => {
    const previous = JSON.stringify({
      meta: { id: 'file-1', author: 'eleve1', role: 'eleve', lastModified: '2026-01-01T00:00:00.000Z' },
      cards: [],
    })
    const updated = buildUpdatedMapContent(previous, cards, 'aife', 'prof', new Date('2026-09-14T08:00:00.000Z'))

    expect(updated.meta.id).toBe('file-1')
    expect(updated.meta.author).toBe('eleve1')
    expect(updated.meta.role).toBe('eleve')
    // Seule la date bouge — c'est elle qui dit au client qu'il y a du nouveau.
    expect(updated.meta.lastModified).toBe('2026-09-14T08:00:00.000Z')
  })

  it('gives an identity to a record that somehow had none, rather than writing one without', () => {
    const updated = buildUpdatedMapContent('[]', cards, 'aife', 'prof')
    expect(updated.meta.author).toBe('aife')
    expect(updated.meta.id).not.toBe('')
  })

  it('survives a previous content that is not even JSON', () => {
    const updated = buildUpdatedMapContent('cassé', cards, 'aife', 'prof')
    expect(JSON.parse(updated.content).cards).toHaveLength(2)
  })
})
