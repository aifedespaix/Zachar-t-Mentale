import { useState } from 'react'
import { Settings } from 'lucide-react'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { QuizSettingsDialog } from './QuizSettingsDialog'

export function QuizSettingsButton() {
  const [open, setOpen] = useState(false)

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Paramètres du quiz" onClick={() => setOpen(true)}>
            <Settings />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Paramètres du quiz</TooltipContent>
      </Tooltip>
      <QuizSettingsDialog open={open} onOpenChange={setOpen} />
    </TooltipProvider>
  )
}
