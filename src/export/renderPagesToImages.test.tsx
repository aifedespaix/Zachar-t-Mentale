// src/export/renderPagesToImages.test.tsx
import { describe, it, expect, vi } from 'vitest'

vi.mock('./captureElement', () => ({ captureElementAsPng: vi.fn(async () => 'data:image/png;base64,X') }))

import { captureElementAsPng } from './captureElement'
import { renderPagesToImages } from './renderPagesToImages'
import { computePageBounds } from './ExportPageRenderer'
import type { ExportPage } from './pagination'

describe('renderPagesToImages', () => {
  it('captures one image per page and leaves no DOM behind', async () => {
    const pages: ExportPage[] = [
      { cards: [{ id: 'a', level: 1, title: 'A', parentId: null, order: 0 }] },
      { cards: [{ id: 'b', level: 1, title: 'B', parentId: null, order: 0 }] },
    ]
    const results = await renderPagesToImages(pages, false)

    expect(captureElementAsPng).toHaveBeenCalledTimes(2)
    expect(results).toHaveLength(2)
    expect(results[0].dataUrl).toBe('data:image/png;base64,X')
    expect(results[0].width).toBe(computePageBounds(pages[0]).width)
    expect(results[0].height).toBe(computePageBounds(pages[0]).height)
    expect(document.querySelectorAll('[data-export-page-container]')).toHaveLength(0)
  })
})
