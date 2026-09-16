import { describe, it, expect, beforeEach } from 'vitest'
import { loadDescriptionNarrow, saveDescriptionNarrow } from './descriptionNarrow'

describe('loadDescriptionNarrow / saveDescriptionNarrow', () => {
  beforeEach(() => localStorage.clear())

  it('ouvre large par défaut', () => {
    expect(loadDescriptionNarrow()).toBe(false)
  })

  it('restores the choice saved by a previous session', () => {
    saveDescriptionNarrow(true)
    expect(loadDescriptionNarrow()).toBe(true)
  })
})
