import { Button } from './ui/button'
import { useCardsStore } from '../state/useCardsStore'

export function LockToggle() {
  const locked = useCardsStore(s => s.locked)
  const toggleLock = useCardsStore(s => s.toggleLock)

  return (
    <Button variant={locked ? 'default' : 'outline'} onClick={toggleLock}>
      {locked ? 'Déverrouiller' : 'Verrouiller'}
    </Button>
  )
}
