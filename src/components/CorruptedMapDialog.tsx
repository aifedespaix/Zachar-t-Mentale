import { AlertTriangle } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog'
import { Button } from './ui/button'
import { summarizeIssues, type CardIssue } from '../validation/cardsValidation'

/**
 * The exact sentence the user is asked to decide on. Exported so the wording —
 * the only thing they read before choosing — is pinned by a test.
 */
export const CORRUPTED_MAP_MESSAGE =
  'Impossible d’ouvrir cette carte car sa structure est corrompue (ex: éléments hors limites ou parents introuvables). Voulez-vous que l’application tente de la réparer ?'

interface CorruptedMapDialogProps {
  /** The file that failed validation, named so the user knows which map this is about. */
  fileName: string
  /** Where the repaired copy would go, named up front: nothing is overwritten. */
  repairedFileName: string
  issues: CardIssue[]
  /** True while the copy is being written, so the action cannot be fired twice. */
  repairing: boolean
  /** A failed repair, shown in place rather than closing the dialog on an error. */
  error: string | null
  onCancel: () => void
  onRepair: () => void
}

export function CorruptedMapDialog({
  fileName,
  repairedFileName,
  issues,
  repairing,
  error,
  onCancel,
  onRepair,
}: CorruptedMapDialogProps) {
  return (
    <Dialog open onOpenChange={open => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{CORRUPTED_MAP_MESSAGE}</DialogTitle>
          <DialogDescription>
            <span style={{ display: 'block' }}>
              Fichier concerné : <strong>{fileName}</strong>
            </span>
            <span style={{ display: 'block', marginTop: 8 }}>
              L’original ne sera pas modifié. La réparation écrit une copie nommée{' '}
              <strong>{repairedFileName}</strong> : les cartes valides gardent leur place, les cartes
              problématiques sont détachées et deviennent des cartes volantes (brouillon).
            </span>
          </DialogDescription>
        </DialogHeader>

        {issues.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--muted-foreground)' }}>
            {summarizeIssues(issues).map(line => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}

        {error && (
          <p
            role="alert"
            style={{ display: 'flex', alignItems: 'flex-start', gap: 6, margin: 0, fontSize: 13, color: '#b45309' }}
          >
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{error}</span>
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={repairing}>
            Annuler
          </Button>
          <Button onClick={onRepair} disabled={repairing}>
            {repairing ? 'Réparation…' : 'Créer une copie réparée'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
