import { useState } from 'react'
import { Lock } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'

interface ReadOnlyMapDialogProps {
  author: string
  /** `null` when nobody is logged in — there is no identity to duplicate the map as. */
  onDuplicate: (() => Promise<void>) | null
  /** Closes the dialog and leaves the map exactly as it was: open and read-only. */
  onContinue: () => void
}

/**
 * The offer made at the moment the user tries to edit a map that is not theirs.
 *
 * It replaces the old blocking overlay. A colleague's map now opens normally
 * with its lock engaged, so it can be read and studied like any other; this
 * dialog only appears when the user reaches for the lock. Refusing is a
 * first-class answer — reading someone's map without changing it is the whole
 * point of opening it — so « Continuer en lecture seule » simply closes the
 * offer and leaves the map untouched.
 */
export function ReadOnlyMapDialog({ author, onDuplicate, onContinue }: ReadOnlyMapDialogProps) {
  const [duplicating, setDuplicating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDuplicate() {
    if (!onDuplicate) return
    setDuplicating(true)
    setError(null)
    try {
      await onDuplicate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'La copie a échoué.')
    } finally {
      setDuplicating(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => !open && onContinue()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Lock size={16} aria-hidden />
            Carte de {author} — lecture seule
          </DialogTitle>
          <DialogDescription>
            {onDuplicate
              ? `Cette carte appartient à ${author} : la modifier écraserait son fichier à la prochaine synchronisation. Faites-en une copie pour la personnaliser sans toucher à l’original.`
              : `Cette carte appartient à ${author} et ne peut pas être modifiée. Connectez-vous dans les réglages pour en faire une copie.`}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--warning-fg)' }}>
            ⚠ {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onContinue} disabled={duplicating}>
            Continuer en lecture seule
          </Button>
          {onDuplicate && (
            <Button onClick={() => void handleDuplicate()} disabled={duplicating}>
              {duplicating ? 'Copie en cours…' : 'Faire ma copie'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
