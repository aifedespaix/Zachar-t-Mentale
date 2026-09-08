// src/components/sidebar/ExportDialog.tsx
import { useState } from 'react'
import type { Card } from '../../types/card'
import { exportToPdfBytes, exportToImageDataUrls } from '../../export/exportMindMap'
import { writeXmindFile } from '../../xmind/exportXmind'
import { saveBytesAs } from '../../persistence/exportIO'
import { describeExportError } from '../../export/describeExportError'
import { mindMapBaseName } from '../../persistence/paths'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Button } from '../ui/button'

type ExportFormat = 'pdf' | 'image' | 'xmind'

export interface ExportDialogProps {
  fileName: string
  /**
   * Full path of the map, used to find its asset sidecar. Distinct from
   * `fileName`, which only names the export file the user is offered.
   */
  filePath?: string | null
  cards: Card[]
  open: boolean
  onClose: () => void
  onError: (message: string) => void
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] ?? ''
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function ExportDialog({ fileName, filePath, cards, open, onClose, onError }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('pdf')
  const [showDefinitions, setShowDefinitions] = useState(true)
  const [includeDetached, setIncludeDetached] = useState(false)
  const [exporting, setExporting] = useState(false)
  const baseName = mindMapBaseName(fileName)

  async function handleExport() {
    setExporting(true)
    try {
      const options = { showDefinitions, includeDetached, mindMapPath: filePath ?? null }
      let saved = false
      if (format === 'pdf') {
        const bytes = await exportToPdfBytes(cards, options)
        const path = await saveBytesAs(bytes, `${baseName}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }])
        saved = path !== null
      } else if (format === 'image') {
        const dataUrls = await exportToImageDataUrls(cards, options)
        saved = dataUrls.length > 0
        for (const [index, dataUrl] of dataUrls.entries()) {
          const suffix = dataUrls.length > 1 ? ` (${index + 1})` : ''
          // Cancelling any one page's save dialog stops the whole batch —
          // asking for a destination once per page with no way out
          // otherwise would trap the user in N unavoidable dialogs.
          const path = await saveBytesAs(dataUrlToBytes(dataUrl), `${baseName}${suffix}.png`, [
            { name: 'Image PNG', extensions: ['png'] },
          ])
          if (path === null) {
            saved = false
            break
          }
        }
      } else {
        const bytes = await writeXmindFile(includeDetached ? cards : cards.filter(c => !c.detached))
        const path = await saveBytesAs(bytes, `${baseName}.xmind`, [{ name: 'XMind', extensions: ['xmind'] }])
        saved = path !== null
      }
      // A cancelled native save dialog isn't an error (see saveBytesAs's
      // contract) — leave the dialog open with no message, as if nothing
      // happened, rather than closing it as though the export succeeded.
      if (saved) onClose()
    } catch (error) {
      onError(`Échec de l’export : ${describeExportError(error)}`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Exporter « {baseName} »</DialogTitle>
        </DialogHeader>
        <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="radio" name="export-format" checked={format === 'pdf'} onChange={() => setFormat('pdf')} />
            PDF
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="radio" name="export-format" checked={format === 'image'} onChange={() => setFormat('image')} />
            Image
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="radio" name="export-format" checked={format === 'xmind'} onChange={() => setFormat('xmind')} />
            XMind
          </label>
        </fieldset>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={showDefinitions}
            disabled={format === 'xmind'}
            onChange={e => setShowDefinitions(e.target.checked)}
          />
          Afficher les définitions
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={includeDetached} onChange={e => setIncludeDetached(e.target.checked)} />
          Inclure les cartes volantes
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={exporting}>
            Annuler
          </Button>
          <Button onClick={handleExport} disabled={exporting}>
            {exporting ? 'Export en cours…' : 'Exporter'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
