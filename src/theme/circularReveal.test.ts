import { describe, it, expect, vi, afterEach } from 'vitest'
import { startCircularThemeTransition } from './circularReveal'

describe('startCircularThemeTransition', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (document as { startViewTransition?: unknown }).startViewTransition
  })

  it('applies the change directly when the View Transitions API is unavailable', () => {
    const apply = vi.fn()
    startCircularThemeTransition({ x: 10, y: 10, apply })
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('applies the change directly when reduced motion is requested, even if the API is available', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    const startViewTransition = vi.fn()
    ;(document as { startViewTransition?: unknown }).startViewTransition = startViewTransition
    const apply = vi.fn()

    startCircularThemeTransition({ x: 10, y: 10, apply })

    expect(apply).toHaveBeenCalledTimes(1)
    expect(startViewTransition).not.toHaveBeenCalled()
  })

  it('runs apply() inside startViewTransition and animates a circle from the click point to the farthest corner', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
    vi.stubGlobal('innerWidth', 1000)
    vi.stubGlobal('innerHeight', 800)
    const apply = vi.fn()
    const animate = vi.fn()
    document.documentElement.animate = animate
    const startViewTransition = vi.fn((cb: () => void) => {
      cb()
      return { ready: Promise.resolve() }
    })
    ;(document as { startViewTransition?: unknown }).startViewTransition = startViewTransition

    startCircularThemeTransition({ x: 200, y: 100, apply })
    await Promise.resolve()
    await Promise.resolve()

    expect(apply).toHaveBeenCalledTimes(1)
    expect(startViewTransition).toHaveBeenCalledWith(apply)
    const expectedRadius = Math.hypot(Math.max(200, 800), Math.max(100, 700))
    expect(animate).toHaveBeenCalledWith(
      { clipPath: ['circle(0px at 200px 100px)', `circle(${expectedRadius}px at 200px 100px)`] },
      { duration: 500, easing: 'ease-in-out', pseudoElement: '::view-transition-new(root)' }
    )
  })
})
