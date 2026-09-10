import { describe, it, expect } from 'vitest'
import { syncResultLabel } from './syncResultLabel'
import type { SyncResult } from './syncService'

/** A finished run, with only what a test cares about spelled out. */
function result(overrides: Partial<SyncResult> = {}): SyncResult {
  return { pushed: 0, pulled: 0, errors: [], cancelled: false, conflicts: [], transferred: [], ...overrides }
}

describe('syncResultLabel', () => {
  it('reads as the two counters of the run', () => {
    expect(syncResultLabel(result({ pushed: 3, pulled: 2 }))).toBe('3 envoyé(s), 2 reçu(s)')
  })

  it('names a run that moved nothing, rather than rendering an empty string', () => {
    expect(syncResultLabel(result())).toBe('0 envoyé(s), 0 reçu(s)')
  })

  it('appends the failure count only when the batch had failures', () => {
    const errors = [{ fileId: 'file-1', message: 'réseau coupé' }]
    expect(syncResultLabel(result({ pushed: 1, pulled: 1, errors }))).toBe('1 envoyé(s), 1 reçu(s), 1 erreur(s)')
  })

  it('says a run was interrupted, since its counters are then partial', () => {
    expect(syncResultLabel(result({ pushed: 2, cancelled: true }))).toBe('2 envoyé(s), 0 reçu(s) (interrompue)')
  })

  it('counts the conflicts, which are reported but never resolved', () => {
    const conflicts = [{ fileId: 'f1', path: 'a.zmap', localModified: 'x', remoteUpdated: 'y' }]
    expect(syncResultLabel(result({ conflicts }))).toBe('0 envoyé(s), 0 reçu(s), 1 conflit(s)')
  })
})
