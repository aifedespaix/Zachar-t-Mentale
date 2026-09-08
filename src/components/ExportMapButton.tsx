import { useState } from 'react'
import { Download } from 'lucide-react'
import type { Card } from '../types/card'
import { useWorkspaceStore } from '../state/useWorkspaceStore'
import { fileNameOf } from '../persistence/paths'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'
import { ExportDialog } from './sidebar/ExportDialog'

interface ExportMapButtonProps {
  /** The map actually on screen — `null` when nothing is open. */
  filePath: string | null
  cards: Card[]
}

/**
 * Exports the map currently open, from the header.
 *
 * Unlike the sidebar's per-file export, this one hands the dialog the cards
 * held in memory rather than re-reading the file: those are what the user is
 * looking at, and they are already validated (nothing reaches the canvas
 * otherwise). Re-reading would export the last autosaved state instead of the
 * current one.
 */
export function ExportMapButton({ filePath, cards }: ExportMapButtonProps) {
  const setWorkspaceError = useWorkspaceStore(s => s.setWorkspaceError)
  const [open, setOpen] = useState(false)
  const label = filePath === null ? 'Exporter (aucune carte ouverte)' : 'Exporter la carte mentale'

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label={label}
            disabled={filePath === null}
            onClick={() => setOpen(true)}
          >
            <Download />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      {open && filePath !== null && (
        <ExportDialog
          fileName={fileNameOf(filePath)}
          filePath={filePath}
          cards={cards}
          open
          onClose={() => setOpen(false)}
          onError={setWorkspaceError}
        />
      )}
    </TooltipProvider>
  )
}
