// src/export/renderPagesToImages.tsx
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { ExportPageRenderer, computePageBounds } from './ExportPageRenderer'
import { captureElementAsPng } from './captureElement'
import type { ExportPage } from './pagination'

export interface CapturedPage {
  dataUrl: string
  width: number
  height: number
}

/**
 * Renders each page off-screen (fixed position, far outside the viewport —
 * a page can be larger or smaller than the window) and captures it to a PNG.
 * Pages are processed one at a time: each capture is awaited, and its DOM
 * removed, before the next page mounts.
 */
export async function renderPagesToImages(pages: ExportPage[], showDefinitions: boolean): Promise<CapturedPage[]> {
  const results: CapturedPage[] = []
  for (const page of pages) {
    const bounds = computePageBounds(page)
    const container = document.createElement('div')
    container.setAttribute('data-export-page-container', '')
    container.style.position = 'fixed'
    container.style.left = '-99999px'
    container.style.top = '0'
    container.style.width = `${bounds.width}px`
    container.style.height = `${bounds.height}px`
    document.body.appendChild(container)
    const root = createRoot(container)
    flushSync(() => {
      root.render(<ExportPageRenderer page={page} showDefinitions={showDefinitions} />)
    })
    try {
      const dataUrl = await captureElementAsPng(container)
      results.push({ dataUrl, width: bounds.width, height: bounds.height })
    } finally {
      root.unmount()
      container.remove()
    }
  }
  return results
}
