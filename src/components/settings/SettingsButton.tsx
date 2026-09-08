import { useState } from 'react'
import { Settings } from 'lucide-react'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { SettingsDialog } from './SettingsDialog'

/**
 * The one settings entry point. Apparence, quiz and general options used to
 * each have their own header button; folding them into tabs of a single window
 * gives the header back to the actions that actually act on the mind map.
 */
export function SettingsButton() {
  const [open, setOpen] = useState(false)

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Paramètres" onClick={() => setOpen(true)}>
            <Settings />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Paramètres</TooltipContent>
      </Tooltip>
      <SettingsDialog open={open} onOpenChange={setOpen} />
    </TooltipProvider>
  )
}
