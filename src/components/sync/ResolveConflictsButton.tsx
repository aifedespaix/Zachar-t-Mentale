import { GitCompareArrows } from 'lucide-react'
import { Button } from '../ui/button'

/**
 * Le chemin vers la résolution, posé SUR le message qui annonce les conflits.
 *
 * C'est là, et pas ailleurs, parce que c'est là que l'utilisateur apprend qu'il
 * y en a : un bouton rangé dans les réglages obligerait à retenir un mot
 * (« conflit ») puis à aller le chercher, et la plupart du temps la carte
 * resterait en l'état. Le compte est dans le libellé — on sait combien de
 * décisions on s'apprête à prendre avant de cliquer.
 */
export function ResolveConflictsButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <Button variant="outline" size="xs" onClick={onClick}>
      <GitCompareArrows size={12} /> Résoudre {count > 1 ? `les ${count} conflits` : 'le conflit'}
    </Button>
  )
}
