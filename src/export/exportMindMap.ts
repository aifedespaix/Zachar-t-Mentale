import type { Card } from '../types/card'
import { paginateForExport } from './pagination'
import { renderPagesToImages } from './renderPagesToImages'
import { assemblePdf } from './assemblePdf'

export interface ExportOptions {
  showDefinitions: boolean
  includeDetached: boolean
}

export async function exportToPdfBytes(cards: Card[], options: ExportOptions): Promise<Uint8Array> {
  const pages = paginateForExport(cards, { includeDetached: options.includeDetached })
  const captured = await renderPagesToImages(pages, options.showDefinitions)
  return assemblePdf(captured)
}

/** One PNG data URL per export page — several when the tree needed more than one page. */
export async function exportToImageDataUrls(cards: Card[], options: ExportOptions): Promise<string[]> {
  const pages = paginateForExport(cards, { includeDetached: options.includeDetached })
  const captured = await renderPagesToImages(pages, options.showDefinitions)
  return captured.map(page => page.dataUrl)
}
