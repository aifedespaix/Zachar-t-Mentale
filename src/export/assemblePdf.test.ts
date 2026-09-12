import { describe, it, expect, vi, beforeEach } from 'vitest'

const addImage = vi.fn()
const addPage = vi.fn()
const output = vi.fn(() => new ArrayBuffer(4))
vi.mock('jspdf', () => ({
  jsPDF: vi.fn().mockImplementation(function() { return { addImage, addPage, output } }),
}))

import { assemblePdf } from './assemblePdf'
import type { CapturedPage } from './renderPagesToImages'

describe('assemblePdf', () => {
  beforeEach(() => {
    addImage.mockClear()
    addPage.mockClear()
  })

  it('adds one image per page and a new PDF page between each', () => {
    const pages: CapturedPage[] = [
      { dataUrl: 'data:image/png;base64,A', width: 640, height: 480 },
      { dataUrl: 'data:image/png;base64,B', width: 640, height: 480 },
    ]
    const bytes = assemblePdf(pages)
    expect(addImage).toHaveBeenCalledTimes(2)
    expect(addPage).toHaveBeenCalledTimes(1)
    expect(bytes).toBeInstanceOf(Uint8Array)
  })

  it('asks jsPDF to compress each embedded page image', () => {
    // Without this 8th argument jsPDF resolves the level to "NONE" and embeds
    // the raster as raw RGB + raw alpha: a single A4 page came out at 11.7 MB
    // with no /Filter at all. The level is lossless deflate, so the only thing
    // it changes is the file size.
    assemblePdf([{ dataUrl: 'data:image/png;base64,A', width: 640, height: 480 }])
    expect(addImage).toHaveBeenCalledWith(
      'data:image/png;base64,A',
      'PNG',
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      undefined,
      'SLOW'
    )
  })

  it('adds no extra page for a single-page export', () => {
    assemblePdf([{ dataUrl: 'data:image/png;base64,A', width: 640, height: 480 }])
    expect(addPage).not.toHaveBeenCalled()
  })
})
