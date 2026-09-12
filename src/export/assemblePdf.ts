import { jsPDF } from 'jspdf'
import type { CapturedPage } from './renderPagesToImages'

/** A4 landscape, in mm, with a 10mm margin on every side. */
const PAGE_WIDTH_MM = 297
const PAGE_HEIGHT_MM = 210
const MARGIN_MM = 10

/**
 * The jsPDF image compression level, and the whole difference between a usable
 * export and a useless one.
 *
 * `addImage` takes compression as its EIGHTH argument, and jsPDF resolves a
 * missing one to `"NONE"` rather than to a default: the page raster is then
 * written as raw RGB plus a raw alpha mask, with no `/Filter` at all. A single
 * A4 page of a five-card map weighed 11.7 MB that way — 9 216 000 bytes of RGB
 * plus 3 072 000 of alpha for a 1920x1600 capture, the file size to the byte —
 * and the cost multiplies with every page.
 *
 * `SLOW` is simply the highest zlib level jsPDF offers: deflate, therefore
 * lossless. It changes the file size and nothing else — that same page came out
 * at 243 KB once it was named.
 */
const IMAGE_COMPRESSION = 'SLOW'

/**
 * Assembles captured page images into a multi-page A4 landscape PDF: one
 * image per page, scaled down (never up) to fit inside the printable
 * margin while preserving its aspect ratio, and centred on the page.
 */
export function assemblePdf(pages: CapturedPage[]): Uint8Array {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const maxWidth = PAGE_WIDTH_MM - 2 * MARGIN_MM
  const maxHeight = PAGE_HEIGHT_MM - 2 * MARGIN_MM

  pages.forEach((page, index) => {
    if (index > 0) doc.addPage()
    const scale = Math.min(maxWidth / page.width, maxHeight / page.height, 1)
    const width = page.width * scale
    const height = page.height * scale
    const x = MARGIN_MM + (maxWidth - width) / 2
    const y = MARGIN_MM + (maxHeight - height) / 2
    doc.addImage(page.dataUrl, 'PNG', x, y, width, height, undefined, IMAGE_COMPRESSION)
  })

  return new Uint8Array(doc.output('arraybuffer') as ArrayBuffer)
}
