import { useState } from 'react'
import { FilePlus } from 'lucide-react'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'
import { NewMindMapDialog } from './NewMindMapDialog'

interface NewMindMapButtonProps {
  /** Where a freshly created map is opened — the app's guarded file-switch. */
  onOpenFile: (path: string) => void
}

export function NewMindMapButton({ onOpenFile }: NewMindMapButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Nouvelle carte mentale" onClick={() => setOpen(true)}>
            <FilePlus />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Nouvelle carte mentale</TooltipContent>
      </Tooltip>
      {/* Mounted only while open, so every run starts from an empty name. */}
      {open && <NewMindMapDialog onClose={() => setOpen(false)} onCreated={onOpenFile} />}
    </TooltipProvider>
  )
}
