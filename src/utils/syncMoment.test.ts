import { describe, it, expect } from 'vitest'
import { formatSyncMoment } from './syncMoment'

describe('formatSyncMoment', () => {
  it('reads the space-separated stamp PocketBase writes', () => {
    expect(formatSyncMoment('2026-09-10 19:00:00.000Z')).toContain('2026')
  })

  it('reads an ISO stamp too', () => {
    expect(formatSyncMoment('2026-09-10T19:00:00.000Z')).toContain('2026')
  })

  it('hands back an unparseable value rather than « Invalid Date »', () => {
    expect(formatSyncMoment('pas une date')).toBe('pas une date')
  })
})
