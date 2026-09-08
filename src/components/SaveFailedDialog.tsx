import { AlertTriangle } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog'
import { Button } from './ui/button'

interface SaveFailedDialogProps {
  /** e.g. "La sauvegarde a échoué : disque plein". */
  message: string
  /** What continuing actually does: "Ouvrir quand même", "Quitter quand même". */
  continueLabel: string
  onCancel: () => void
  onContinue: () => void
}

/**
 * Shown only when a flushed autosave FAILS right before an action that would
 * otherwise leave the change behind (switching files, closing the window).
 * The normal path — flush succeeds — never shows this; it exists purely so a
 * failure is a decision instead of silent data loss.
 */
export function SaveFailedDialog({ message, continueLabel, onCancel, onContinue }: SaveFailedDialogProps) {
  return (
    <Dialog open onOpenChange={open => !open && onCancel()}>
      <DialogContent role="alertdialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} style={{ flexShrink: 0, color: 'var(--warning-fg)' }} />
            {message}
          </DialogTitle>
          <DialogDescription>
            Continuer maintenant perdra ce changement. Vous pouvez aussi annuler et réessayer.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Annuler
          </Button>
          <Button variant="destructive" onClick={onContinue}>
            {continueLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
