import { describe, it, expect, beforeEach } from 'vitest'
import { loadSessionState, saveSessionState } from './sessionState'

describe('sessionState', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns an empty session when nothing was ever saved', () => {
    expect(loadSessionState()).toEqual({ currentFilePath: null, expandedPaths: [] })
  })

  it('round-trips the currently open file and the expanded folders', () => {
    saveSessionState({ currentFilePath: '/cours/fractions.json', expandedPaths: ['/cours', '/cours/maths'] })

    expect(loadSessionState()).toEqual({
      currentFilePath: '/cours/fractions.json',
      expandedPaths: ['/cours', '/cours/maths'],
    })
  })

  it('falls back to an empty session when the stored value is corrupt JSON', () => {
    localStorage.setItem('zachart-mentale:session', '{not json')

    expect(loadSessionState()).toEqual({ currentFilePath: null, expandedPaths: [] })
  })
})
