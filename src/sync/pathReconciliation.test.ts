// src/sync/pathReconciliation.test.ts
import { describe, it, expect } from 'vitest'
import { reconcilePath, seedLastSyncedPath } from './pathReconciliation'

describe('seedLastSyncedPath', () => {
  it('leaves a known path alone', () => {
    expect(
      seedLastSyncedPath({ lastSyncedPath: 'a.zmap', rootChanged: false, relPath: 'b.zmap', remotePath: 'c.zmap' })
    ).toBe('a.zmap')
  })

  it('seeds from the REMOTE path when the root is merely unknown (a migrated entry)', () => {
    // Racine présumée inchangée : un chemin distant périmé doit être réparé,
    // donc « j'ai bougé » doit devenir vrai.
    expect(
      seedLastSyncedPath({ lastSyncedPath: undefined, rootChanged: false, relPath: 'b.zmap', remotePath: 'a.zmap' })
    ).toBe('a.zmap')
  })

  it('seeds from the LOCAL path when the root actually changed', () => {
    // Le rangement local a changé de sens : on ne réécrit pas l'agencement du
    // serveur pour le suivre.
    expect(
      seedLastSyncedPath({ lastSyncedPath: undefined, rootChanged: true, relPath: 'b.zmap', remotePath: 'a.zmap' })
    ).toBe('b.zmap')
  })

  it('falls back to the local path when there is no remote record at all', () => {
    expect(
      seedLastSyncedPath({ lastSyncedPath: undefined, rootChanged: false, relPath: 'b.zmap', remotePath: undefined })
    ).toBe('b.zmap')
  })
})

describe('reconcilePath', () => {
  const base = { relPath: 'Chimie/atomes.zmap', lastSyncedPath: 'Chimie/atomes.zmap' }

  it('does nothing when nothing moved', () => {
    expect(reconcilePath({ ...base, remotePath: 'Chimie/atomes.zmap' })).toEqual({ kind: 'none' })
  })

  it('does nothing when there is no remote record: creating one sends the local path anyway', () => {
    expect(reconcilePath({ ...base, remotePath: undefined })).toEqual({ kind: 'none' })
  })

  it('pushes my path when I am the one who moved', () => {
    expect(reconcilePath({ relPath: 'Chimie/atomes 2.zmap', lastSyncedPath: 'Chimie/atomes.zmap', remotePath: 'Chimie/atomes.zmap' }))
      .toEqual({ kind: 'push-path' })
  })

  it('relocates locally when the server is the one that moved', () => {
    expect(reconcilePath({ relPath: 'Chimie/atomes.zmap', lastSyncedPath: 'Chimie/atomes.zmap', remotePath: 'Chimie/atomes du carbone.zmap' }))
      .toEqual({ kind: 'relocate', to: 'Chimie/atomes du carbone.zmap', bothMoved: false })
  })

  it('says nothing when both sides moved to the SAME path', () => {
    expect(reconcilePath({ relPath: 'Chimie/atomes 2.zmap', lastSyncedPath: 'Chimie/atomes.zmap', remotePath: 'Chimie/atomes 2.zmap' }))
      .toEqual({ kind: 'none' })
  })

  it('lets the server win when both sides moved differently, and says so', () => {
    expect(reconcilePath({ relPath: 'Chimie/a.zmap', lastSyncedPath: 'Chimie/atomes.zmap', remotePath: 'Chimie/b.zmap' }))
      .toEqual({ kind: 'relocate', to: 'Chimie/b.zmap', bothMoved: true })
  })
})
