import { toPng } from 'html-to-image'

/**
 * Rasterizes a mounted DOM element to a PNG data URL. `pixelRatio: 2` keeps
 * print output sharp — the on-screen card visuals are sized for a monitor,
 * not for the higher DPI a printed page benefits from.
 */
export async function captureElementAsPng(element: HTMLElement): Promise<string> {
  return toPng(element, { pixelRatio: 2 })
}
