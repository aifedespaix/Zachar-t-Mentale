// src/components/sidebar/NameDialog.tsx
import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Button } from '../ui/button'

export interface NameDialogProps {
  title: string
  initialName: string
  confirmLabel: string
  onConfirm: (name: string) => void
  onCancel: () => void
  /**
   * Accessible name for the input. Defaults to `title` — but a caller whose
   * `title` is itself a computed value (e.g. the collision-free default
   * name) should pass a stable, descriptive label instead, so the input
   * isn't announced as if labeled by its own content.
   */
  inputLabel?: string
}

/**
 * Generic name-entry modal shared by "create a mind map", "create a
 * subfolder", and "duplicate" — the pre-filled name is always already free
 * in the target folder (computed by the caller via `freeSiblingPath`), so
 * confirming without editing can never collide or overwrite anything.
 */
export function NameDialog({ title, initialName, confirmLabel, onConfirm, onCancel, inputLabel }: NameDialogProps) {
  const [name, setName] = useState(initialName)
  const inputRef = useRef<HTMLInputElement>(null)

  // Redundant with Radix Dialog's own default auto-focus-and-select behavior
  // for the first tabbable descendant — kept anyway because it makes the
  // selection assertion in this file's tests deterministic without relying
  // on Radix's internal timing.
  useEffect(() => {
    inputRef.current?.select()
  }, [])

  function submit() {
    const trimmed = name.trim()
    if (!trimmed) return
    onConfirm(trimmed)
  }

  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <input
          ref={inputRef}
          aria-label={inputLabel ?? title}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
          style={{ display: 'block', width: '100%', padding: '0.4rem 0.6rem', fontSize: 14 }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={!name.trim()}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
