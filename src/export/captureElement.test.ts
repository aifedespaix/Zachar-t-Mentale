import { describe, it, expect, vi } from 'vitest'

vi.mock('html-to-image', () => ({ toPng: vi.fn(async () => 'data:image/png;base64,AAA') }))

import { toPng } from 'html-to-image'
import { captureElementAsPng } from './captureElement'

describe('captureElementAsPng', () => {
  it('delegates to html-to-image toPng at 2x pixel ratio', async () => {
    const el = document.createElement('div')
    const result = await captureElementAsPng(el)
    expect(result).toBe('data:image/png;base64,AAA')
    expect(toPng).toHaveBeenCalledWith(el, { pixelRatio: 2 })
  })
})
