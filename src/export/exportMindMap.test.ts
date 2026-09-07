import { describe, it, expect, vi } from 'vitest'

vi.mock('./pagination', () => ({ paginateForExport: vi.fn(() => [{ cards: [] }]) }))
vi.mock('./renderPagesToImages', () => ({
  renderPagesToImages: vi.fn(async () => [{ dataUrl: 'data:image/png;base64,X', width: 1, height: 1 }]),
}))
vi.mock('./assemblePdf', () => ({ assemblePdf: vi.fn(() => new Uint8Array([1, 2, 3])) }))

import { paginateForExport } from './pagination'
import { renderPagesToImages } from './renderPagesToImages'
import { assemblePdf } from './assemblePdf'
import { exportToPdfBytes, exportToImageDataUrls } from './exportMindMap'
import type { Card } from '../types/card'

const cards: Card[] = [{ id: 'root', level: 1, title: 'R', parentId: null, order: 0 }]

describe('exportToPdfBytes', () => {
  it('paginates, renders, and assembles a PDF', async () => {
    const bytes = await exportToPdfBytes(cards, { showDefinitions: true, includeDetached: false })
    expect(paginateForExport).toHaveBeenCalledWith(cards, { includeDetached: false })
    expect(renderPagesToImages).toHaveBeenCalledWith([{ cards: [] }], true)
    expect(assemblePdf).toHaveBeenCalled()
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]))
  })
})

describe('exportToImageDataUrls', () => {
  it('returns one data URL per captured page', async () => {
    const urls = await exportToImageDataUrls(cards, { showDefinitions: false, includeDetached: true })
    expect(paginateForExport).toHaveBeenCalledWith(cards, { includeDetached: true })
    expect(urls).toEqual(['data:image/png;base64,X'])
  })
})
