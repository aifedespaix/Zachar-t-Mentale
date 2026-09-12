import { describe, it, expect } from 'vitest'
import { reconcileType, seedLastSyncedType } from './typeReconciliation'

const LOCAL = 'cours' as const
const OTHER = 'exo' as const

describe('seedLastSyncedType', () => {
  it('anchors an unknown entry on default — never on the local type', () => {
    // Amarrer sur le type local ferait passer une classification de prof pour
    // « je n'ai pas bougé » et la laisserait écraser.
    expect(seedLastSyncedType(undefined)).toBe('default')
  })

  it('keeps a known agreement, and degrades a value from the future to default', () => {
    expect(seedLastSyncedType('exo')).toBe('exo')
    expect(seedLastSyncedType('default')).toBe('default')
    expect(seedLastSyncedType('examen')).toBe('default')
    expect(seedLastSyncedType('')).toBe('default')
  })
})

describe('reconcileType', () => {
  it('does nothing when nobody moved', () => {
    expect(reconcileType({ localType: LOCAL, lastSyncedType: LOCAL, remoteType: LOCAL })).toEqual({ kind: 'none' })
  })

  it('pushes when only I moved', () => {
    expect(reconcileType({ localType: LOCAL, lastSyncedType: 'default', remoteType: 'default' })).toEqual({
      kind: 'push-type',
    })
  })

  it('adopts when only the server moved — the prof classified my card', () => {
    expect(reconcileType({ localType: 'default', lastSyncedType: 'default', remoteType: LOCAL })).toEqual({
      kind: 'adopt',
      to: LOCAL,
      bothMoved: false,
    })
  })

  it('gives the server the win when both moved differently', () => {
    expect(reconcileType({ localType: OTHER, lastSyncedType: 'default', remoteType: LOCAL })).toEqual({
      kind: 'adopt',
      to: LOCAL,
      bothMoved: true,
    })
  })

  it('does nothing when both moved to the same type — the caller re-anchors on the server', () => {
    expect(reconcileType({ localType: LOCAL, lastSyncedType: 'default', remoteType: LOCAL })).toEqual({ kind: 'none' })
  })

  it('does nothing without a remote record', () => {
    expect(reconcileType({ localType: LOCAL, lastSyncedType: 'default', remoteType: undefined })).toEqual({
      kind: 'none',
    })
  })

  it('reads an empty remote type as default, exactly like an absent one', () => {
    expect(reconcileType({ localType: 'default', lastSyncedType: 'default', remoteType: '' })).toEqual({ kind: 'none' })
    expect(reconcileType({ localType: LOCAL, lastSyncedType: 'default', remoteType: '' })).toEqual({
      kind: 'push-type',
    })
  })
})
