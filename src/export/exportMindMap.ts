import type { Card } from '../types/card'
import { paginateForExport } from './pagination'
import { renderPagesToImages } from './renderPagesToImages'
import { assemblePdf } from './assemblePdf'
import { inlineAssets } from './inlineAssets'

export interface ExportOptions {
  showDefinitions: boolean
  includeDetached: boolean
  /**
   * The open map, needed to find its asset sidecar. `null` exports without
   * images — they then render as named placeholders rather than aborting the
   * capture.
   */
  mindMapPath?: string | null
}

export async function exportToPdfBytes(cards: Card[], options: ExportOptions): Promise<Uint8Array> {
  const pages = paginateForExport(cards, { includeDetached: options.includeDetached })
  const captured = await renderPagesToImages(pages, options.showDefinitions, await resolverFor(cards, options))
  return assemblePdf(captured)
}

/**
 * Assets must be data URIs BEFORE anything is captured: `html-to-image`
 * rejects the entire page when it meets an image it cannot re-encode, and
 * Tauri serves assets from a different origin than the page.
 */
async function resolverFor(cards: Card[], options: ExportOptions): Promise<(asset: string) => string> {
  const inlined = await inlineAssets(cards, options.mindMapPath ?? null)
  return asset => inlined.get(asset) ?? ''
}

/** One PNG data URL per export page — several when the tree needed more than one page. */
export async function exportToImageDataUrls(cards: Card[], options: ExportOptions): Promise<string[]> {
  const pages = paginateForExport(cards, { includeDetached: options.includeDetached })
  const captured = await renderPagesToImages(pages, options.showDefinitions, await resolverFor(cards, options))
  return captured.map(page => page.dataUrl)
}
