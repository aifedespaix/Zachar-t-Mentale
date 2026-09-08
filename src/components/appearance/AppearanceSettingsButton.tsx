import { useState } from 'react'
import { Palette } from 'lucide-react'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { AppearanceSettingsDialog } from './AppearanceSettingsDialog'

export function AppearanceSettingsButton() {
  const [open, setOpen] = useState(false)

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Apparence" onClick={() => setOpen(true)}>
            <Palette />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Apparence</TooltipContent>
      </Tooltip>
      <AppearanceSettingsDialog open={open} onOpenChange={setOpen} />
    </TooltipProvider>
  )
}
