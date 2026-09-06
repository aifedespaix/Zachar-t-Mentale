import { useState } from 'react'
import { GraduationCap } from 'lucide-react'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { QuizConfigModal } from './QuizConfigModal'

export function QuizButton() {
  const [open, setOpen] = useState(false)

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Lancer un quiz" onClick={() => setOpen(true)}>
            <GraduationCap />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Lancer un quiz</TooltipContent>
      </Tooltip>
      <QuizConfigModal open={open} onOpenChange={setOpen} />
    </TooltipProvider>
  )
}
