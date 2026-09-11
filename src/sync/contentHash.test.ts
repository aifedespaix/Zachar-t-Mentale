import { describe, it, expect } from 'vitest'
import { hashContent } from './contentHash'

describe('hashContent', () => {
  it('is stable for the same content', async () => {
    expect(await hashContent('{"cards":[]}')).toBe(await hashContent('{"cards":[]}'))
  })

  it('changes as soon as the content does', async () => {
    expect(await hashContent('{"cards":[]}')).not.toBe(await hashContent('{"cards":[1]}'))
  })

  it('is a short hex digest, cheap to store per file', async () => {
    expect(await hashContent('x')).toMatch(/^[0-9a-f]{16}$/)
  })
})
