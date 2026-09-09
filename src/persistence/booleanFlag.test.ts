import { describe, it, expect, beforeEach } from 'vitest'
import { createBooleanFlagStorage } from './booleanFlag'

describe('createBooleanFlagStorage', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to the fallback when nothing was ever saved', () => {
    const storage = createBooleanFlagStorage({ key: 'test:flag', fallback: false })
    expect(storage.load()).toBe(false)
  })

  it('restores a saved true value', () => {
    const storage = createBooleanFlagStorage({ key: 'test:flag', fallback: false })
    storage.save(true)
    expect(storage.load()).toBe(true)
  })

  it('restores a saved false value even when the fallback is true', () => {
    const storage = createBooleanFlagStorage({ key: 'test:flag', fallback: true })
    storage.save(false)
    expect(storage.load()).toBe(false)
  })

  it('falls back for an unparsable stored value instead of trusting it', () => {
    localStorage.setItem('test:flag', 'nope')
    const storage = createBooleanFlagStorage({ key: 'test:flag', fallback: true })
    expect(storage.load()).toBe(true)
  })
})
