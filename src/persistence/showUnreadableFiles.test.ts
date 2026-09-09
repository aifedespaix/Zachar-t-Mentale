import { describe, it, expect, beforeEach } from 'vitest'
import { loadShowUnreadableFiles, saveShowUnreadableFiles } from './showUnreadableFiles'

describe('loadShowUnreadableFiles / saveShowUnreadableFiles', () => {
  beforeEach(() => localStorage.clear())

  it('is hidden by default', () => {
    expect(loadShowUnreadableFiles()).toBe(false)
  })

  it('restores the choice saved by a previous session', () => {
    saveShowUnreadableFiles(true)
    expect(loadShowUnreadableFiles()).toBe(true)
  })
})
