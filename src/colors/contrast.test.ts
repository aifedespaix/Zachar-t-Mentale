import { describe, it, expect } from 'vitest'
import { oklchWcagContrast, pickReadableTextColor, type Oklch } from './contrast'

describe('oklchWcagContrast', () => {
  it('returns 21 for pure black vs pure white', () => {
    const black: Oklch = { l: 0, c: 0, h: 0 }
    const white: Oklch = { l: 1, c: 0, h: 0 }
    expect(oklchWcagContrast(black, white)).toBeCloseTo(21, 0)
  })

  it('returns a low ratio for two similar light colors', () => {
    const light1: Oklch = { l: 0.98, c: 0, h: 0 }
    const light2: Oklch = { l: 0.9, c: 0, h: 0 }
    expect(oklchWcagContrast(light1, light2)).toBeLessThan(4.5)
  })
})

describe('pickReadableTextColor', () => {
  it('picks near-black text against a light background', () => {
    expect(pickReadableTextColor({ l: 0.95, c: 0.03, h: 90 })).toEqual({ l: 0.18, c: 0, h: 0 })
  })

  it('picks white text against a dark, saturated background', () => {
    expect(pickReadableTextColor({ l: 0.3, c: 0.15, h: 25 })).toEqual({ l: 1, c: 0, h: 0 })
  })
})
