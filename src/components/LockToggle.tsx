import { Lock, LockOpen } from 'lucide-react'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'
import { useCardsStore } from '../state/useCardsStore'

export function LockToggle() {
  const locked = useCardsStore(s => s.locked)
  const toggleLock = useCardsStore(s => s.toggleLock)
  const label = locked ? 'Déverrouiller la carte mentale' : 'Verrouiller la carte mentale'

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant={locked ? 'default' : 'outline'} size="icon" aria-label={label} onClick={toggleLock}>
            {locked ? <Lock /> : <LockOpen />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
