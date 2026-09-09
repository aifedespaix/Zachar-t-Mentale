import { describe, it, expect, beforeEach } from 'vitest'
import { loadStackMode, saveStackMode } from './stackMode'

describe('loadStackMode / saveStackMode', () => {
  beforeEach(() => localStorage.clear())

  it('is active by default', () => {
    expect(loadStackMode()).toBe(true)
  })

  it('restores the choice saved by a previous session', () => {
    saveStackMode(false)
    expect(loadStackMode()).toBe(false)
  })
})
