import { toPng } from 'html-to-image'

/**
 * Rasterizes a mounted DOM element to a PNG data URL. `pixelRatio: 2` keeps
 * print output sharp — the on-screen card visuals are sized for a monitor,
 * not for the higher DPI a printed page benefits from. `style` overrides the
 * off-screen container's own `position: fixed; left: -99999px` (needed to
 * keep it out of the visible viewport) on the CLONE html-to-image rasterizes
 * — without this, the clone inherits that same off-screen positioning and
 * renders empty, since html-to-image copies the full computed style onto the
 * clone before applying `options.style` last.
 */
export async function captureElementAsPng(element: HTMLElement): Promise<string> {
  return toPng(element, { pixelRatio: 2, style: { position: 'static', left: '0px', top: '0px' } })
}
