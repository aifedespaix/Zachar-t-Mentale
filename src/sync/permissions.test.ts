import { describe, it, expect } from 'vitest'
import { canReorder } from './permissions'
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
