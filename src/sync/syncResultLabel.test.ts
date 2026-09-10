import { describe, it, expect } from 'vitest'
import { syncResultLabel } from './syncResultLabel'

describe('syncResultLabel', () => {
  it('reads as the two counters of the run', () => {
    expect(syncResultLabel({ pushed: 3, pulled: 2, errors: [] })).toBe('3 envoyé(s), 2 reçu(s)')
  })

  it('names a run that moved nothing, rather than rendering an empty string', () => {
    expect(syncResultLabel({ pushed: 0, pulled: 0, errors: [] })).toBe('0 envoyé(s), 0 reçu(s)')
  })

  it('appends the failure count only when the batch had failures', () => {
    const errors = [{ fileId: 'file-1', message: 'réseau coupé' }]
    expect(syncResultLabel({ pushed: 1, pulled: 1, errors })).toBe('1 envoyé(s), 1 reçu(s), 1 erreur(s)')
  })
})
