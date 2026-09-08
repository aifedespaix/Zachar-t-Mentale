import { AlertTriangle } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog'
import { Button } from './ui/button'

interface SaveFailedDialogProps {
  /** e.g. "La sauvegarde a échoué : disque plein". */
  message: string
  /** Replaces the default explanation, for a failure that risks no change. */
  detail?: string
  /**
   * What continuing actually does: "Ouvrir quand même", "Quitter quand même".
   * `null` when nothing can be continued to — the dialog then offers a single
   * way out instead of a choice that cannot be honoured.
   */
  continueLabel: string | null
  onCancel: () => void
  onContinue: (() => void) | null
}

/**
 * Shown when an action that would otherwise leave a change behind cannot go
 * ahead cleanly — a flushed autosave failing right before switching files or
 * closing the window, or the window refusing to close afterwards. The normal
 * path — flush succeeds, window closes — never shows this; it exists purely so
 * a failure is a decision, or at the very least a message, instead of silence.
 */
export function SaveFailedDialog({ message, detail, continueLabel, onCancel, onContinue }: SaveFailedDialogProps) {
  const canContinue = continueLabel !== null && onContinue !== null

  return (
    <Dialog open onOpenChange={open => !open && onCancel()}>
      <DialogContent role="alertdialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} style={{ flexShrink: 0, color: 'var(--warning-fg)' }} />
            {message}
          </DialogTitle>
          <DialogDescription>
            {detail ?? 'Continuer maintenant perdra ce changement. Vous pouvez aussi annuler et réessayer.'}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant={canContinue ? 'outline' : 'default'} onClick={onCancel}>
            {canContinue ? 'Annuler' : 'Fermer ce message'}
          </Button>
          {canContinue && (
            <Button variant="destructive" onClick={onContinue}>
              {continueLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
