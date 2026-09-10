import { useState } from 'react'
import { Lock } from 'lucide-react'
import { Button } from './ui/button'

interface ReadOnlyMapOverlayProps {
  author: string
  /** `null` when nobody is logged in — there is no identity to duplicate the map as. */
  onDuplicate: (() => Promise<void>) | null
}

/**
 * Sits on top of the canvas, the same technique as `App.tsx`'s drag-and-drop
 * overlay: blocking every pointer interaction with the map underneath is
 * what makes it "read-only" — nothing inside `MindMapCanvas` needs to know
 * about ownership.
 */
export function ReadOnlyMapOverlay({ author, onDuplicate }: ReadOnlyMapOverlayProps) {
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
    <div
      style={{
        position: 'absolute',
        inset: 8,
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        background: 'color-mix(in oklch, var(--background), transparent 15%)',
        borderRadius: 8,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 16px',
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--card)',
          fontSize: 14,
        }}
      >
        <Lock size={16} aria-hidden />
        <span>Fichier de {author} — lecture seule</span>
      </div>
      {onDuplicate ? (
        <Button onClick={() => void handleDuplicate()} disabled={duplicating}>
          {duplicating ? 'Copie en cours…' : 'Personnaliser / Faire ma copie'}
        </Button>
      ) : (
        <span style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>
          Connectez-vous dans les réglages pour personnaliser cette carte.
        </span>
      )}
      {error && (
        <span role="alert" style={{ fontSize: 13, color: 'var(--warning-fg)' }}>
          ⚠ {error}
        </span>
      )}
    </div>
  )
}
