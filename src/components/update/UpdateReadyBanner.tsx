import { useState } from 'react'

interface UpdateReadyBannerProps {
  onApply: () => void
}

/**
 * A discreet, dismissible banner offering to restart into an already
 * fully-downloaded update. Dismissing only hides it — the update has
 * already been installed by useAppUpdater and will apply on the next
 * natural relaunch regardless.
 */
export function UpdateReadyBanner({ onApply }: UpdateReadyBannerProps) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  return (
    <div role="status" className="status-banner status-banner--info">
      <span style={{ flex: 1 }}>Mise à jour prête</span>
      <button
        type="button"
        onClick={onApply}
        style={{
          background: 'transparent',
          border: '1px solid currentColor',
          borderRadius: 4,
          color: 'inherit',
          cursor: 'pointer',
          fontSize: 13,
          padding: '2px 8px',
        }}
      >
        Redémarrer
      </button>
      <button
        type="button"
        aria-label="Masquer le message de mise à jour"
        onClick={() => setDismissed(true)}
        style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 15 }}
      >
        ×
      </button>
    </div>
  )
}
