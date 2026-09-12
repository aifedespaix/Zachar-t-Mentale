import { describe, it, expect } from 'vitest'
import { canClassify, canReorder } from './permissions'
import type { MindMapMeta, SyncUser } from '../types/card'

const AIFE: SyncUser = { username: 'aife', role: 'prof' }
const ELEVE: SyncUser = { username: 'eleve1', role: 'eleve' }

const AIFE_MAP: MindMapMeta = {
  id: 'file-1',
  author: 'aife',
  role: 'prof',
  lastModified: '2026-01-01T00:00:00.000Z',
}
const ELEVE_MAP: MindMapMeta = { ...AIFE_MAP, id: 'file-2', author: 'eleve1', role: 'eleve' }

describe('canReorder', () => {
  it('lets anyone rearrange a map with no sync identity — it belongs to nobody', () => {
    expect(canReorder(null, ELEVE)).toBe(true)
  })

  it('lets an author rearrange their own map', () => {
    expect(canReorder(ELEVE_MAP, ELEVE)).toBe(true)
    expect(canReorder(AIFE_MAP, AIFE)).toBe(true)
  })

  it('refuses an eleve on someone else s map', () => {
    expect(canReorder(AIFE_MAP, ELEVE)).toBe(false)
  })

  it('lets a prof rearrange anyone s map, which is how a class folder is reorganised', () => {
    expect(canReorder(ELEVE_MAP, AIFE)).toBe(true)
  })
})

describe('canClassify', () => {
  it('refuses a draft: there is no meta to write a type into', () => {
    // Décision de cadrage n°5 : créer → publier → classer. Le sync applique la
    // même règle que l'interface, donc il ne peut pas classer un brouillon.
    expect(canClassify(null, AIFE)).toBe(false)
    expect(canClassify(null, ELEVE)).toBe(false)
  })

  it('lets an author classify their own map', () => {
    expect(canClassify(AIFE_MAP, AIFE)).toBe(true)
    expect(canClassify(ELEVE_MAP, ELEVE)).toBe(true)
  })

  it('lets a prof classify an eleve s map, which is the shared use case', () => {
    expect(canClassify(ELEVE_MAP, AIFE)).toBe(true)
  })

  it('refuses an eleve the type of a map they do not own', () => {
    expect(canClassify(AIFE_MAP, ELEVE)).toBe(false)
  })
})
