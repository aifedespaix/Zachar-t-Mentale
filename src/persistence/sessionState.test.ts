import { describe, it, expect, beforeEach } from 'vitest'
import { loadSessionState, saveSessionState } from './sessionState'

describe('sessionState', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns an empty session when nothing was ever saved', () => {
    expect(loadSessionState()).toEqual({ currentFilePath: null, expandedPaths: [], recentFiles: [] })
  })

  it('round-trips the currently open file, the expanded folders and the recent files', () => {
    saveSessionState({
      currentFilePath: '/cours/fractions.json',
      expandedPaths: ['/cours', '/cours/maths'],
      recentFiles: [{ path: '/cours/fractions.json', openedAt: '2026-09-13T10:00:00.000Z' }],
    })

    expect(loadSessionState()).toEqual({
      currentFilePath: '/cours/fractions.json',
      expandedPaths: ['/cours', '/cours/maths'],
      recentFiles: [{ path: '/cours/fractions.json', openedAt: '2026-09-13T10:00:00.000Z' }],
    })
  })

  it('falls back to an empty session when the stored value is corrupt JSON', () => {
    localStorage.setItem('zachart-mentale:session', '{not json')

    expect(loadSessionState()).toEqual({ currentFilePath: null, expandedPaths: [], recentFiles: [] })
  })
})
