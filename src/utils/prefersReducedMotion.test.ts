import { describe, it, expect, vi, afterEach } from 'vitest'
import { prefersReducedMotion } from './prefersReducedMotion'

describe('prefersReducedMotion', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports true when the system query matches', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))

    expect(prefersReducedMotion()).toBe(true)
  })

  it('reports false when the system query does not match', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))

    expect(prefersReducedMotion()).toBe(false)
  })

  it('asks for the reduced-motion query specifically', () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: false })
    vi.stubGlobal('matchMedia', matchMedia)

    prefersReducedMotion()

    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
  })
})
