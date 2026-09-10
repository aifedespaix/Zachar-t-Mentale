import type { Card } from '../types/card'
import { exportToPdfBytes, exportToImageDataUrls } from './exportMindMap'
import { writeXmindFile } from '../xmind/exportXmind'
import { saveBytesAs, dataUrlToBytes } from '../persistence/exportIO'
import { mindMapBaseName } from '../persistence/paths'

export type QuickExportFormat = 'pdf' | 'image' | 'xmind'

/**
 * A one-step export of the cards on screen: pick a destination, write the file.
 *
 * The difference with `ExportDialog` is deliberate — that one is where you go
 * to CHOOSE (definitions on or off, floating cards in or out, pagination); this
 * is the shortcut for when you already know, and it exports everything you can
 * see. Shared by the canvas's « Exporter » menu and the header's export
 * shortcut so those two can never disagree about what "everything" means.
 *
 * Throws on failure, and returns normally on a cancelled save dialog — a
 * cancel is not an error (see `saveBytesAs`).
 */
export async function quickExport(
  format: QuickExportFormat,
  cards: Card[],
  mindMapPath: string | null
): Promise<void> {
  const options = { showDefinitions: true, includeDetached: true, mindMapPath }
  const baseName = mindMapPath ? mindMapBaseName(mindMapPath) : 'carte-mentale'

  if (format === 'pdf') {
    const bytes = await exportToPdfBytes(cards, options)
    await saveBytesAs(bytes, `${baseName}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }])
    return
  }
  if (format === 'image') {
    const dataUrls = await exportToImageDataUrls(cards, options)
    for (const [index, dataUrl] of dataUrls.entries()) {
      const suffix = dataUrls.length > 1 ? ` (${index + 1})` : ''
      // Cancelling one page's save dialog stops the batch: asking for a
      // destination once per page with no way out would trap the user.
      const path = await saveBytesAs(dataUrlToBytes(dataUrl), `${baseName}${suffix}.png`, [
        { name: 'Image PNG', extensions: ['png'] },
      ])
      if (path === null) break
    }
    return
  }
  const bytes = await writeXmindFile(cards)
  await saveBytesAs(bytes, `${baseName}.xmind`, [{ name: 'XMind', extensions: ['xmind'] }])
}
